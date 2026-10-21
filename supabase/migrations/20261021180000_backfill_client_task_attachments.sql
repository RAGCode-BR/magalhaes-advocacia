-- Share the existing object; never copy the document's bytes into a second file.
INSERT INTO public.client_files
  (client_id,title,file_name,storage_path,mime_type,size_bytes,uploaded_by,created_at,position,source_attachment_id)
SELECT t.client_id,a.file_name,a.file_name,a.storage_path,a.mime_type,a.size_bytes,
       a.uploaded_by,a.created_at,
       COALESCE((SELECT max(f.position)+1 FROM public.client_files f WHERE f.client_id=t.client_id),0)
         + (row_number() OVER (PARTITION BY t.client_id ORDER BY a.created_at,a.id)-1)::integer,
       a.id
FROM public.attachments a JOIN public.tasks t ON t.id=a.task_id
WHERE t.client_id IS NOT NULL
  AND a.mime_type IS DISTINCT FROM 'text/uri-list'
  AND NOT EXISTS (SELECT 1 FROM public.client_files f WHERE f.source_attachment_id=a.id)
ON CONFLICT (source_attachment_id) WHERE source_attachment_id IS NOT NULL DO NOTHING;
