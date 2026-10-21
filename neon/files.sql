CREATE SCHEMA storage;
REVOKE ALL ON SCHEMA storage FROM PUBLIC, anonymous;
CREATE TABLE storage.objects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text NOT NULL,name text NOT NULL,
 owner uuid DEFAULT auth.uid(), owner_id text DEFAULT auth.uid()::text,
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
 metadata jsonb DEFAULT '{}', payload bytea NOT NULL, UNIQUE(bucket_id,name),
 CONSTRAINT max_file_size CHECK(octet_length(payload)<=52428800)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
CREATE POLICY client_reference_images_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'client-references'::text) AND public.can_access_client_reference_file(name) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'collaborator'::public.app_role))));


--
-- Name: objects client_reference_images_insert; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY client_reference_images_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'client-references'::text) AND public.can_access_client_reference_file(name) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'collaborator'::public.app_role))));


--
-- Name: objects client_reference_images_read; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY client_reference_images_read ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'client-references'::text) AND public.can_access_client_reference_file(name)));


--
-- Name: iceberg_namespaces; Type: ROW SECURITY; Schema: storage; Owner: -
--



--
-- Name: iceberg_tables; Type: ROW SECURITY; Schema: storage; Owner: -
--



--
-- Name: objects invoice_documents_delete; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY invoice_documents_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'invoice-documents'::text) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'collaborator'::public.app_role))));


--
-- Name: objects invoice_documents_read; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY invoice_documents_read ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'invoice-documents'::text) AND (EXISTS ( SELECT 1
   FROM public.client_invoices invoice
  WHERE (((invoice.id)::text = (storage.foldername(objects.name))[1]) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'collaborator'::public.app_role) OR (public.has_role(auth.uid(), 'client'::public.app_role) AND (invoice.client_id = public.current_client_id()))))))));


--
-- Name: objects invoice_documents_upload; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY invoice_documents_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'invoice-documents'::text) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'collaborator'::public.app_role))));


--
-- Name: objects meeting_artifacts_team_download; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY meeting_artifacts_team_download ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'meeting-artifacts'::text) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'collaborator'::public.app_role)) AND ((EXISTS ( SELECT 1
   FROM public.meeting_minutes minutes
  WHERE (minutes.file_path = objects.name))) OR (EXISTS ( SELECT 1
   FROM public.meeting_transcripts transcript
  WHERE (transcript.file_path = objects.name))))));


--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: -
--



--
-- Name: objects mural_attachments_delete; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY mural_attachments_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'mural-attachments'::text) AND (EXISTS ( SELECT 1
   FROM (public.mural_post_attachments attachment
     JOIN public.mural_posts post ON ((post.id = attachment.post_id)))
  WHERE ((attachment.storage_path = objects.name) AND ((post.created_by = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)))))));


--
-- Name: objects mural_attachments_read; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY mural_attachments_read ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'mural-attachments'::text) AND (EXISTS ( SELECT 1
   FROM (public.mural_post_attachments attachment
     JOIN public.mural_posts post ON ((post.id = attachment.post_id)))
  WHERE ((attachment.storage_path = objects.name) AND (NOT public.has_role(auth.uid(), 'client'::public.app_role)))))));


--
-- Name: objects mural_attachments_upload; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY mural_attachments_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'mural-attachments'::text) AND (owner = auth.uid())));


--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: objects profile_avatars_delete_own; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY profile_avatars_delete_own ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'profile-avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));


--
-- Name: objects profile_avatars_insert_own; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY profile_avatars_insert_own ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'profile-avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));


--
-- Name: objects profile_avatars_select; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY profile_avatars_select ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'profile-avatars'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));


--
-- Name: objects profile_avatars_update_own; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY profile_avatars_update_own ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'profile-avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))) WITH CHECK (((bucket_id = 'profile-avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));


--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: -
--



--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: -
--



--
-- Name: objects service_request_files_delete; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY service_request_files_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'service-request-attachments'::text) AND (owner = auth.uid())));


--
-- Name: objects service_request_files_read; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY service_request_files_read ON storage.objects FOR SELECT TO authenticated USING ((bucket_id = 'service-request-attachments'::text));


--
-- Name: objects service_request_files_upload; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY service_request_files_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'service-request-attachments'::text) AND (owner = auth.uid())));


--
-- Name: objects task_attachments_delete_staff_or_owner; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY task_attachments_delete_staff_or_owner ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'task-attachments'::text) AND ((owner = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.attachments attachment
  WHERE ((attachment.storage_path = objects.name) AND (attachment.uploaded_by = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.comment_attachments attachment
  WHERE ((attachment.storage_path = objects.name) AND (attachment.uploaded_by = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.client_note_attachments attachment
  WHERE ((attachment.storage_path = objects.name) AND (attachment.uploaded_by = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.client_files file
  WHERE ((file.storage_path = objects.name) AND (file.uploaded_by = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.client_department_employee_attachments attachment
  WHERE ((attachment.storage_path = objects.name) AND public.has_role(auth.uid(), 'collaborator'::public.app_role)))))));


--
-- Name: objects task_attachments_insert_auth; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY task_attachments_insert_auth ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'task-attachments'::text) AND (auth.uid() = owner)));


--
-- Name: objects task_attachments_select_auth; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY task_attachments_select_auth ON storage.objects FOR SELECT TO authenticated USING ((bucket_id = 'task-attachments'::text));


--
-- Name: objects task_attachments_update_own; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY task_attachments_update_own ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'task-attachments'::text) AND (owner = auth.uid()))) WITH CHECK (((bucket_id = 'task-attachments'::text) AND (owner = auth.uid())));


--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: -
--



--
-- PostgreSQL database dump complete
--


GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO authenticated;
CREATE FUNCTION public.neon_file_upload(bucket text,path text,content text,mime text,overwrite boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$ BEGIN
 IF overwrite THEN
 INSERT INTO storage.objects(bucket_id,name,payload,metadata) VALUES(bucket,path,decode(content,'base64'),jsonb_build_object('mimetype',mime))
 ON CONFLICT(bucket_id,name) DO UPDATE SET payload=EXCLUDED.payload,metadata=EXCLUDED.metadata,updated_at=now();
 ELSE INSERT INTO storage.objects(bucket_id,name,payload,metadata) VALUES(bucket,path,decode(content,'base64'),jsonb_build_object('mimetype',mime)); END IF;
 RETURN jsonb_build_object('path',path);
END $$;
CREATE FUNCTION public.neon_file_download(bucket text,path text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('content',encode(payload,'base64'),'mime',metadata->>'mimetype') FROM storage.objects WHERE bucket_id=bucket AND name=path
$$;
CREATE FUNCTION public.neon_file_remove(bucket text,paths text[]) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$ DELETE FROM storage.objects WHERE bucket_id=bucket AND name=ANY(paths) $$;
REVOKE ALL ON FUNCTION public.neon_file_upload(text,text,text,text,boolean),public.neon_file_download(text,text),public.neon_file_remove(text,text[]) FROM PUBLIC,anonymous;
GRANT EXECUTE ON FUNCTION public.neon_file_upload(text,text,text,text,boolean),public.neon_file_download(text,text),public.neon_file_remove(text,text[]) TO authenticated;

-- Read only files owned by the caller, visible through a protected application
-- record, or accessible to the administrator. Each subquery retains table RLS.
ALTER POLICY task_attachments_select_auth ON storage.objects USING (
 bucket_id='task-attachments' AND (owner=auth.uid() OR public.has_role(auth.uid(),'admin')
 OR EXISTS(SELECT 1 FROM public.attachments a WHERE a.storage_path=objects.name)
 OR EXISTS(SELECT 1 FROM public.subtask_attachments a WHERE a.storage_path=objects.name)
 OR EXISTS(SELECT 1 FROM public.comment_attachments a WHERE a.storage_path=objects.name)
 OR EXISTS(SELECT 1 FROM public.client_files a WHERE a.storage_path=objects.name)
 OR EXISTS(SELECT 1 FROM public.client_note_attachments a WHERE a.storage_path=objects.name)
 OR EXISTS(SELECT 1 FROM public.client_department_employee_attachments a WHERE a.storage_path=objects.name)
 OR EXISTS(SELECT 1 FROM public.service_request_attachments a WHERE a.storage_path=objects.name))
);
