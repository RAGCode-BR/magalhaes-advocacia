-- Identity comes from the JWT already validated by the Data API per request.
CREATE OR REPLACE FUNCTION public.neon_uid() RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
-- Authorized change: accounts use password login; invitation-only signup remains.
UPDATE neon_auth.project_config SET email_and_password = email_and_password ||
 '{"requireEmailVerification":false,"sendVerificationEmailOnSignIn":false,"sendVerificationEmailOnSignUp":false}'::jsonb,
 updated_at=now() WHERE endpoint_id='ep-weathered-hat-b4vy9dtp';
CREATE OR REPLACE FUNCTION public.neon_account_active() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN neon_auth."user" u ON u.id=p.id WHERE p.id=public.neon_uid() AND p.is_active AND NOT coalesce(u.banned,false))
$$;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id=r.user_id JOIN neon_auth."user" u ON u.id=r.user_id WHERE r.user_id=_user_id AND r.role=_role AND p.is_active AND NOT coalesce(u.banned,false))
$$;
