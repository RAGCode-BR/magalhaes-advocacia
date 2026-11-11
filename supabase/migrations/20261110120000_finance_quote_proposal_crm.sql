-- Proposta de honorários estruturada e vínculo orçamento ↔ CRM.
-- Rode no banco Neon da Magalhães antes de publicar a interface.
--
-- * office_finance_agreements.proposal guarda o documento da proposta (escopo,
--   exclusões, modalidade, validade e dados do contratante) usado no PDF.
-- * Orçamentos podem ser feitos para um cliente cadastrado ou para um novo
--   contato sem cadastro (nome e contatos ficam em proposal.client). Antes de
--   gerar o financeiro, o orçamento de um novo contato é vinculado a um cliente.
-- * Cada orçamento novo cria um lead na etapa "novo" do CRM, com uma cópia da
--   proposta para quem tem acesso ao CRM mas não ao financeiro (o financeiro
--   continua restrito a administradores).
BEGIN;

ALTER TABLE public.office_finance_agreements
  ADD COLUMN proposal jsonb CHECK (proposal IS NULL OR (jsonb_typeof(proposal) = 'object' AND pg_column_size(proposal) <= 65536)),
  ADD COLUMN crm_opportunity_id uuid REFERENCES public.crm_opportunities(id) ON DELETE SET NULL;

ALTER TABLE public.crm_opportunities
  ADD COLUMN finance_agreement_id uuid UNIQUE REFERENCES public.office_finance_agreements(id) ON DELETE SET NULL,
  ADD COLUMN proposal jsonb CHECK (proposal IS NULL OR (jsonb_typeof(proposal) = 'object' AND pg_column_size(proposal) <= 65536));

CREATE OR REPLACE FUNCTION public.office_finance_save_agreement(target uuid, agreement_kind text, data jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  client uuid := nullif(data->>'client_id','')::uuid;
  process uuid := nullif(data->>'process_id','')::uuid;
  doc jsonb := CASE WHEN jsonb_typeof(data->'proposal') = 'object' THEN data->'proposal' END;
  prospect text := left(nullif(trim(doc->'client'->>'name'), ''), 180);
  c record;
  lead_workspace uuid;
  lead uuid;
BEGIN
  PERFORM public.office_finance_require_admin();
  IF client IS NULL THEN
    -- Novo contato, sem cadastro: permitido apenas em orçamentos.
    IF agreement_kind <> 'quote' OR prospect IS NULL THEN RAISE EXCEPTION 'Selecione o cliente.'; END IF;
    IF process IS NOT NULL THEN RAISE EXCEPTION 'O processo deve pertencer ao cliente.'; END IF;
    SELECT NULL::uuid AS id, NULL::text AS name, NULL::uuid AS workspace_id, NULL::text AS email, NULL::text AS phone INTO c;
  ELSE
    SELECT id, name, workspace_id, email, phone INTO c FROM public.clients WHERE id = client;
    IF NOT FOUND THEN RAISE EXCEPTION 'Selecione o cliente.'; END IF;
    IF process IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tasks WHERE id=process AND client_id=client AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'O processo deve pertencer ao cliente.';
    END IF;
  END IF;
  INSERT INTO public.office_finance_agreements(id,kind,description,client_id,process_id,amount_cents,periods,first_due,competence_date,category,cost_center,notes,proposal)
  VALUES(target,agreement_kind,trim(data->>'description'),client,process,(data->>'amount_cents')::integer,(data->>'periods')::integer,
    (data->>'first_due')::date,(data->>'competence_date')::date,trim(data->>'category'),nullif(trim(data->>'cost_center'),''),data->>'notes',
    CASE WHEN agreement_kind='quote' THEN doc END)
  ON CONFLICT(id) DO NOTHING;
  -- Reenvio do mesmo formulário: nada mais a fazer.
  IF NOT FOUND OR agreement_kind <> 'quote' THEN RETURN; END IF;

  -- O lead fica no ambiente do cliente; sem ambiente (ou sem cadastro), no ambiente ativo.
  lead_workspace := coalesce(c.workspace_id, nullif(data->>'workspace_id','')::uuid);
  IF lead_workspace IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id = lead_workspace) THEN RETURN; END IF;

  INSERT INTO public.crm_opportunities(
    workspace_id, title, client_id, company_name, contact_email, contact_phone,
    stage, source, amount, notes, created_by, finance_agreement_id, proposal)
  VALUES (
    lead_workspace,
    left(trim(data->>'description'), 180),
    CASE WHEN c.workspace_id = lead_workspace THEN c.id END,
    coalesce(left(nullif(trim(c.name), ''), 180), prospect),
    coalesce(nullif(trim(doc->>'contact_email'), ''), c.email),
    coalesce(nullif(trim(doc->>'contact_phone'), ''), c.phone),
    'novo',
    'Orçamento',
    (data->>'amount_cents')::numeric / 100,
    nullif(trim(data->>'notes'), ''),
    public.office_finance_uid(),
    target,
    doc
  )
  RETURNING id INTO lead;
  UPDATE public.office_finance_agreements SET crm_opportunity_id = lead WHERE id = target;
END $$;

-- Vincula o orçamento de um novo contato ao cliente cadastrado, para permitir
-- gerar o financeiro. O lead do CRM passa a apontar para o mesmo cliente.
CREATE FUNCTION public.office_finance_link_agreement_client(target uuid, client uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.office_finance_agreements; c record;
BEGIN
  PERFORM public.office_finance_require_admin();
  SELECT * INTO a FROM public.office_finance_agreements WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado.'; END IF;
  IF a.client_id = client THEN RETURN; END IF;
  IF a.client_id IS NOT NULL THEN RAISE EXCEPTION 'Este orçamento já tem um cliente vinculado.'; END IF;
  IF a.generated_at IS NOT NULL THEN RAISE EXCEPTION 'O financeiro deste orçamento já foi gerado.'; END IF;
  SELECT id, workspace_id INTO c FROM public.clients WHERE id = client;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecione o cliente.'; END IF;
  UPDATE public.office_finance_agreements SET client_id = client, updated_at = now() WHERE id = target;
  UPDATE public.crm_opportunities SET client_id = client
    WHERE finance_agreement_id = target AND client_id IS NULL AND workspace_id = c.workspace_id;
END $$;
REVOKE ALL ON FUNCTION public.office_finance_link_agreement_client(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_finance_link_agreement_client(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
