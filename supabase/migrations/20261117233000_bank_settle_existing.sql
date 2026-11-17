-- Confirm one bank movement against an existing unpaid title atomically.
CREATE OR REPLACE FUNCTION public.office_bank_settle_existing(
  p_transaction uuid, p_entry uuid, p_settlement uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t public.office_bank_transactions;
  e public.office_finance_entries;
  account uuid;
  linked uuid;
  amount integer;
BEGIN
  PERFORM public.office_finance_require_admin();
  SELECT * INTO STRICT t FROM public.office_bank_transactions WHERE id=p_transaction FOR UPDATE;
  SELECT settlement_id INTO linked FROM public.office_bank_reconciliations WHERE transaction_id=p_transaction;
  IF linked=p_settlement AND EXISTS(SELECT 1 FROM public.office_finance_settlements WHERE id=linked AND entry_id=p_entry) THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.office_bank_reconciliations WHERE transaction_id=p_transaction) THEN
    RAISE EXCEPTION 'Movimentação já conciliada. Atualize o extrato.';
  END IF;
  SELECT * INTO STRICT e FROM public.office_finance_entries WHERE id=p_entry FOR UPDATE;
  amount := abs(t.amount_cents);
  IF e.cancelled_at IS NOT NULL OR e.kind <> (CASE WHEN t.amount_cents>0 THEN 'income' ELSE 'expense' END) THEN
    RAISE EXCEPTION 'O lançamento não corresponde ao tipo da movimentação.';
  END IF;
  IF amount > e.amount_cents-e.settled_cents THEN
    RAISE EXCEPTION 'O valor bancário excede o saldo em aberto. Confira juros, descontos ou pagamentos agrupados antes de conciliar.';
  END IF;
  SELECT account_id INTO account FROM public.office_bank_connections WHERE id=t.connection_id;
  IF account IS NULL THEN RAISE EXCEPTION 'Vincule a conta bancária ao financeiro.'; END IF;
  INSERT INTO public.office_finance_settlements(id,entry_id,amount_cents,principal_cents,settled_on,account_id,payment_method)
  VALUES(p_settlement,p_entry,amount,amount,t.booked_on,account,'transfer');
  PERFORM public.office_bank_reconcile(p_transaction,p_settlement);
END $$;
REVOKE ALL ON FUNCTION public.office_bank_settle_existing(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_bank_settle_existing(uuid,uuid,uuid) TO authenticated;
