-- Claude connector (mcp/). OAuth tokens carry no `role` claim, so the Data API treats them as
-- anonymous, and Neon does not let us grant the system role `authenticated` to another login.
-- taskflow_mcp_user mirrors authenticated's privileges and is added to every RLS policy that
-- applies to authenticated: the connector can only act as one verified user (via
-- request.jwt.claims.sub, read by neon_uid()), never bypass RLS or change the schema.
-- The login taskflow_mcp can only SET ROLE to it; its password is set outside this file.
-- Re-run after any migration that creates policies, tables or functions for authenticated.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='taskflow_mcp_user') THEN
  CREATE ROLE taskflow_mcp_user NOLOGIN NOINHERIT;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='taskflow_mcp') THEN
  CREATE ROLE taskflow_mcp LOGIN NOINHERIT;
 END IF;
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO taskflow_mcp', current_database());
END $$;
GRANT taskflow_mcp_user TO taskflow_mcp WITH INHERIT FALSE, SET TRUE;

DO $$ DECLARE r record; target oid:='authenticated'::regrole; BEGIN
 FOR r IN SELECT nspname FROM pg_namespace WHERE has_schema_privilege(target,oid,'USAGE')
   AND nspname IN ('public','storage') LOOP
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO taskflow_mcp_user',r.nspname);
 END LOOP;
 FOR r IN SELECT n.nspname,c.relname,a.privilege_type FROM pg_class c
   JOIN pg_namespace n ON n.oid=c.relnamespace, aclexplode(c.relacl) a
   WHERE a.grantee=target AND n.nspname IN ('public','storage') LOOP
  EXECUTE format('GRANT %s ON %I.%I TO taskflow_mcp_user',r.privilege_type,r.nspname,r.relname);
 END LOOP;
 -- Column grants too: profiles exposes only some columns (email stays hidden, see hardening.sql).
 FOR r IN SELECT n.nspname,c.relname,a.attname,x.privilege_type FROM pg_attribute a
   JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace, aclexplode(a.attacl) x
   WHERE x.grantee=target AND a.attnum>0 AND NOT a.attisdropped AND n.nspname IN ('public','storage') LOOP
  EXECUTE format('GRANT %s (%I) ON %I.%I TO taskflow_mcp_user',r.privilege_type,r.attname,r.nspname,r.relname);
 END LOOP;
 FOR r IN SELECT p.oid::regprocedure fn FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace, aclexplode(p.proacl) a
   WHERE a.grantee=target AND a.privilege_type='EXECUTE' AND n.nspname IN ('public','storage') LOOP
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO taskflow_mcp_user',r.fn);
 END LOOP;
 FOR r IN SELECT schemaname,tablename,policyname,roles FROM pg_policies
   WHERE 'authenticated'=ANY(roles) AND NOT 'taskflow_mcp_user'=ANY(roles) LOOP
  EXECUTE format('ALTER POLICY %I ON %I.%I TO %s',r.policyname,r.schemaname,r.tablename,
   (SELECT string_agg(quote_ident(x),',') FROM unnest(r.roles||'taskflow_mcp_user'::name) x));
 END LOOP;
END $$;
