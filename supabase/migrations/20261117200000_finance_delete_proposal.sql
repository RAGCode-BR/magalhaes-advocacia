-- Exclusão de propostas.
-- A proposal can be deleted while it has not generated receivables. Once it has,
-- the entries in Contas a receber depend on it and deletion is refused. The CRM lead
-- is kept (it is the commercial history) but loses the deleted proposal document.
-- The deletion is recorded in office_finance_history with the removed row.

CREATE TRIGGER finance_audit_delete AFTER DELETE ON public.office_finance_agreements
  FOR EACH ROW EXECUTE FUNCTION public.office_finance_audit();

CREATE FUNCTION public.office_finance_delete_proposal(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.office_finance_agreements;
BEGIN
  PERFORM public.office_finance_require_admin();
  SELECT * INTO a FROM public.office_finance_agreements WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF; -- already deleted: retrying is harmless
  IF a.kind <> 'quote' THEN RAISE EXCEPTION 'Somente propostas podem ser excluídas.'; END IF;
  IF a.generated_at IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.office_finance_entries WHERE group_id = target
  ) THEN
    RAISE EXCEPTION 'Esta proposta já gerou lançamentos em Contas a receber e não pode ser excluída. Cancele os lançamentos no financeiro, se necessário.';
  END IF;
  UPDATE public.crm_opportunities SET proposal = NULL WHERE finance_agreement_id = target;
  DELETE FROM public.office_finance_agreements WHERE id = target;
END $$;

REVOKE ALL ON FUNCTION public.office_finance_delete_proposal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.office_finance_delete_proposal(uuid) TO authenticated;
