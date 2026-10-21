-- Neon owns auth's schema. authenticated cannot call it directly on PG17.
-- This bridge reads the identity already validated by the Data API; it never
-- accepts an identity parameter or grants access to the database credential.
CREATE FUNCTION public.neon_uid() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT auth.uid() $$;
REVOKE ALL ON FUNCTION public.neon_uid() FROM PUBLIC,anonymous;
GRANT EXECUTE ON FUNCTION public.neon_uid() TO authenticated;
DO $$ DECLARE r record; expression text; checks text; BEGIN
 FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','storage') AND p.proname<>'neon_uid' LOOP
  expression:=pg_get_functiondef(r.oid);
  IF expression LIKE '%auth.uid()%' THEN EXECUTE replace(expression,'auth.uid()','public.neon_uid()'); END IF;
 END LOOP;
 FOR r IN SELECT p.*,n.nspname,c.relname FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','storage') LOOP
  expression:=replace(pg_get_expr(r.polqual,r.polrelid),'auth.uid()','public.neon_uid()');
  checks:=replace(pg_get_expr(r.polwithcheck,r.polrelid),'auth.uid()','public.neon_uid()');
  EXECUTE format('ALTER POLICY %I ON %I.%I',r.polname,r.nspname,r.relname)||CASE WHEN expression IS NOT NULL THEN ' USING ('||expression||')' ELSE '' END||CASE WHEN checks IS NOT NULL THEN ' WITH CHECK ('||checks||')' ELSE '' END;
 END LOOP;
 FOR r IN SELECT n.nspname,c.relname,a.attname,pg_get_expr(d.adbin,d.adrelid) expression FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum JOIN pg_class c ON c.oid=d.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','storage') LOOP
  IF r.expression LIKE '%auth.uid()%' THEN EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT %s',r.nspname,r.relname,r.attname,replace(r.expression,'auth.uid()','public.neon_uid()')); END IF;
 END LOOP;
END $$;
