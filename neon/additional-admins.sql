-- Provision administrator roles only from the existing admin-only access RPC.
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
