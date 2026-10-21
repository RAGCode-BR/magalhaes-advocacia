CREATE OR REPLACE FUNCTION public.neon_admin_access(action text, data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid; email_address text; requested_role public.app_role; perms text[]; w uuid;
BEGIN
 IF NOT public.has_role(public.neon_uid(),'admin') THEN RAISE EXCEPTION 'Somente o administrador pode gerenciar acessos.'; END IF;
 SELECT id INTO w FROM public.workspaces WHERE slug='consultoria';
 IF action='create' THEN
  email_address:=lower(trim(data->>'email'));
  IF email_address IS NULL OR length(email_address)>254 OR email_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Informe um e-mail válido.'; END IF;
  IF nullif(trim(data->>'fullName'),'') IS NULL THEN RAISE EXCEPTION 'Informe o nome completo.'; END IF;
  IF coalesce(data->>'passwordHash','') !~ '^[0-9a-f]{32}:[0-9a-f]{128}$' THEN RAISE EXCEPTION 'Informe uma senha inicial válida.'; END IF;
  IF EXISTS(SELECT 1 FROM neon_auth."user" WHERE lower(email)=email_address) THEN RAISE EXCEPTION 'Este e-mail já possui acesso.'; END IF;
  requested_role:=coalesce(data->>'role','collaborator')::public.app_role;
  IF requested_role='client' AND NOT EXISTS(SELECT 1 FROM public.clients WHERE id=nullif(data->>'clientId','')::uuid AND workspace_id=w) THEN RAISE EXCEPTION 'Selecione um cliente deste ambiente.'; END IF;
  -- Only the administrator can enter here. Use the existing provisioning triggers,
  -- and never store plaintext passwords or password hashes in pending settings.
  INSERT INTO public.access_invitations(email,invited_by,expires_at) VALUES(email_address,public.neon_uid(),now()+interval '5 minutes') ON CONFLICT(email) DO UPDATE SET expires_at=EXCLUDED.expires_at,invited_by=EXCLUDED.invited_by;
  INSERT INTO magalhaes_private.pending_access(email,settings) VALUES(email_address,data-'password'-'passwordHash') ON CONFLICT(email) DO UPDATE SET settings=EXCLUDED.settings;
  target:=gen_random_uuid();
  INSERT INTO neon_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES(target,trim(data->>'fullName'),email_address,false,now(),now());
  INSERT INTO neon_auth.account("userId","accountId","providerId",password,"createdAt","updatedAt") VALUES(target,target::text,'credential',data->>'passwordHash',now(),now());
  RETURN jsonb_build_object('created',true,'userId',target,'email',email_address);
 END IF;
 target:=(data->>'userId')::uuid;
 IF action='update' THEN
  IF length(coalesce(data->>'password',''))>0 THEN RAISE EXCEPTION 'A senha deve ser alterada pelo próprio usuário usando a recuperação de acesso.'; END IF;
  requested_role:=coalesce(data->>'role','collaborator')::public.app_role;
  IF target=public.neon_uid() AND requested_role<>'admin' THEN RAISE EXCEPTION 'Mantenha seu acesso de administrador.'; END IF;
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
  IF target=public.neon_uid() THEN RAISE EXCEPTION 'Seu administrador não pode ser excluído.'; END IF;
  RAISE EXCEPTION 'Use Desativar para preservar o histórico deste usuário.';
 END IF;
 RAISE EXCEPTION 'Operação inválida';
END $$;

REVOKE ALL ON FUNCTION public.neon_admin_access(text,jsonb) FROM PUBLIC,anonymous;
GRANT EXECUTE ON FUNCTION public.neon_admin_access(text,jsonb) TO authenticated;
-- All account creation now goes through the authenticated administrator RPC.
UPDATE neon_auth.project_config SET email_and_password=email_and_password || '{"disableSignUp":true}'::jsonb,updated_at=now() WHERE endpoint_id='ep-weathered-hat-b4vy9dtp';
