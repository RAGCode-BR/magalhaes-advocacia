-- Ordem das colunas do funil, compartilhada por quem acessa o CRM no ambiente.
-- Sem posição salva, a coluna mantém a ordem padrão do sistema.
BEGIN;

ALTER TABLE public.crm_pipeline_stages
  ADD COLUMN position smallint CHECK (position IS NULL OR position BETWEEN 0 AND 50);

NOTIFY pgrst, 'reload schema';
COMMIT;
