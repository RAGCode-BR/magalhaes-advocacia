BEGIN;

ALTER TABLE public.office_bank_connections
  ADD COLUMN last_error text,
  ADD COLUMN last_attempt_at timestamptz,
  ADD COLUMN syncing_since timestamptz,
  ADD COLUMN sync_lease uuid;
ALTER TABLE public.office_bank_balances DROP CONSTRAINT office_bank_balances_kind_check;
ALTER TABLE public.office_bank_balances ADD CONSTRAINT office_bank_balances_kind_check
  CHECK (kind IN ('ledger','available','blocked','credit_limit','investment_gross','investment_net'));

CREATE TABLE public.office_bank_reconciliations (
  transaction_id uuid PRIMARY KEY REFERENCES public.office_bank_transactions(id),
  settlement_id uuid NOT NULL UNIQUE REFERENCES public.office_finance_settlements(id),
  created_by uuid NOT NULL DEFAULT public.office_finance_uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.office_bank_reconciliations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.office_bank_reconciliations FROM PUBLIC,authenticated;
GRANT SELECT ON public.office_bank_reconciliations TO authenticated;
CREATE POLICY bank_admin_read ON public.office_bank_reconciliations FOR SELECT TO authenticated
  USING (public.has_role(public.office_finance_uid(),'admin'));

-- This login has no table grants, no application-user impersonation and no DDL.
-- Set its random password privately at installation, never in a migration.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='magalhaes_sicoob') THEN
    CREATE ROLE magalhaes_sicoob LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO magalhaes_sicoob',current_database());
END $$;
GRANT USAGE ON SCHEMA public TO magalhaes_sicoob;

CREATE FUNCTION public.office_bank_sync_claim(p_connection uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE lease uuid;
BEGIN
  UPDATE public.office_bank_connections SET syncing_since=now(),last_attempt_at=now(),
    sync_lease=gen_random_uuid(),last_error=NULL
  WHERE id=p_connection AND enabled
    AND (syncing_since IS NULL OR syncing_since < now()-interval '2 minutes')
    AND (last_attempt_at IS NULL OR last_attempt_at < now()-interval '30 seconds')
  RETURNING sync_lease INTO lease;
  RETURN lease;
END $$;
REVOKE ALL ON FUNCTION public.office_bank_sync_claim(uuid) FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION public.office_bank_sync_claim(uuid) TO magalhaes_sicoob;

CREATE FUNCTION public.office_bank_sync_finish(p_connection uuid,p_lease uuid,p_month date,
  p_rows jsonb,p_balances jsonb,p_error text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.office_bank_connections; n integer;
BEGIN
  SELECT * INTO STRICT c FROM public.office_bank_connections WHERE id=p_connection FOR UPDATE;
  IF p_lease IS NULL OR c.sync_lease IS DISTINCT FROM p_lease THEN
    RAISE EXCEPTION 'A sincronização foi substituída. Tente atualizar novamente.';
  END IF;
  IF p_error IS NOT NULL THEN
    UPDATE public.office_bank_connections SET last_error=left(p_error,320),syncing_since=NULL,sync_lease=NULL
      WHERE id=p_connection;
    RETURN 0;
  END IF;
  IF p_month IS NULL OR p_month<>date_trunc('month',p_month)::date
    OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)>10000
    OR jsonb_typeof(p_balances) IS DISTINCT FROM 'array' OR jsonb_array_length(p_balances)<>3 THEN
    RAISE EXCEPTION 'Resposta bancária incompleta ou inválida.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) AS x(external_id text,booked_on date)
      WHERE booked_on IS NULL OR booked_on<p_month OR booked_on>=(p_month+interval '1 month')::date)
    OR (SELECT count(DISTINCT x->>'external_id') FROM jsonb_array_elements(p_rows) x)<>jsonb_array_length(p_rows)
    OR (SELECT count(DISTINCT x->>'kind') FROM jsonb_array_elements(p_balances) x
       WHERE x->>'kind' IN ('ledger','blocked','credit_limit'))<>3 THEN
    RAISE EXCEPTION 'Período, identificadores ou saldos bancários inválidos.';
  END IF;
  INSERT INTO public.office_bank_transactions(connection_id,external_id,booked_on,description,amount_cents)
    SELECT p_connection,x.external_id,x.booked_on,x.description,x.amount_cents
    FROM jsonb_to_recordset(p_rows) AS x(external_id text,booked_on date,description text,amount_cents bigint)
    ON CONFLICT(connection_id,external_id) DO UPDATE SET
      booked_on=EXCLUDED.booked_on,description=EXCLUDED.description,amount_cents=EXCLUDED.amount_cents,observed_at=now()
    WHERE (office_bank_transactions.booked_on,office_bank_transactions.description,office_bank_transactions.amount_cents)
      IS DISTINCT FROM (EXCLUDED.booked_on,EXCLUDED.description,EXCLUDED.amount_cents);
  GET DIAGNOSTICS n=ROW_COUNT;
  INSERT INTO public.office_bank_balances(connection_id,kind,amount_cents,observed_at)
    SELECT p_connection,x.kind,x.amount_cents,now()
    FROM jsonb_to_recordset(p_balances) AS x(kind text,amount_cents bigint);
  UPDATE public.office_bank_connections SET last_success_at=now(),last_error=NULL,syncing_since=NULL,sync_lease=NULL
    WHERE id=p_connection;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.office_bank_sync_finish(uuid,uuid,date,jsonb,jsonb,text) FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION public.office_bank_sync_finish(uuid,uuid,date,jsonb,jsonb,text) TO magalhaes_sicoob;

-- Called through the Data API with the browser's verified JWT before a manual sync.
CREATE FUNCTION public.office_bank_sync_authorize() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM public.office_finance_require_admin(); RETURN true; END $$;
REVOKE ALL ON FUNCTION public.office_bank_sync_authorize() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_bank_sync_authorize() TO authenticated;

CREATE FUNCTION public.office_bank_overview(p_month date,p_status text DEFAULT 'all',
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
    SELECT t.id,t.booked_on,t.description,t.amount_cents,r.settlement_id,r.created_at AS reconciled_at
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

CREATE FUNCTION public.office_bank_candidates(p_transaction uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.office_finance_require_admin();
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
    SELECT s.id,s.settled_on,s.amount_cents,e.description,c.name AS client_name
    FROM public.office_bank_transactions t
    JOIN public.office_bank_connections b ON b.id=t.connection_id
    JOIN public.office_finance_settlements s ON s.account_id=b.account_id AND s.amount_cents=abs(t.amount_cents)
    JOIN public.office_finance_entries e ON e.id=s.entry_id
    LEFT JOIN public.clients c ON c.id=e.client_id
    WHERE t.id=p_transaction AND s.reversed_at IS NULL AND e.cancelled_at IS NULL
      AND e.kind=CASE WHEN t.amount_cents>0 THEN 'income' ELSE 'expense' END
      AND NOT EXISTS(SELECT 1 FROM public.office_bank_reconciliations r WHERE r.settlement_id=s.id)
    ORDER BY abs(s.settled_on-t.booked_on),s.id LIMIT 50
  ) x;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.office_bank_candidates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_bank_candidates(uuid) TO authenticated;

CREATE FUNCTION public.office_bank_reconcile(p_transaction uuid,p_settlement uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.office_bank_transactions; s public.office_finance_settlements; expected_account uuid;
BEGIN
  PERFORM public.office_finance_require_admin();
  SELECT * INTO STRICT t FROM public.office_bank_transactions WHERE id=p_transaction FOR UPDATE;
  SELECT * INTO STRICT s FROM public.office_finance_settlements WHERE id=p_settlement FOR UPDATE;
  SELECT account_id INTO expected_account FROM public.office_bank_connections WHERE id=t.connection_id;
  IF s.reversed_at IS NOT NULL OR s.account_id IS DISTINCT FROM expected_account OR s.amount_cents<>abs(t.amount_cents)
    OR NOT EXISTS(SELECT 1 FROM public.office_finance_entries e WHERE e.id=s.entry_id AND e.cancelled_at IS NULL
       AND e.kind=CASE WHEN t.amount_cents>0 THEN 'income' ELSE 'expense' END) THEN
    RAISE EXCEPTION 'A baixa precisa ter a mesma conta, valor e tipo da movimentação bancária.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.office_bank_reconciliations WHERE transaction_id=p_transaction AND settlement_id=p_settlement) THEN RETURN; END IF;
  INSERT INTO public.office_bank_reconciliations(transaction_id,settlement_id) VALUES(p_transaction,p_settlement);
  INSERT INTO public.office_finance_history(entity_id,entity_type,action,after_data)
    VALUES(p_transaction,'bank_reconciliation','reconcile',jsonb_build_object('settlement_id',p_settlement));
END $$;
REVOKE ALL ON FUNCTION public.office_bank_reconcile(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_bank_reconcile(uuid,uuid) TO authenticated;

CREATE FUNCTION public.office_bank_unreconcile(p_transaction uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_link public.office_bank_reconciliations;
BEGIN
  PERFORM public.office_finance_require_admin();
  IF nullif(trim(p_reason),'') IS NULL OR length(p_reason)>500 THEN RAISE EXCEPTION 'Informe um motivo de até 500 caracteres.'; END IF;
  PERFORM 1 FROM public.office_bank_transactions WHERE id=p_transaction FOR UPDATE;
  DELETE FROM public.office_bank_reconciliations WHERE transaction_id=p_transaction RETURNING * INTO old_link;
  IF FOUND THEN
    INSERT INTO public.office_finance_history(entity_id,entity_type,action,before_data,after_data)
      VALUES(p_transaction,'bank_reconciliation','unreconcile',to_jsonb(old_link),jsonb_build_object('reason',trim(p_reason)));
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.office_bank_unreconcile(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_bank_unreconcile(uuid,text) TO authenticated;

CREATE FUNCTION public.office_bank_guard_reconciled() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_TABLE_NAME='office_finance_settlements' THEN
    IF (NEW.amount_cents,NEW.account_id,NEW.entry_id,NEW.reversed_at) IS DISTINCT FROM (OLD.amount_cents,OLD.account_id,OLD.entry_id,OLD.reversed_at)
      AND EXISTS(SELECT 1 FROM public.office_bank_reconciliations WHERE settlement_id=OLD.id) THEN
      RAISE EXCEPTION 'Desfaça a conciliação bancária antes de alterar ou estornar esta baixa.';
    END IF;
  ELSE
    IF (NEW.amount_cents,NEW.booked_on) IS DISTINCT FROM (OLD.amount_cents,OLD.booked_on)
      AND EXISTS(SELECT 1 FROM public.office_bank_reconciliations WHERE transaction_id=OLD.id) THEN
      RAISE EXCEPTION 'O banco alterou uma movimentação conciliada. Revise a conciliação antes de atualizar.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.office_bank_guard_reconciled() FROM PUBLIC,authenticated;
CREATE TRIGGER bank_guard_settlement BEFORE UPDATE ON public.office_finance_settlements
  FOR EACH ROW EXECUTE FUNCTION public.office_bank_guard_reconciled();
CREATE TRIGGER bank_guard_transaction BEFORE UPDATE ON public.office_bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.office_bank_guard_reconciled();
COMMIT;
