-- Empty installation. No records or identities from the source system are copied.
CREATE SCHEMA magalhaes_private;
REVOKE ALL ON SCHEMA magalhaes_private FROM PUBLIC, authenticated, anonymous;
CREATE TABLE magalhaes_private.bootstrap_admin(email text PRIMARY KEY);
INSERT INTO public.workspaces(slug,name) VALUES ('consultoria','Magalhães Advocacia');

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE initial_admin boolean; invited boolean; w uuid;
BEGIN
 SELECT lower(NEW.email)=email INTO initial_admin FROM magalhaes_private.bootstrap_admin;
 initial_admin := coalesce(initial_admin,false);
 SELECT EXISTS(SELECT 1 FROM public.access_invitations WHERE email=lower(NEW.email) AND expires_at>now()) INTO invited;
 IF NOT initial_admin AND NOT invited THEN RAISE EXCEPTION 'Cadastro restrito. Solicite acesso ao administrador.'; END IF;
 DELETE FROM public.access_invitations WHERE email=lower(NEW.email);
 INSERT INTO public.user_roles(user_id,role) VALUES(NEW.id,CASE WHEN initial_admin THEN 'admin'::public.app_role ELSE 'collaborator'::public.app_role END);
 INSERT INTO public.user_permissions(user_id,permissions) VALUES(NEW.id,CASE WHEN initial_admin THEN ARRAY['dashboard','tasks','clients','users','agenda','meetings','reports','mural','crm','departments'] ELSE ARRAY['dashboard','tasks'] END);
 INSERT INTO public.profiles(id,full_name,email) VALUES(NEW.id,coalesce(NEW.name,split_part(NEW.email,'@',1)),NEW.email);
 RETURN NEW;
END $$;
CREATE TRIGGER magalhaes_signup AFTER INSERT ON neon_auth."user" FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Database RPCs are callable only by authenticated identities. Existing row policies
-- copied from the independent local instance govern all application CRUD.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anonymous;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anonymous;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
-- Configuration and server credentials must not be exposed by a blanket table grant.
REVOKE ALL ON public.calendar_google_connections,public.calendar_google_oauth_states,public.instagram_oauth_states,public.client_social_accounts FROM authenticated;
