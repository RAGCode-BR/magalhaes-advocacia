-- Plano de contas e lançamentos avulsos.
-- Categories become chart-of-accounts items with an optional hierarchical code
-- ("1", "1.1", "1.1.01") and a nature (receita/despesa). Entries keep storing the
-- category name, so existing records and reports remain valid.

ALTER TABLE public.office_finance_registers
  ADD COLUMN code text CHECK (code ~ '^[0-9]{1,3}(\.[0-9]{1,3}){0,4}$'),
  ADD COLUMN nature text CHECK (nature IN ('income','expense'));
CREATE UNIQUE INDEX office_finance_register_code
  ON public.office_finance_registers(kind, code) WHERE code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.office_finance_save_register(target uuid, register_kind text, data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.office_finance_require_admin();
  IF register_kind='account' THEN
    INSERT INTO public.office_finance_accounts(id,name,opening_cents,opening_date,active)
    VALUES(target,trim(data->>'name'),(data->>'opening_cents')::bigint,(data->>'opening_date')::date,coalesce((data->>'active')::boolean,true))
    ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,active=EXCLUDED.active;
    -- An account's opening balance/date remain immutable after creation.
  ELSE
    INSERT INTO public.office_finance_registers(id,kind,name,contact,notes,active,code,nature)
    VALUES(target,register_kind,trim(data->>'name'),data->>'contact',data->>'notes',coalesce((data->>'active')::boolean,true),
      CASE WHEN register_kind='category' THEN nullif(trim(data->>'code'),'') END,
      CASE WHEN register_kind='category' THEN nullif(data->>'nature','') END)
    ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,contact=EXCLUDED.contact,notes=EXCLUDED.notes,
      active=EXCLUDED.active,code=EXCLUDED.code,nature=EXCLUDED.nature;
  END IF;
END $$;

-- Income no longer requires a client: rent refunds, interest, reimbursements and
-- other office revenue are recorded without being a fee (honorário).
DROP POLICY office_entries_create ON public.office_finance_entries;
CREATE POLICY office_entries_create ON public.office_finance_entries FOR INSERT TO authenticated
  WITH CHECK (public.has_role(public.office_finance_uid(), 'admin')
    AND (
    process_id IS NULL OR EXISTS (
      SELECT 1 FROM public.tasks WHERE id = process_id
        AND client_id = office_finance_entries.client_id AND deleted_at IS NULL
    )
  ));
