-- Read the same private objects under the caller's existing RLS permissions.
CREATE OR REPLACE FUNCTION public.neon_file_stat(bucket text,path text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('size',octet_length(payload),'mime',metadata->>'mimetype','version',updated_at)
  FROM storage.objects WHERE bucket_id=bucket AND name=path
$$;
CREATE OR REPLACE FUNCTION public.neon_file_chunk(bucket text,path text,byte_offset integer,byte_count integer,expected_version timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF byte_offset<0 OR byte_count<1 OR byte_count>4194304 THEN
    RAISE EXCEPTION 'Invalid file range' USING ERRCODE='22023';
  END IF;
  RETURN (SELECT jsonb_build_object('content',encode(substring(payload FROM byte_offset+1 FOR byte_count),'base64'))
    FROM storage.objects WHERE bucket_id=bucket AND name=path AND updated_at=expected_version);
END $$;
REVOKE ALL ON FUNCTION public.neon_file_stat(text,text),public.neon_file_chunk(text,text,integer,integer,timestamptz) FROM PUBLIC,anonymous;
GRANT EXECUTE ON FUNCTION public.neon_file_stat(text,text),public.neon_file_chunk(text,text,integer,integer,timestamptz) TO authenticated;
