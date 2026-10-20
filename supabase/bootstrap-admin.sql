-- APENAS no projeto Supabase novo da Magalhães, após aceitar o convite.
BEGIN;
DO $$
DECLARE
  admin_email text := 'SUBSTITUA_PELO_EMAIL_DO_ADMINISTRADOR';
  admin_id uuid;
  office_id uuid;
  permissions text[] := ARRAY['dashboard','tasks','conversations','obligations','meetings','import_ata','clients','crm','reports','mural','agenda','portal_entregas','portal_financeiro','users','trash','settings'];
BEGIN
  IF admin_email = 'SUBSTITUA_PELO_EMAIL_DO_ADMINISTRADOR' THEN RAISE EXCEPTION 'Preencha o email do administrador.'; END IF;
  SELECT id INTO office_id FROM public.workspaces WHERE slug = 'consultoria' AND name = 'Magalhães Advocacia';
  IF office_id IS NULL THEN RAISE EXCEPTION 'Instalação Magalhães não identificada. Confira o projeto e as migrations.'; END IF;
  SELECT id INTO admin_id FROM auth.users WHERE lower(email) = lower(admin_email) AND email_confirmed_at IS NOT NULL;
  IF admin_id IS NULL THEN RAISE EXCEPTION 'Usuário não encontrado ou convite ainda não aceito.'; END IF;
  DELETE FROM public.user_roles WHERE user_id = admin_id;
  INSERT INTO public.user_roles(user_id, role) VALUES (admin_id, 'admin');
  INSERT INTO public.user_permissions(user_id, permissions) VALUES (admin_id, permissions)
    ON CONFLICT(user_id) DO UPDATE SET permissions = EXCLUDED.permissions;
  INSERT INTO public.workspace_memberships(workspace_id, user_id, role, permissions, access_grant)
    VALUES (office_id, admin_id, 'admin', permissions, 'manual')
    ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, permissions = EXCLUDED.permissions;
  UPDATE public.profiles SET active_workspace_id = office_id WHERE id = admin_id;
END;
$$;
SELECT p.email, r.role, w.name FROM public.profiles p
JOIN public.user_roles r ON r.user_id = p.id
JOIN public.workspaces w ON w.id = p.active_workspace_id WHERE r.role = 'admin';
COMMIT;
