CREATE TABLE magalhaes_private.pending_access(email text PRIMARY KEY, settings jsonb NOT NULL);
CREATE FUNCTION public.neon_admin_access(action text, data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid; email_address text; requested_role public.app_role; perms text[]; w uuid;
BEGIN
 IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Somente o administrador pode gerenciar acessos.'; END IF;
 SELECT id INTO w FROM public.workspaces WHERE slug='consultoria';
 IF action='create' THEN
  email_address:=lower(trim(data->>'email'));
  IF email_address IS NULL OR email_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'E-mail inválido'; END IF;
  IF EXISTS(SELECT 1 FROM neon_auth."user" WHERE lower(email)=email_address) THEN RAISE EXCEPTION 'Este e-mail já possui acesso.'; END IF;
  IF coalesce(data->>'role','collaborator')='admin' THEN RAISE EXCEPTION 'O administrador inicial é exclusivo do titular.'; END IF;
  INSERT INTO public.access_invitations(email,invited_by,expires_at) VALUES(email_address,auth.uid(),now()+interval '7 days') ON CONFLICT(email) DO UPDATE SET expires_at=EXCLUDED.expires_at,invited_by=EXCLUDED.invited_by;
  INSERT INTO magalhaes_private.pending_access VALUES(email_address,data) ON CONFLICT(email) DO UPDATE SET settings=EXCLUDED.settings;
  RETURN jsonb_build_object('invited',true,'email',email_address);
 END IF;
 target:=(data->>'userId')::uuid;
 IF action='update' THEN
  IF length(coalesce(data->>'password',''))>0 THEN RAISE EXCEPTION 'A senha deve ser alterada pelo próprio usuário usando a recuperação de acesso.'; END IF;
  requested_role:=coalesce(data->>'role','collaborator')::public.app_role;
  IF target=auth.uid() AND requested_role<>'admin' THEN RAISE EXCEPTION 'Mantenha seu acesso de administrador.'; END IF;
  IF target<>auth.uid() AND requested_role='admin' THEN RAISE EXCEPTION 'O administrador inicial é exclusivo do titular.'; END IF;
  SELECT coalesce(array_agg(value),ARRAY[]::text[]) INTO perms FROM jsonb_array_elements_text(coalesce(data->'permissions','[]'::jsonb));
  UPDATE public.profiles SET full_name=coalesce(data->>'fullName',full_name) WHERE id=target;
  DELETE FROM public.user_roles WHERE user_id=target; INSERT INTO public.user_roles VALUES(gen_random_uuid(),target,requested_role);
  INSERT INTO public.user_permissions(user_id,permissions) VALUES(target,perms) ON CONFLICT(user_id) DO UPDATE SET permissions=EXCLUDED.permissions;
  UPDATE public.workspace_memberships SET role=requested_role,permissions=perms WHERE user_id=target AND workspace_id=w;
  DELETE FROM public.client_user_links WHERE user_id=target;
  IF requested_role='client' AND nullif(data->>'clientId','') IS NOT NULL THEN INSERT INTO public.client_user_links(user_id,client_id) VALUES(target,(data->>'clientId')::uuid); END IF;
  RETURN jsonb_build_object('permissions',perms);
 END IF;
 IF action='delete' THEN
  IF target=auth.uid() THEN RAISE EXCEPTION 'Seu administrador não pode ser excluído.'; END IF;
  RAISE EXCEPTION 'Use Desativar para preservar o histórico deste usuário.';
 END IF;
 RAISE EXCEPTION 'Operação inválida';
END $$;
CREATE OR REPLACE FUNCTION magalhaes_private.finish_invited_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE settings jsonb; requested_role public.app_role; perms text[]; w uuid;
BEGIN
 SELECT p.settings INTO settings FROM magalhaes_private.pending_access p WHERE p.email=lower(NEW.email);
 IF settings IS NULL THEN RETURN NEW; END IF;
 requested_role:=coalesce(settings->>'role','collaborator')::public.app_role;
 SELECT coalesce(array_agg(value),ARRAY[]::text[]) INTO perms FROM jsonb_array_elements_text(coalesce(settings->'permissions','[]'::jsonb));
 UPDATE public.profiles SET full_name=coalesce(settings->>'fullName',NEW.name) WHERE id=NEW.id;
 UPDATE public.user_roles SET role=requested_role WHERE user_id=NEW.id;
 UPDATE public.user_permissions SET permissions=perms WHERE user_id=NEW.id;
 UPDATE public.workspace_memberships SET role=requested_role,permissions=perms WHERE user_id=NEW.id;
 IF requested_role='client' AND nullif(settings->>'clientId','') IS NOT NULL THEN INSERT INTO public.client_user_links(user_id,client_id) VALUES(NEW.id,(settings->>'clientId')::uuid); END IF;
 DELETE FROM magalhaes_private.pending_access WHERE email=lower(NEW.email);
 RETURN NEW;
END $$;
CREATE TRIGGER zz_finish_invited_access AFTER INSERT ON neon_auth."user" FOR EACH ROW EXECUTE FUNCTION magalhaes_private.finish_invited_access();
REVOKE ALL ON FUNCTION public.neon_admin_access(text,jsonb) FROM PUBLIC,anonymous;
GRANT EXECUTE ON FUNCTION public.neon_admin_access(text,jsonb) TO authenticated;
