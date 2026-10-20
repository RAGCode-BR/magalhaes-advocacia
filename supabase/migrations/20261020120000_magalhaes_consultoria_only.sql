-- Executar SOMENTE no novo projeto Supabase da Magalhães.
-- Os slugs internos são preservados por compatibilidade com as regras do Taskfloww.
UPDATE public.workspaces SET name = 'Magalhães Advocacia' WHERE slug = 'consultoria';
ALTER TABLE public.profiles ALTER COLUMN color SET DEFAULT '#752832';

-- Este ambiente independente permite que seus administradores gerenciem a equipe.
CREATE OR REPLACE FUNCTION public.is_taskflow_access_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
$$;

CREATE OR REPLACE FUNCTION public.set_marketing_user_access(target_user_id uuid, enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Marketing não está disponível no sistema Magalhães Advocacia.';
END;
$$;
CREATE OR REPLACE FUNCTION public.set_marketing_admin_visibility(enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Marketing não está disponível no sistema Magalhães Advocacia.';
END;
$$;

-- Impede também concessões diretas por APIs autenticadas ou triggers legados.
CREATE OR REPLACE FUNCTION public.magalhaes_consultoria_only_membership()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = NEW.workspace_id AND slug = 'consultoria') THEN
    RAISE EXCEPTION 'Somente o ambiente da consultoria está habilitado.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER magalhaes_consultoria_only_membership
  BEFORE INSERT OR UPDATE ON public.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION public.magalhaes_consultoria_only_membership();
NOTIFY pgrst, 'reload schema';
