-- CRM com colunas livres e lixeira de propostas.
--
-- Colunas: crm_pipeline_stages passa a ser a fonte das colunas de cada ambiente.
-- Qualquer coluna pode ser criada, renomeada, reordenada e excluída, exceto a
-- coluna fixa "finalizado" ("Contrato fechado"), que é sempre a última e conta
-- como venda fechada no relatório do CRM.
--
-- Lixeira: excluir uma proposta (ou o lead dela no CRM) passa a ser exclusão
-- lógica nos dois registros. Restaurar traz os dois de volta; a exclusão
-- definitiva acontece só na lixeira. Lead só nasce de proposta. Propostas que geraram Contas a receber
-- continuam sem poder ser excluídas, por nenhum dos dois lados.
BEGIN;

-- ---------------------------------------------------------------- colunas
ALTER TABLE public.crm_opportunities DROP CONSTRAINT crm_opportunities_stage_check;
ALTER TABLE public.crm_pipeline_stages DROP CONSTRAINT crm_pipeline_stages_stage_id_check;
ALTER TABLE public.crm_pipeline_stages
  ADD CONSTRAINT crm_pipeline_stages_stage_id_check CHECK (stage_id ~ '^[a-z0-9_]{1,40}$');

CREATE FUNCTION public.crm_seed_pipeline_stages(target_workspace uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.crm_pipeline_stages (workspace_id, stage_id, label, color, position)
  SELECT target_workspace, s.stage_id, s.label, s.color, s.position
  FROM (VALUES
    ('atendendo', 'Atendendo', '#16a77e', 0),
    ('novo', 'Novos Leads', '#3278d4', 1),
    ('qualificado', 'Qualificados', '#5b45ad', 2),
    ('proposta', 'Proposta Enviada', '#f06e43', 3),
    ('negociacao', 'Em Negociação', '#e9a400', 4),
    ('finalizado', 'Contrato fechado', '#208b43', 50)
  ) AS s(stage_id, label, color, position)
  WHERE NOT EXISTS (SELECT 1 FROM public.crm_pipeline_stages p WHERE p.workspace_id = target_workspace)
  ON CONFLICT (workspace_id, stage_id) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.crm_seed_pipeline_stages(uuid) FROM PUBLIC, authenticated;

SELECT public.crm_seed_pipeline_stages(id) FROM public.workspaces;

-- Todo ambiente tem a coluna fixa, sempre no fim.
INSERT INTO public.crm_pipeline_stages (workspace_id, stage_id, label, color, position)
SELECT w.id, 'finalizado', 'Contrato fechado', '#208b43', 50 FROM public.workspaces w
ON CONFLICT (workspace_id, stage_id) DO UPDATE SET label = 'Contrato fechado', position = 50;

-- Colunas sem posição salva recebem a ordem atual (posição padrão do sistema).
UPDATE public.crm_pipeline_stages s SET position = d.position
FROM (VALUES ('atendendo', 0), ('novo', 1), ('qualificado', 2), ('proposta', 3), ('negociacao', 4)) AS d(stage_id, position)
WHERE s.stage_id = d.stage_id AND s.position IS NULL;

CREATE FUNCTION public.crm_seed_new_workspace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.crm_seed_pipeline_stages(NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER workspaces_seed_crm_stages AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.crm_seed_new_workspace();

-- Leads de colunas que não existem no ambiente vão para a primeira coluna.
UPDATE public.crm_opportunities o SET stage = (
  SELECT s.stage_id FROM public.crm_pipeline_stages s
  WHERE s.workspace_id = o.workspace_id AND s.stage_id <> 'finalizado'
  ORDER BY s.position NULLS LAST, s.stage_id LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM public.crm_pipeline_stages s WHERE s.workspace_id = o.workspace_id AND s.stage_id = o.stage);

ALTER TABLE public.crm_opportunities
  ADD CONSTRAINT crm_opportunities_stage_fkey FOREIGN KEY (workspace_id, stage)
  REFERENCES public.crm_pipeline_stages (workspace_id, stage_id);

-- Lead criado para uma coluna inexistente (ex.: proposta nova quando "novo"
-- foi excluída) entra na primeira coluna do funil.
CREATE FUNCTION public.crm_opportunity_default_stage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages s
    WHERE s.workspace_id = NEW.workspace_id AND s.stage_id = NEW.stage
  ) THEN
    SELECT s.stage_id INTO NEW.stage FROM public.crm_pipeline_stages s
    WHERE s.workspace_id = NEW.workspace_id AND s.stage_id <> 'finalizado'
    ORDER BY s.position NULLS LAST, s.stage_id LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_opportunities_default_stage BEFORE INSERT ON public.crm_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.crm_opportunity_default_stage();

-- A coluna fixa não muda de nome nem de cor.
CREATE FUNCTION public.crm_protect_final_stage() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.stage_id = 'finalizado' AND (NEW.stage_id <> OLD.stage_id OR NEW.label <> OLD.label OR NEW.color <> OLD.color) THEN
    RAISE EXCEPTION 'A coluna “Contrato fechado” é fixa e não pode ser alterada.';
  END IF;
  NEW.position := CASE WHEN NEW.stage_id = 'finalizado' THEN 50 ELSE least(NEW.position, 49) END;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_pipeline_stages_protect_final BEFORE UPDATE ON public.crm_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.crm_protect_final_stage();

-- Exclui uma coluna levando os leads dela (inclusive os da lixeira) para outra.
CREATE FUNCTION public.crm_delete_stage(target_workspace uuid, target_stage text, move_to text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.can_access_crm(target_workspace) THEN
    RAISE EXCEPTION 'Sem acesso ao CRM deste ambiente.' USING ERRCODE = '42501';
  END IF;
  IF target_stage = 'finalizado' THEN
    RAISE EXCEPTION 'A coluna “Contrato fechado” é fixa e não pode ser excluída.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_pipeline_stages WHERE workspace_id = target_workspace AND stage_id = target_stage) THEN
    RETURN; -- já excluída
  END IF;
  IF move_to IS NULL OR move_to = target_stage OR NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages WHERE workspace_id = target_workspace AND stage_id = move_to
  ) THEN
    RAISE EXCEPTION 'Escolha outra coluna para receber os leads.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages
    WHERE workspace_id = target_workspace AND stage_id NOT IN ('finalizado', target_stage)
  ) THEN
    RAISE EXCEPTION 'Mantenha ao menos uma coluna além de “Contrato fechado”.';
  END IF;
  UPDATE public.crm_opportunities SET stage = move_to
    WHERE workspace_id = target_workspace AND stage = target_stage;
  DELETE FROM public.crm_pipeline_stages WHERE workspace_id = target_workspace AND stage_id = target_stage;
END $$;
REVOKE ALL ON FUNCTION public.crm_delete_stage(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_delete_stage(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------- lixeira
ALTER TABLE public.crm_opportunities ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.office_finance_agreements
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid;

-- Registros na lixeira somem das telas comuns; a lixeira lê pelas funções abaixo.
DROP POLICY crm_opportunities_select ON public.crm_opportunities;
CREATE POLICY crm_opportunities_select ON public.crm_opportunities
  FOR SELECT TO authenticated USING (deleted_at IS NULL AND public.can_access_crm(workspace_id));
DROP POLICY crm_opportunities_update ON public.crm_opportunities;
CREATE POLICY crm_opportunities_update ON public.crm_opportunities
  FOR UPDATE TO authenticated USING (deleted_at IS NULL AND public.can_access_crm(workspace_id))
  WITH CHECK (deleted_at IS NULL AND public.can_access_crm(workspace_id));
-- Lead de proposta é excluído por crm_delete_opportunity, que leva a proposta à lixeira.
DROP POLICY crm_opportunities_delete ON public.crm_opportunities;
CREATE POLICY crm_opportunities_delete ON public.crm_opportunities
  FOR DELETE TO authenticated USING (finance_agreement_id IS NULL AND public.can_access_crm(workspace_id));

DROP POLICY admin_read ON public.office_finance_agreements;
CREATE POLICY admin_read ON public.office_finance_agreements
  FOR SELECT TO authenticated USING (deleted_at IS NULL AND public.has_role(public.office_finance_uid(), 'admin'));

CREATE FUNCTION public.office_finance_proposal_billed(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.office_finance_agreements WHERE id = target AND generated_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.office_finance_entries WHERE group_id = target);
$$;
REVOKE ALL ON FUNCTION public.office_finance_proposal_billed(uuid) FROM PUBLIC, authenticated;

-- Proposta e lead vão juntos para a lixeira.
CREATE FUNCTION public.office_finance_trash_proposal(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.office_finance_proposal_billed(target) THEN
    RAISE EXCEPTION 'Esta proposta já gerou lançamentos em Contas a receber e não pode ser excluída. Cancele os lançamentos no financeiro, se necessário.';
  END IF;
  UPDATE public.office_finance_agreements
    SET deleted_at = now(), deleted_by = public.office_finance_uid(), updated_at = now()
    WHERE id = target AND deleted_at IS NULL;
  UPDATE public.crm_opportunities SET deleted_at = now()
    WHERE finance_agreement_id = target AND deleted_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.office_finance_trash_proposal(uuid) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.office_finance_delete_proposal(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.office_finance_agreements;
BEGIN
  PERFORM public.office_finance_require_admin();
  SELECT * INTO a FROM public.office_finance_agreements WHERE id = target FOR UPDATE;
  IF NOT FOUND OR a.deleted_at IS NOT NULL THEN RETURN; END IF; -- repetir é inofensivo
  IF a.kind <> 'quote' THEN RAISE EXCEPTION 'Somente propostas podem ser excluídas.'; END IF;
  PERFORM public.office_finance_trash_proposal(target);
END $$;

-- Exclusão pelo CRM: lead de proposta vai para a lixeira junto com a proposta;
-- lead criado à mão continua sendo excluído de vez.
CREATE FUNCTION public.crm_delete_opportunity(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE lead public.crm_opportunities;
BEGIN
  SELECT * INTO lead FROM public.crm_opportunities WHERE id = target FOR UPDATE;
  IF NOT FOUND OR lead.deleted_at IS NOT NULL THEN RETURN; END IF;
  IF NOT public.can_access_crm(lead.workspace_id) THEN
    RAISE EXCEPTION 'Sem acesso ao CRM deste ambiente.' USING ERRCODE = '42501';
  END IF;
  IF lead.finance_agreement_id IS NULL THEN
    DELETE FROM public.crm_opportunities WHERE id = target;
    RETURN;
  END IF;
  IF public.office_finance_proposal_billed(lead.finance_agreement_id) THEN
    RAISE EXCEPTION 'A proposta deste lead já gerou lançamentos em Contas a receber, por isso o lead não pode ser excluído.';
  END IF;
  PERFORM public.office_finance_trash_proposal(lead.finance_agreement_id);
END $$;
REVOKE ALL ON FUNCTION public.crm_delete_opportunity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_delete_opportunity(uuid) TO authenticated;

CREATE FUNCTION public.office_finance_trashed_proposals()
RETURNS TABLE (
  id uuid, description text, client_id uuid, amount_cents integer, proposal jsonb,
  created_at timestamptz, deleted_at timestamptz, deleted_by uuid, lead_title text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.office_finance_require_admin();
  RETURN QUERY
    SELECT a.id, a.description, a.client_id, a.amount_cents, a.proposal, a.created_at,
      a.deleted_at, a.deleted_by, o.title
    FROM public.office_finance_agreements a
    LEFT JOIN public.crm_opportunities o ON o.finance_agreement_id = a.id
    WHERE a.deleted_at IS NOT NULL
    ORDER BY a.deleted_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.office_finance_trashed_proposals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_finance_trashed_proposals() TO authenticated;

CREATE FUNCTION public.office_finance_restore_proposal(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.office_finance_require_admin();
  UPDATE public.office_finance_agreements SET deleted_at = NULL, deleted_by = NULL, updated_at = now()
    WHERE id = target AND deleted_at IS NOT NULL;
  UPDATE public.crm_opportunities SET deleted_at = NULL
    WHERE finance_agreement_id = target AND deleted_at IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.office_finance_restore_proposal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_finance_restore_proposal(uuid) TO authenticated;

CREATE FUNCTION public.office_finance_purge_proposal(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.office_finance_agreements;
BEGIN
  PERFORM public.office_finance_require_admin();
  SELECT * INTO a FROM public.office_finance_agreements WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF; -- já excluída de vez
  IF a.deleted_at IS NULL THEN RAISE EXCEPTION 'Mande a proposta para a lixeira antes de excluí-la de vez.'; END IF;
  IF public.office_finance_proposal_billed(target) THEN
    RAISE EXCEPTION 'Esta proposta já gerou lançamentos em Contas a receber e não pode ser excluída.';
  END IF;
  DELETE FROM public.crm_opportunities WHERE finance_agreement_id = target;
  DELETE FROM public.office_finance_agreements WHERE id = target;
END $$;
REVOKE ALL ON FUNCTION public.office_finance_purge_proposal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_finance_purge_proposal(uuid) TO authenticated;

-- ------------------------------------------------- lead só nasce de proposta
-- Leads são criados por office_finance_save_agreement (proposta). Pelo CRM só
-- se muda a coluna do lead; nome, valor e contatos vêm da proposta.
DROP POLICY crm_opportunities_insert ON public.crm_opportunities;
REVOKE INSERT, UPDATE ON public.crm_opportunities FROM authenticated;
GRANT UPDATE (stage) ON public.crm_opportunities TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
