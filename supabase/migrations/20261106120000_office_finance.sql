-- Run this migration on the Magalhães Neon database before publishing the UI.
BEGIN;

-- Neon resolves identity directly from PostgREST claims. The local Supabase
-- installation uses auth.uid() and does not define neon_uid().
DO $migration$
BEGIN
  IF to_regprocedure('public.neon_uid()') IS NOT NULL THEN
    CREATE FUNCTION public.office_finance_uid() RETURNS uuid LANGUAGE sql STABLE
      SET search_path = '' AS 'SELECT public.neon_uid()';
  ELSE
    CREATE FUNCTION public.office_finance_uid() RETURNS uuid LANGUAGE sql STABLE
      SET search_path = '' AS 'SELECT auth.uid()';
  END IF;
END;
$migration$;
REVOKE ALL ON FUNCTION public.office_finance_uid() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_finance_uid() TO authenticated;

CREATE TABLE public.office_finance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  installment integer NOT NULL,
  installment_count integer NOT NULL CHECK (installment_count BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('income', 'expense')),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 200),
  category text NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 100),
  supplier text CHECK (length(supplier) <= 160),
  notes text CHECK (length(notes) <= 4000),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  process_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  competence_date date NOT NULL,
  due_date date NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  settled_cents integer NOT NULL DEFAULT 0 CHECK (settled_cents BETWEEN 0 AND amount_cents),
  created_by uuid NOT NULL DEFAULT public.office_finance_uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, installment),
  CHECK (installment BETWEEN 1 AND installment_count)
);

CREATE TABLE public.office_finance_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.office_finance_entries(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  settled_on date NOT NULL,
  created_by uuid NOT NULL DEFAULT public.office_finance_uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX office_finance_settlements_entry_idx ON public.office_finance_settlements(entry_id);

CREATE TABLE public.office_finance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.office_finance_entries(id),
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  content_base64 text NOT NULL CHECK (length(content_base64) BETWEEN 1 AND 2796204),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX office_finance_documents_entry_idx ON public.office_finance_documents(entry_id);

ALTER TABLE public.office_finance_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_finance_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_finance_documents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.office_finance_entries, public.office_finance_settlements,
  public.office_finance_documents FROM PUBLIC, authenticated;
GRANT SELECT ON public.office_finance_entries, public.office_finance_settlements,
  public.office_finance_documents TO authenticated;
GRANT INSERT (id, group_id, installment, installment_count, kind, description, category, supplier,
  notes, client_id, process_id, competence_date, due_date, amount_cents)
  ON public.office_finance_entries TO authenticated;
GRANT INSERT (id, entry_id, amount_cents, settled_on) ON public.office_finance_settlements TO authenticated;
GRANT INSERT (id, entry_id, filename, content_base64) ON public.office_finance_documents TO authenticated;

CREATE POLICY office_entries_read ON public.office_finance_entries FOR SELECT TO authenticated
  USING (public.has_role(public.office_finance_uid(), 'admin'));
CREATE POLICY office_entries_create ON public.office_finance_entries FOR INSERT TO authenticated
  WITH CHECK (public.has_role(public.office_finance_uid(), 'admin')
    AND (kind <> 'income' OR client_id IS NOT NULL)
    AND (
    process_id IS NULL OR EXISTS (
      SELECT 1 FROM public.tasks WHERE id = process_id
        AND client_id = office_finance_entries.client_id AND deleted_at IS NULL
    )
  ));
CREATE POLICY office_settlements_read ON public.office_finance_settlements FOR SELECT TO authenticated
  USING (public.has_role(public.office_finance_uid(), 'admin'));
CREATE POLICY office_settlements_create ON public.office_finance_settlements FOR INSERT TO authenticated
  WITH CHECK (public.has_role(public.office_finance_uid(), 'admin'));
CREATE POLICY office_documents_read ON public.office_finance_documents FOR SELECT TO authenticated
  USING (public.has_role(public.office_finance_uid(), 'admin'));
CREATE POLICY office_documents_create ON public.office_finance_documents FOR INSERT TO authenticated
  WITH CHECK (public.has_role(public.office_finance_uid(), 'admin'));

CREATE FUNCTION public.office_finance_apply_settlement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.has_role(public.office_finance_uid(), 'admin') OR public.office_finance_uid() IS NULL THEN
    RAISE EXCEPTION 'Acesso restrito a administradores.' USING ERRCODE = '42501';
  END IF;
  IF NEW.settled_on > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'A data da baixa não pode estar no futuro.';
  END IF;

  -- The conditional update locks the row and rechecks the balance for concurrent requests.
  UPDATE public.office_finance_entries
    SET settled_cents = settled_cents + NEW.amount_cents
    WHERE id = NEW.entry_id AND amount_cents - settled_cents >= NEW.amount_cents;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O valor da baixa excede o saldo em aberto.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.office_finance_apply_settlement() FROM PUBLIC, authenticated;

CREATE TRIGGER office_finance_settlement_insert
AFTER INSERT ON public.office_finance_settlements
FOR EACH ROW EXECUTE FUNCTION public.office_finance_apply_settlement();

NOTIFY pgrst, 'reload schema';
COMMIT;
