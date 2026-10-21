-- This capability changes task browsing only. It does not promote anyone,
-- change task participants, open conversations or grant another workspace.
ALTER TABLE public.workspace_memberships
  ADD COLUMN IF NOT EXISTS can_view_all_tasks boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workspace_memberships.can_view_all_tasks IS
  'Permite navegar pelas tarefas da equipe no Marketing. Não altera categoria, participação ou permissões de conversas.';

-- Cópia independente: não aplica concessões de usuários do sistema de origem.

NOTIFY pgrst, 'reload schema';
