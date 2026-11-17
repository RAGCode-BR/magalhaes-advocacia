BEGIN;
CREATE TABLE public.office_bank_periods (
  connection_id uuid NOT NULL REFERENCES public.office_bank_connections(id),
  month date NOT NULL CHECK(month=date_trunc('month',month)::date),
  row_count integer NOT NULL CHECK(row_count>=0),
  synced_at timestamptz NOT NULL,
  PRIMARY KEY(connection_id,month)
);
ALTER TABLE public.office_bank_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.office_bank_periods FROM PUBLIC,authenticated;
GRANT SELECT ON public.office_bank_periods TO authenticated;
CREATE POLICY bank_period_admin ON public.office_bank_periods FOR SELECT TO authenticated
  USING(public.has_role(public.office_finance_uid(),'admin'));
CREATE FUNCTION public.office_bank_periods_list() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.office_finance_require_admin();
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY month),'[]'::jsonb)
    FROM (SELECT p.month,p.row_count,p.synced_at FROM public.office_bank_periods p
      WHERE connection_id=(SELECT id FROM public.office_bank_connections WHERE product='checking' ORDER BY enabled DESC,created_at LIMIT 1)) x);
END $$;
REVOKE ALL ON FUNCTION public.office_bank_periods_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_bank_periods_list() TO authenticated;

CREATE OR REPLACE FUNCTION public.office_bank_sync_finish(p_connection uuid,p_lease uuid,p_month date,
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
  INSERT INTO public.office_bank_periods(connection_id,month,row_count,synced_at)
    VALUES(p_connection,p_month,jsonb_array_length(p_rows),now())
    ON CONFLICT(connection_id,month) DO UPDATE SET row_count=EXCLUDED.row_count,synced_at=EXCLUDED.synced_at;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.office_bank_sync_finish(uuid,uuid,date,jsonb,jsonb,text) FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION public.office_bank_sync_finish(uuid,uuid,date,jsonb,jsonb,text) TO magalhaes_sicoob;

-- One durable issuance intent per receivable. No direct browser writes or importer table grants.
CREATE TABLE public.office_finance_boletos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL UNIQUE REFERENCES public.office_finance_entries(id),
  connection_id uuid NOT NULL REFERENCES public.office_bank_connections(id),
  reference text NOT NULL UNIQUE DEFAULT ('M'||substr(replace(gen_random_uuid()::text,'-',''),1,17)),
  amount_cents integer NOT NULL CHECK(amount_cents>0),
  due_date date NOT NULL,
  payer jsonb NOT NULL CHECK(jsonb_typeof(payer)='object' AND pg_column_size(payer)<4000),
  species text NOT NULL CHECK(species IN ('DS','RC','FAT','OU')),
  state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','issuing','issued','rejected','uncertain')),
  lease uuid,
  last_error text,
  bank_data jsonb NOT NULL DEFAULT '{}' CHECK(pg_column_size(bank_data)<12000),
  created_by uuid NOT NULL DEFAULT public.office_finance_uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.office_finance_boletos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.office_finance_boletos FROM PUBLIC,authenticated;
CREATE FUNCTION public.office_boleto_prepare(p_entry uuid,p_payer jsonb,p_species text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.office_finance_entries; b public.office_finance_boletos; conn uuid;
BEGIN
  PERFORM public.office_finance_require_admin();
  SELECT * INTO STRICT e FROM public.office_finance_entries WHERE id=p_entry FOR UPDATE;
  SELECT * INTO b FROM public.office_finance_boletos WHERE entry_id=p_entry FOR UPDATE;
  IF b.id IS NOT NULL AND b.state NOT IN ('prepared','rejected') THEN RETURN b.id; END IF;
  IF e.kind<>'income' OR e.cancelled_at IS NOT NULL OR e.client_id IS NULL OR e.settled_cents>=e.amount_cents
    OR e.due_date<(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'Selecione um honorário em aberto, vinculado a um cliente, com vencimento hoje ou no futuro.';
  END IF;
  IF jsonb_typeof(p_payer) IS DISTINCT FROM 'object' OR pg_column_size(p_payer)>4000
    OR p_species IS NULL OR p_species NOT IN ('DS','RC','FAT','OU') THEN RAISE EXCEPTION 'Revise os dados do pagador.'; END IF;
  SELECT id INTO conn FROM public.office_bank_connections WHERE product='checking' AND enabled ORDER BY created_at LIMIT 1;
  IF conn IS NULL THEN RAISE EXCEPTION 'Conta Sicoob não configurada.'; END IF;
  INSERT INTO public.office_finance_boletos(entry_id,connection_id,amount_cents,due_date,payer,species)
    VALUES(e.id,conn,e.amount_cents-e.settled_cents,e.due_date,p_payer,p_species)
    ON CONFLICT(entry_id) DO UPDATE SET amount_cents=EXCLUDED.amount_cents,due_date=EXCLUDED.due_date,
      payer=EXCLUDED.payer,species=EXCLUDED.species,state='prepared',last_error=NULL,updated_at=now()
    RETURNING * INTO b;
  INSERT INTO public.office_finance_history(entity_id,entity_type,action,after_data)
    VALUES(b.id,'boleto','prepare',jsonb_build_object('entry_id',e.id,'amount_cents',b.amount_cents,'due_date',b.due_date));
  RETURN b.id;
END $$;

CREATE FUNCTION public.office_boleto_list(p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.office_finance_require_admin();
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY created_at DESC,id DESC),'[]'::jsonb) FROM (
    SELECT b.id,b.entry_id,b.reference,b.amount_cents,b.due_date,b.state,b.last_error,b.bank_data,b.created_at,b.updated_at,
      b.payer,b.species,e.description,c.name AS client_name
    FROM public.office_finance_boletos b JOIN public.office_finance_entries e ON e.id=b.entry_id
      LEFT JOIN public.clients c ON c.id=e.client_id
    WHERE p_before IS NULL OR (b.created_at,b.id)<(p_before,p_before_id)
    ORDER BY b.created_at DESC,b.id DESC LIMIT 51) x);
END $$;

CREATE FUNCTION public.office_boleto_claim(p_id uuid,p_connection uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.office_finance_boletos; e public.office_finance_entries;
BEGIN
  SELECT e1.* INTO STRICT e FROM public.office_finance_entries e1
    JOIN public.office_finance_boletos b1 ON b1.entry_id=e1.id WHERE b1.id=p_id FOR UPDATE OF e1;
  SELECT * INTO STRICT b FROM public.office_finance_boletos WHERE id=p_id AND connection_id=p_connection FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.office_bank_connections WHERE id=p_connection AND enabled) THEN
    RAISE EXCEPTION 'Conta desativada.'; END IF;
  IF b.state NOT IN ('prepared','rejected') THEN RETURN jsonb_build_object('claimed',false,'state',b.state); END IF;
  IF e.kind<>'income' OR e.cancelled_at IS NOT NULL OR e.client_id IS NULL
    OR e.amount_cents-e.settled_cents<>b.amount_cents OR e.due_date<>b.due_date
    OR b.due_date<(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'O honorário mudou. Revise o boleto antes de emitir.'; END IF;
  UPDATE public.office_finance_boletos SET state='issuing',lease=gen_random_uuid(),last_error=NULL,updated_at=now()
    WHERE id=p_id RETURNING * INTO b;
  RETURN jsonb_build_object('claimed',true,'boleto',to_jsonb(b));
END $$;

CREATE FUNCTION public.office_boleto_read(p_id uuid,p_connection uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT to_jsonb(b) FROM public.office_finance_boletos b WHERE b.id=p_id AND b.connection_id=p_connection
$$;

CREATE FUNCTION public.office_boleto_finish(p_id uuid,p_lease uuid,p_state text,p_data jsonb,p_error text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.office_finance_boletos;
BEGIN
  SELECT * INTO STRICT b FROM public.office_finance_boletos WHERE id=p_id FOR UPDATE;
  IF b.lease IS DISTINCT FROM p_lease OR p_lease IS NULL OR b.state<>'issuing' THEN RAISE EXCEPTION 'Emissão substituída.'; END IF;
  IF p_state IS NULL OR p_state NOT IN ('issued','rejected','uncertain') OR p_data IS NULL OR pg_column_size(p_data)>12000 THEN
    RAISE EXCEPTION 'Resultado inválido.'; END IF;
  UPDATE public.office_finance_boletos SET state=p_state,lease=NULL,bank_data=p_data,last_error=left(p_error,600),updated_at=now() WHERE id=p_id;
  INSERT INTO public.office_finance_history(entity_id,entity_type,action,created_by,after_data)
    VALUES(p_id,'boleto',p_state,b.created_by,jsonb_build_object('reference',b.reference,'entry_id',b.entry_id));
END $$;

-- Read-only bank lookup, also recovers a timeout by matching the bank's reference/amount/payer.
-- No bookkeeping settlement is created here: bank payment and ledger reconciliation are distinct.
CREATE FUNCTION public.office_boleto_refresh(p_id uuid,p_connection uuid,p_data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.office_finance_boletos;
BEGIN
  SELECT * INTO STRICT b FROM public.office_finance_boletos WHERE id=p_id AND connection_id=p_connection FOR UPDATE;
  IF b.state NOT IN ('issued','uncertain','issuing') OR (b.state='issuing' AND b.updated_at>now()-interval '2 minutes') THEN
    RAISE EXCEPTION 'Aguarde a emissão antes de consultar.'; END IF;
  IF p_data IS NULL OR pg_column_size(p_data)>12000 OR p_data->>'seuNumero' IS DISTINCT FROM b.reference
    OR (p_data->>'amount_cents')::bigint IS DISTINCT FROM b.amount_cents
    OR p_data->>'payer_document' IS DISTINCT FROM b.payer->>'numeroCpfCnpj'
    OR nullif(p_data->>'nossoNumero','') IS NULL THEN RAISE EXCEPTION 'Boleto do banco não corresponde ao lançamento.'; END IF;
  UPDATE public.office_finance_boletos SET state='issued',lease=NULL,bank_data=p_data,last_error=NULL,updated_at=now() WHERE id=p_id;
  INSERT INTO public.office_finance_history(entity_id,entity_type,action,created_by,after_data)
    VALUES(p_id,'boleto','bank_query',b.created_by,jsonb_build_object('situacaoBoleto',p_data->>'situacaoBoleto'));
END $$;

CREATE FUNCTION public.office_boleto_guard_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF (NEW.kind,NEW.amount_cents,NEW.due_date,NEW.client_id,NEW.cancelled_at)
      IS DISTINCT FROM (OLD.kind,OLD.amount_cents,OLD.due_date,OLD.client_id,OLD.cancelled_at)
    AND EXISTS(SELECT 1 FROM public.office_finance_boletos WHERE entry_id=OLD.id AND state IN ('issuing','issued','uncertain')) THEN
    RAISE EXCEPTION 'Este honorário tem boleto no banco. Alterações de valor, cliente, vencimento ou cancelamento exigem revisão da cobrança no Sicoob.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER boleto_guard_entry BEFORE UPDATE ON public.office_finance_entries
  FOR EACH ROW EXECUTE FUNCTION public.office_boleto_guard_entry();

REVOKE ALL ON FUNCTION public.office_boleto_prepare(uuid,jsonb,text),public.office_boleto_list(timestamptz,uuid),
  public.office_boleto_claim(uuid,uuid),public.office_boleto_read(uuid,uuid),
  public.office_boleto_finish(uuid,uuid,text,jsonb,text),public.office_boleto_refresh(uuid,uuid,jsonb),public.office_boleto_guard_entry() FROM PUBLIC,authenticated;
GRANT EXECUTE ON FUNCTION public.office_boleto_prepare(uuid,jsonb,text),public.office_boleto_list(timestamptz,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.office_boleto_claim(uuid,uuid),public.office_boleto_read(uuid,uuid),
  public.office_boleto_finish(uuid,uuid,text,jsonb,text),public.office_boleto_refresh(uuid,uuid,jsonb) TO magalhaes_sicoob;
COMMIT;
