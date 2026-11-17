-- Criar lançamento a partir da movimentação bancária.
-- In one transaction: create the entry (receita/despesa) with the bank amount and
-- date, settle it on the account linked to the Sicoob connection and reconcile it
-- with the bank movement. Retrying with the same ids is harmless.

CREATE FUNCTION public.office_bank_create_and_reconcile(
  p_transaction uuid, p_entry uuid, p_settlement uuid, data jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.office_bank_transactions;
  account uuid;
  linked uuid;
  kind text;
  amount integer;
  description text := trim(coalesce(data->>'description',''));
  category text := trim(coalesce(data->>'category',''));
  client uuid := nullif(data->>'client_id','')::uuid;
BEGIN
  PERFORM public.office_finance_require_admin();
  SELECT * INTO STRICT t FROM public.office_bank_transactions WHERE id = p_transaction FOR UPDATE;
  SELECT settlement_id INTO linked FROM public.office_bank_reconciliations WHERE transaction_id = p_transaction;
  IF linked = p_settlement THEN RETURN; END IF;
  IF linked IS NOT NULL THEN RAISE EXCEPTION 'Esta movimentação já está conciliada.'; END IF;
  SELECT account_id INTO account FROM public.office_bank_connections WHERE id = t.connection_id;
  IF account IS NULL THEN RAISE EXCEPTION 'Vincule a conexão Sicoob a uma conta financeira.'; END IF;
  IF length(description) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Informe a descrição.'; END IF;
  IF length(category) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Escolha a conta do plano de contas.'; END IF;
  kind := CASE WHEN t.amount_cents > 0 THEN 'income' ELSE 'expense' END;
  amount := abs(t.amount_cents);
  IF kind = 'expense' THEN client := NULL; END IF;
  IF client IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = client) THEN
    RAISE EXCEPTION 'Cliente não encontrado.';
  END IF;
  INSERT INTO public.office_finance_entries(id,group_id,installment,installment_count,kind,description,category,
    cost_center,supplier,notes,client_id,competence_date,due_date,amount_cents)
  VALUES(p_entry,p_entry,1,1,kind,description,category,
    nullif(trim(coalesce(data->>'cost_center','')),''),
    CASE WHEN kind='expense' THEN nullif(trim(coalesce(data->>'supplier','')),'') END,
    nullif(trim(coalesce(data->>'notes','')),''),
    client,t.booked_on,t.booked_on,amount)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.office_finance_settlements(id,entry_id,amount_cents,settled_on,account_id,payment_method)
  VALUES(p_settlement,p_entry,amount,t.booked_on,account,'transfer')
  ON CONFLICT (id) DO NOTHING;
  PERFORM public.office_bank_reconcile(p_transaction, p_settlement);
END $$;

REVOKE ALL ON FUNCTION public.office_bank_create_and_reconcile(uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_bank_create_and_reconcile(uuid,uuid,uuid,jsonb) TO authenticated;
