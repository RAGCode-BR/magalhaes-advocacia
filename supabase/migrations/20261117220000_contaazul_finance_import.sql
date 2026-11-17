BEGIN;

-- Import provenance is private to administrators. Only the maintenance importer
-- can write batches; a browser cannot forge an imported/reconciled source record.
CREATE TABLE public.office_finance_import_batches (
  id uuid PRIMARY KEY,
  source_system text NOT NULL CHECK (source_system='conta_azul'),
  fingerprint text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('applied','reverted')),
  summary jsonb NOT NULL,
  files jsonb NOT NULL,
  created_by uuid NOT NULL DEFAULT public.office_finance_uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX finance_one_active_contaazul_import
  ON public.office_finance_import_batches(source_system) WHERE status='applied';
CREATE TABLE public.office_finance_import_items (
  batch_id uuid NOT NULL REFERENCES public.office_finance_import_batches(id),
  entity_table text NOT NULL,
  entity_id uuid NOT NULL,
  source_key text NOT NULL,
  source_data jsonb NOT NULL,
  before_data jsonb,
  after_data jsonb NOT NULL,
  PRIMARY KEY(batch_id,entity_table,entity_id),
  UNIQUE(batch_id,source_key)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['office_finance_import_batches','office_finance_import_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,authenticated',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
    EXECUTE format('CREATE POLICY finance_import_admin ON public.%I FOR SELECT TO authenticated USING(public.has_role(public.office_finance_uid(),''admin''))',t);
  END LOOP;
END $$;

ALTER TABLE public.office_finance_entries
  ADD COLUMN import_batch_id uuid REFERENCES public.office_finance_import_batches(id),
  ADD COLUMN source_status text,
  ADD COLUMN counterparty_name text,
  ADD COLUMN counterparty_document text;
ALTER TABLE public.office_finance_settlements
  ADD COLUMN import_batch_id uuid REFERENCES public.office_finance_import_batches(id),
  ADD COLUMN source_reconciled boolean NOT NULL DEFAULT false,
  ADD COLUMN principal_cents integer,
  ADD COLUMN interest_cents integer NOT NULL DEFAULT 0 CHECK (interest_cents>=0),
  ADD COLUMN fine_cents integer NOT NULL DEFAULT 0 CHECK (fine_cents>=0),
  ADD COLUMN discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents>=0);
UPDATE public.office_finance_settlements SET principal_cents=amount_cents;
ALTER TABLE public.office_finance_settlements
  ADD CONSTRAINT finance_settlement_principal_positive CHECK (principal_cents>0),
  ADD CONSTRAINT finance_settlement_net CHECK (
    amount_cents::bigint=principal_cents::bigint+interest_cents+fine_cents-discount_cents),
  ALTER COLUMN principal_cents SET NOT NULL;
GRANT INSERT(principal_cents,interest_cents,fine_cents,discount_cents)
  ON public.office_finance_settlements TO authenticated;
ALTER TABLE public.office_finance_transfers
  ADD COLUMN import_batch_id uuid REFERENCES public.office_finance_import_batches(id),
  ADD COLUMN source_from_reconciled boolean NOT NULL DEFAULT false,
  ADD COLUMN source_to_reconciled boolean NOT NULL DEFAULT false;

-- Conta Azul has same-named categories with different financial natures. Keep
-- both; an expense category must not silently become an income category.
DROP INDEX public.office_finance_register_name;
CREATE UNIQUE INDEX office_finance_register_name ON public.office_finance_registers
  (kind,lower(trim(name)),coalesce(nature,''));

-- Existing callers still pass only amount_cents. Cash stays in amount_cents;
-- principal reduces the invoice balance, including a discount's forgiven part.
CREATE FUNCTION public.office_finance_prepare_settlement() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
  NEW.principal_cents:=coalesce(NEW.principal_cents,NEW.amount_cents);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.office_finance_prepare_settlement() FROM PUBLIC,authenticated;
CREATE TRIGGER finance_prepare_settlement BEFORE INSERT ON public.office_finance_settlements
  FOR EACH ROW EXECUTE FUNCTION public.office_finance_prepare_settlement();

CREATE OR REPLACE FUNCTION public.office_finance_apply_settlement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  PERFORM public.office_finance_require_admin();
  IF NEW.settled_on>(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'A data da baixa não pode estar no futuro.';
  END IF;
  IF NEW.account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.office_finance_accounts WHERE id=NEW.account_id AND active AND opening_date<=NEW.settled_on
  ) THEN RAISE EXCEPTION 'Selecione uma conta ativa com abertura anterior à baixa.'; END IF;
  UPDATE public.office_finance_entries SET settled_cents=settled_cents+NEW.principal_cents,updated_at=now()
    WHERE id=NEW.entry_id AND cancelled_at IS NULL AND amount_cents-settled_cents>=NEW.principal_cents;
  IF NOT FOUND THEN RAISE EXCEPTION 'A baixa excede o saldo ou o lançamento está cancelado.'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.office_finance_reverse_settlement(target uuid, reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.office_finance_settlements; entry uuid;
BEGIN
  PERFORM public.office_finance_require_admin();
  IF nullif(trim(reason),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo do estorno.'; END IF;
  SELECT entry_id INTO STRICT entry FROM public.office_finance_settlements WHERE id=target;
  PERFORM 1 FROM public.office_finance_entries WHERE id=entry FOR UPDATE;
  SELECT * INTO STRICT s FROM public.office_finance_settlements WHERE id=target FOR UPDATE;
  IF s.reversed_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.office_finance_settlements SET reversed_at=now(),reversal_reason=reason WHERE id=target;
  UPDATE public.office_finance_entries SET settled_cents=settled_cents-s.principal_cents,updated_at=now() WHERE id=entry;
END $$;

CREATE FUNCTION public.office_finance_link_client(target uuid, client uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.office_finance_entries;
BEGIN
  PERFORM public.office_finance_require_admin();
  SELECT * INTO STRICT e FROM public.office_finance_entries WHERE id=target FOR UPDATE;
  IF client IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.clients WHERE id=client) THEN
    RAISE EXCEPTION 'Cliente não encontrado.';
  END IF;
  IF e.process_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tasks WHERE id=e.process_id AND client_id=client AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'O processo precisa pertencer ao cliente selecionado.';
  END IF;
  UPDATE public.office_finance_entries SET client_id=client,updated_at=now() WHERE id=target;
END $$;
REVOKE ALL ON FUNCTION public.office_finance_link_client(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_finance_link_client(uuid,uuid) TO authenticated;

-- One transfer has two independent legs, one per account. Neither leg is income
-- or expense. Existing settlement reconciliation keeps its unique relationship.
ALTER TABLE public.office_bank_reconciliations ALTER COLUMN settlement_id DROP NOT NULL;
ALTER TABLE public.office_bank_reconciliations
  ADD COLUMN transfer_id uuid REFERENCES public.office_finance_transfers(id),
  ADD COLUMN transfer_account_id uuid REFERENCES public.office_finance_accounts(id),
  ADD CONSTRAINT bank_reconciliation_target CHECK (
    (settlement_id IS NOT NULL AND transfer_id IS NULL AND transfer_account_id IS NULL) OR
    (settlement_id IS NULL AND transfer_id IS NOT NULL AND transfer_account_id IS NOT NULL)),
  ADD CONSTRAINT bank_transfer_leg_unique UNIQUE(transfer_id,transfer_account_id);

CREATE FUNCTION public.office_bank_reconcile_transfer(p_transaction uuid,p_transfer uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.office_bank_transactions; f public.office_finance_transfers; account uuid;
BEGIN
  PERFORM public.office_finance_require_admin();
  SELECT * INTO STRICT t FROM public.office_bank_transactions WHERE id=p_transaction FOR UPDATE;
  SELECT * INTO STRICT f FROM public.office_finance_transfers WHERE id=p_transfer FOR UPDATE;
  SELECT account_id INTO account FROM public.office_bank_connections WHERE id=t.connection_id;
  IF account IS NULL OR abs(t.amount_cents)<>f.amount_cents
    OR account IS DISTINCT FROM (CASE WHEN t.amount_cents>0 THEN f.to_account ELSE f.from_account END) THEN
    RAISE EXCEPTION 'A transferência precisa ter a mesma conta, sentido e valor da movimentação.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.office_bank_reconciliations WHERE transaction_id=p_transaction AND transfer_id=p_transfer) THEN RETURN; END IF;
  INSERT INTO public.office_bank_reconciliations(transaction_id,transfer_id,transfer_account_id)
    VALUES(p_transaction,p_transfer,account);
  INSERT INTO public.office_finance_history(entity_id,entity_type,action,after_data)
    VALUES(p_transaction,'bank_reconciliation','reconcile_transfer',jsonb_build_object('transfer_id',p_transfer));
END $$;
REVOKE ALL ON FUNCTION public.office_bank_reconcile_transfer(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_bank_reconcile_transfer(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.office_bank_candidates(p_transaction uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.office_finance_require_admin();
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
    SELECT candidates.* FROM (
      SELECT s.id,s.settled_on,s.amount_cents,e.description,
        coalesce(c.name,e.counterparty_name) AS client_name,'settlement'::text AS target_type,
        s.source_reconciled
      FROM public.office_bank_transactions t
      JOIN public.office_bank_connections b ON b.id=t.connection_id
      JOIN public.office_finance_settlements s ON s.account_id=b.account_id AND s.amount_cents=abs(t.amount_cents)
      JOIN public.office_finance_entries e ON e.id=s.entry_id
      LEFT JOIN public.clients c ON c.id=e.client_id
      WHERE t.id=p_transaction AND s.reversed_at IS NULL AND e.cancelled_at IS NULL
        AND e.kind=CASE WHEN t.amount_cents>0 THEN 'income' ELSE 'expense' END
        AND NOT EXISTS(SELECT 1 FROM public.office_bank_reconciliations r WHERE r.settlement_id=s.id)
      UNION ALL
      SELECT f.id,f.transferred_on,f.amount_cents,f.description,
        a.name,'transfer',CASE WHEN t.amount_cents>0 THEN f.source_to_reconciled ELSE f.source_from_reconciled END
      FROM public.office_bank_transactions t
      JOIN public.office_bank_connections b ON b.id=t.connection_id
      JOIN public.office_finance_transfers f ON f.amount_cents=abs(t.amount_cents)
        AND b.account_id=CASE WHEN t.amount_cents>0 THEN f.to_account ELSE f.from_account END
      JOIN public.office_finance_accounts a ON a.id=CASE WHEN t.amount_cents>0 THEN f.from_account ELSE f.to_account END
      WHERE t.id=p_transaction
        AND NOT EXISTS(SELECT 1 FROM public.office_bank_reconciliations r WHERE r.transfer_id=f.id AND r.transfer_account_id=b.account_id)
    ) candidates
    ORDER BY abs(settled_on-(SELECT booked_on FROM public.office_bank_transactions WHERE id=p_transaction)),id LIMIT 50
  ) x;
  RETURN result;
END $$;

CREATE FUNCTION public.office_bank_guard_transfer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
  IF (NEW.amount_cents,NEW.from_account,NEW.to_account,NEW.transferred_on) IS DISTINCT FROM
    (OLD.amount_cents,OLD.from_account,OLD.to_account,OLD.transferred_on)
    AND EXISTS(SELECT 1 FROM public.office_bank_reconciliations WHERE transfer_id=OLD.id) THEN
    RAISE EXCEPTION 'Desfaça a conciliação antes de alterar esta transferência.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.office_bank_guard_transfer() FROM PUBLIC,authenticated;
CREATE TRIGGER bank_guard_transfer BEFORE UPDATE ON public.office_finance_transfers
  FOR EACH ROW EXECUTE FUNCTION public.office_bank_guard_transfer();

CREATE OR REPLACE FUNCTION public.office_bank_overview(p_month date,p_status text DEFAULT 'all',
  p_before_date date DEFAULT NULL,p_before_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.office_bank_connections; rows jsonb; totals jsonb; balances jsonb;
BEGIN
  PERFORM public.office_finance_require_admin();
  IF p_month IS NULL OR p_month<>date_trunc('month',p_month)::date OR p_status NOT IN ('all','pending','reconciled') THEN
    RAISE EXCEPTION 'Selecione um mês e uma situação válidos.';
  END IF;
  SELECT * INTO c FROM public.office_bank_connections WHERE product='checking' ORDER BY enabled DESC,created_at LIMIT 1;
  IF c.id IS NULL THEN RETURN jsonb_build_object('connection',NULL,'rows','[]'::jsonb); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.booked_on DESC,page.id DESC),'[]'::jsonb) INTO rows FROM (
    SELECT t.id,t.booked_on,t.description,t.amount_cents,r.settlement_id,r.transfer_id,r.created_at AS reconciled_at
    FROM public.office_bank_transactions t LEFT JOIN public.office_bank_reconciliations r ON r.transaction_id=t.id
    WHERE t.connection_id=c.id AND t.booked_on>=p_month AND t.booked_on<(p_month+interval '1 month')::date
      AND (p_status='all' OR (p_status='pending' AND r.transaction_id IS NULL) OR (p_status='reconciled' AND r.transaction_id IS NOT NULL))
      AND (p_before_date IS NULL OR (t.booked_on,t.id)<(p_before_date,p_before_id))
    ORDER BY t.booked_on DESC,t.id DESC LIMIT 51
  ) page;
  SELECT jsonb_build_object('credits',coalesce(sum(t.amount_cents) FILTER(WHERE t.amount_cents>0),0),
    'debits',coalesce(-sum(t.amount_cents) FILTER(WHERE t.amount_cents<0),0),'count',count(*),
    'pending',count(*) FILTER(WHERE r.transaction_id IS NULL)) INTO totals
    FROM public.office_bank_transactions t LEFT JOIN public.office_bank_reconciliations r ON r.transaction_id=t.id
    WHERE t.connection_id=c.id AND t.booked_on>=p_month AND t.booked_on<(p_month+interval '1 month')::date;
  SELECT coalesce(jsonb_object_agg(b.kind,jsonb_build_object('amount_cents',b.amount_cents,'observed_at',b.observed_at)),'{}'::jsonb)
    INTO balances FROM (SELECT DISTINCT ON(kind) kind,amount_cents,observed_at FROM public.office_bank_balances
      WHERE connection_id=c.id ORDER BY kind,observed_at DESC) b;
  RETURN jsonb_build_object('connection',jsonb_build_object('id',c.id,'account_id',c.account_id,
    'name',(SELECT name FROM public.office_finance_accounts WHERE id=c.account_id),'enabled',c.enabled,
    'last_success_at',c.last_success_at,'last_error',c.last_error,'syncing_since',c.syncing_since),
    'rows',rows,'totals',totals,'balances',balances);
END $$;
REVOKE ALL ON FUNCTION public.office_bank_overview(date,text,date,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_bank_overview(date,text,date,uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.office_bank_create_and_reconcile(
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
  IF EXISTS(SELECT 1 FROM public.office_bank_reconciliations WHERE transaction_id=p_transaction) THEN RAISE EXCEPTION 'Esta movimentação já está conciliada.'; END IF;
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

NOTIFY pgrst,'reload schema';
COMMIT;
