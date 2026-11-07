BEGIN;

CREATE TABLE public.office_finance_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  opening_cents bigint NOT NULL DEFAULT 0 CHECK (abs(opening_cents) <= 900000000000),
  opening_date date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX office_finance_account_name ON public.office_finance_accounts(lower(trim(name)));

CREATE TABLE public.office_finance_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('supplier','category','cost_center')),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  contact text CHECK (length(contact) <= 254),
  notes text CHECK (length(notes) <= 2000),
  active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX office_finance_register_name ON public.office_finance_registers(kind,lower(trim(name)));

CREATE TABLE public.office_finance_agreements (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('quote','recurring')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','active','closed')),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 200),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  process_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  periods integer NOT NULL CHECK (periods BETWEEN 1 AND 120),
  first_due date NOT NULL,
  competence_date date NOT NULL,
  category text NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 100),
  cost_center text CHECK (length(cost_center) <= 160),
  notes text CHECK (length(notes) <= 4000),
  generated_at timestamptz,
  created_by uuid NOT NULL DEFAULT public.office_finance_uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.office_finance_transfers (
  id uuid PRIMARY KEY,
  from_account uuid NOT NULL REFERENCES public.office_finance_accounts(id),
  to_account uuid NOT NULL REFERENCES public.office_finance_accounts(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  transferred_on date NOT NULL,
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 200),
  created_by uuid NOT NULL DEFAULT public.office_finance_uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_account <> to_account)
);

CREATE TABLE public.office_finance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL,
  entity_type text NOT NULL,
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  created_by uuid NOT NULL DEFAULT public.office_finance_uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX office_finance_history_entity ON public.office_finance_history(entity_id);

ALTER TABLE public.office_finance_entries
  ADD COLUMN cost_center text CHECK (length(cost_center) <= 160),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancellation_reason text CHECK (length(cancellation_reason) <= 500),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.office_finance_settlements
  ADD COLUMN account_id uuid REFERENCES public.office_finance_accounts(id),
  ADD COLUMN payment_method text NOT NULL DEFAULT 'other' CHECK (payment_method IN ('pix','cash','transfer','card','boleto','other')),
  ADD COLUMN reversed_at timestamptz,
  ADD COLUMN reversal_reason text CHECK (length(reversal_reason) <= 500);
GRANT INSERT (cost_center) ON public.office_finance_entries TO authenticated;
GRANT INSERT (account_id,payment_method) ON public.office_finance_settlements TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['office_finance_accounts','office_finance_registers','office_finance_agreements','office_finance_transfers','office_finance_history'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('CREATE POLICY admin_read ON public.%I FOR SELECT TO authenticated USING(public.has_role(public.office_finance_uid(),''admin''))', t);
  END LOOP;
END $$;

CREATE FUNCTION public.office_finance_require_admin() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF public.office_finance_uid() IS NULL OR NOT public.has_role(public.office_finance_uid(),'admin') THEN
    RAISE EXCEPTION 'Acesso restrito a administradores.' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION public.office_finance_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.office_finance_history(entity_id,entity_type,action,before_data,after_data)
  VALUES(NEW.id,TG_TABLE_NAME,TG_OP,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['office_finance_entries','office_finance_settlements','office_finance_accounts','office_finance_registers','office_finance_agreements','office_finance_transfers'] LOOP
    EXECUTE format('CREATE TRIGGER finance_audit AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.office_finance_audit()', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.office_finance_apply_settlement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.office_finance_require_admin();
  IF NEW.settled_on > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'A data da baixa não pode estar no futuro.';
  END IF;
  IF NEW.account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.office_finance_accounts WHERE id=NEW.account_id AND active AND opening_date<=NEW.settled_on
  ) THEN RAISE EXCEPTION 'Selecione uma conta ativa com abertura anterior à baixa.'; END IF;
  UPDATE public.office_finance_entries SET settled_cents=settled_cents+NEW.amount_cents,updated_at=now()
  WHERE id=NEW.entry_id AND cancelled_at IS NULL AND amount_cents-settled_cents>=NEW.amount_cents;
  IF NOT FOUND THEN RAISE EXCEPTION 'A baixa excede o saldo ou o lançamento está cancelado.'; END IF;
  RETURN NEW;
END $$;

-- All edits lock the entry, so editing, cancelling and settling serialize.
CREATE FUNCTION public.office_finance_edit_entry(target uuid, data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.office_finance_entries; amount integer;
BEGIN
  PERFORM public.office_finance_require_admin();
  SELECT * INTO STRICT e FROM public.office_finance_entries WHERE id=target FOR UPDATE;
  IF e.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Lançamento cancelado.'; END IF;
  amount:=(data->>'amount_cents')::integer;
  IF amount<e.settled_cents THEN RAISE EXCEPTION 'O valor não pode ser menor que as baixas registradas.'; END IF;
  UPDATE public.office_finance_entries SET
    description=trim(data->>'description'), category=trim(data->>'category'), cost_center=nullif(trim(data->>'cost_center'),''),
    supplier=nullif(trim(data->>'supplier'),''), notes=nullif(trim(data->>'notes'),''),
    amount_cents=amount, due_date=(data->>'due_date')::date, competence_date=(data->>'competence_date')::date,updated_at=now()
  WHERE id=target;
END $$;

CREATE FUNCTION public.office_finance_cancel_entry(target uuid, reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.office_finance_entries;
BEGIN
  PERFORM public.office_finance_require_admin();
  IF nullif(trim(reason),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.'; END IF;
  SELECT * INTO STRICT e FROM public.office_finance_entries WHERE id=target FOR UPDATE;
  IF e.settled_cents>0 THEN RAISE EXCEPTION 'Estorne as baixas antes de cancelar.'; END IF;
  IF e.cancelled_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.office_finance_entries SET cancelled_at=now(),cancellation_reason=reason,updated_at=now() WHERE id=target;
END $$;

CREATE FUNCTION public.office_finance_reverse_settlement(target uuid, reason text) RETURNS void
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
  UPDATE public.office_finance_entries SET settled_cents=settled_cents-s.amount_cents,updated_at=now() WHERE id=entry;
END $$;

CREATE FUNCTION public.office_finance_save_register(target uuid, register_kind text, data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.office_finance_require_admin();
  IF register_kind='account' THEN
    INSERT INTO public.office_finance_accounts(id,name,opening_cents,opening_date,active)
    VALUES(target,trim(data->>'name'),(data->>'opening_cents')::bigint,(data->>'opening_date')::date,coalesce((data->>'active')::boolean,true))
    ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,active=EXCLUDED.active;
    -- An account's opening balance/date remain immutable after creation.
  ELSE
    INSERT INTO public.office_finance_registers(id,kind,name,contact,notes,active)
    VALUES(target,register_kind,trim(data->>'name'),data->>'contact',data->>'notes',coalesce((data->>'active')::boolean,true))
    ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,contact=EXCLUDED.contact,notes=EXCLUDED.notes,active=EXCLUDED.active;
  END IF;
END $$;

CREATE FUNCTION public.office_finance_transfer(target uuid, data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d date:=(data->>'transferred_on')::date;
BEGIN
  PERFORM public.office_finance_require_admin();
  IF d>(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'A transferência não pode estar no futuro.'; END IF;
  IF (SELECT count(*) FROM public.office_finance_accounts
      WHERE id IN ((data->>'from_account')::uuid,(data->>'to_account')::uuid) AND active AND opening_date<=d)<>2 THEN
    RAISE EXCEPTION 'Selecione duas contas ativas com abertura anterior à transferência.';
  END IF;
  INSERT INTO public.office_finance_transfers(id,from_account,to_account,amount_cents,transferred_on,description)
  VALUES(target,(data->>'from_account')::uuid,(data->>'to_account')::uuid,(data->>'amount_cents')::integer,d,trim(data->>'description'))
  ON CONFLICT(id) DO NOTHING;
END $$;

CREATE FUNCTION public.office_finance_save_agreement(target uuid, agreement_kind text, data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE client uuid:=(data->>'client_id')::uuid; process uuid:=nullif(data->>'process_id','')::uuid;
BEGIN
  PERFORM public.office_finance_require_admin();
  IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=client) THEN RAISE EXCEPTION 'Selecione o cliente.'; END IF;
  IF process IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tasks WHERE id=process AND client_id=client AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'O processo deve pertencer ao cliente.';
  END IF;
  INSERT INTO public.office_finance_agreements(id,kind,description,client_id,process_id,amount_cents,periods,first_due,competence_date,category,cost_center,notes)
  VALUES(target,agreement_kind,trim(data->>'description'),client,process,(data->>'amount_cents')::integer,(data->>'periods')::integer,
    (data->>'first_due')::date,(data->>'competence_date')::date,trim(data->>'category'),nullif(trim(data->>'cost_center'),''),data->>'notes')
  ON CONFLICT(id) DO NOTHING;
END $$;

CREATE FUNCTION public.office_finance_agreement_action(target uuid, action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.office_finance_agreements; i integer; amount integer; due date; competence date;
BEGIN
  PERFORM public.office_finance_require_admin();
  SELECT * INTO STRICT a FROM public.office_finance_agreements WHERE id=target FOR UPDATE;
  IF a.kind='quote' AND (
    action='approve' AND a.status IN ('approved','active','closed')
    OR action='reject' AND a.status='rejected'
  ) THEN RETURN; END IF;
  IF action='close' AND a.status='closed' THEN RETURN; END IF;
  IF action IN ('approve','reject') AND a.kind='quote' AND a.status='draft' THEN
    UPDATE public.office_finance_agreements SET status=CASE action WHEN 'approve' THEN 'approved' ELSE 'rejected' END,updated_at=now() WHERE id=target;
    RETURN;
  END IF;
  IF action='generate' THEN
    IF a.generated_at IS NOT NULL THEN RETURN; END IF;
    IF NOT (a.kind='quote' AND a.status='approved' OR a.kind='recurring' AND a.status='draft') THEN
      RAISE EXCEPTION 'Aprove o orçamento antes de gerar o financeiro.';
    END IF;
    IF a.client_id IS NULL THEN RAISE EXCEPTION 'O cliente não está mais disponível.'; END IF;
    IF a.process_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.tasks WHERE id=a.process_id AND client_id=a.client_id AND deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'O processo não está mais disponível para este cliente.'; END IF;
    IF a.kind='quote' AND a.amount_cents<a.periods THEN RAISE EXCEPTION 'Cada parcela deve ter pelo menos um centavo.'; END IF;
    FOR i IN 0..a.periods-1 LOOP
      amount:=CASE WHEN a.kind='recurring' THEN a.amount_cents ELSE a.amount_cents/a.periods + CASE WHEN i<a.amount_cents%a.periods THEN 1 ELSE 0 END END;
      due:=(a.first_due + make_interval(months=>i))::date;
      competence:=CASE WHEN a.kind='recurring' THEN (a.competence_date+make_interval(months=>i))::date ELSE a.competence_date END;
      INSERT INTO public.office_finance_entries(group_id,installment,installment_count,kind,description,category,cost_center,notes,client_id,process_id,competence_date,due_date,amount_cents)
      VALUES(a.id,i+1,a.periods,'income',a.description,a.category,a.cost_center,a.notes,a.client_id,a.process_id,competence,due,amount);
    END LOOP;
    UPDATE public.office_finance_agreements SET generated_at=now(),status='active',updated_at=now() WHERE id=target;
    RETURN;
  END IF;
  IF action='close' AND a.status='active' THEN
    -- Lock in a consistent order with settlement/edit/reversal operations.
    PERFORM id FROM public.office_finance_entries WHERE group_id=target ORDER BY id FOR UPDATE;
    UPDATE public.office_finance_entries SET cancelled_at=now(),cancellation_reason='Encerramento do contrato',updated_at=now()
      WHERE group_id=target AND due_date>=(now() AT TIME ZONE 'America/Sao_Paulo')::date AND settled_cents=0 AND cancelled_at IS NULL;
    UPDATE public.office_finance_agreements SET status='closed',updated_at=now() WHERE id=target;
    RETURN;
  END IF;
  RAISE EXCEPTION 'Operação indisponível para esta situação.';
END $$;

-- Callable RPCs are explicitly granted. Internal trigger helpers stay private.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'office_finance_require_admin','office_finance_audit','office_finance_edit_entry','office_finance_cancel_entry',
      'office_finance_reverse_settlement','office_finance_save_register','office_finance_transfer',
      'office_finance_save_agreement','office_finance_agreement_action')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, authenticated',f.signature);
    IF f.proname NOT IN ('office_finance_require_admin','office_finance_audit') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
    END IF;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
