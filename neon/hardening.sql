REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT(id,full_name,avatar_url,color,theme_preferences,created_at,updated_at,is_active,active_workspace_id) ON public.profiles TO authenticated;
CREATE FUNCTION public.neon_account_active() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN neon_auth."user" u ON u.id=p.id WHERE p.id=public.neon_uid() AND p.is_active AND u."emailVerified")
$$;
REVOKE ALL ON FUNCTION public.neon_account_active() FROM PUBLIC,anonymous;
GRANT EXECUTE ON FUNCTION public.neon_account_active() TO authenticated;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT tablename,schemaname FROM pg_tables WHERE schemaname IN ('public','storage') LOOP
 EXECUTE format('CREATE POLICY magalhaes_active_account ON %I.%I AS RESTRICTIVE TO authenticated USING (public.neon_account_active()) WITH CHECK (public.neon_account_active())',r.schemaname,r.tablename);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id=r.user_id JOIN neon_auth."user" u ON u.id=r.user_id WHERE r.user_id=_user_id AND r.role=_role AND p.is_active AND u."emailVerified")
$$;
