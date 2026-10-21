-- Run inside a transaction. Preserve technical exports privately, outside app lists.
CREATE SCHEMA IF NOT EXISTS migration_backup;
REVOKE ALL ON SCHEMA migration_backup FROM PUBLIC, anonymous, authenticated;
CREATE TABLE IF NOT EXISTS migration_backup.trello_source_exports (
  attachment_id uuid PRIMARY KEY,
  attachment jsonb NOT NULL,
  client_files jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON migration_backup.trello_source_exports FROM PUBLIC, anonymous, authenticated;

CREATE TEMP TABLE source_exports_to_archive ON COMMIT DROP AS
SELECT a.id FROM public.attachments a
JOIN storage.objects o ON o.bucket_id='task-attachments' AND o.name=a.storage_path
WHERE o.metadata->>'origin'='trello'
  AND o.metadata->>'source_id' LIKE 'export:%'
  AND a.file_name ~ '^Trello-original-cartao-[0-9]+[.]json$'
  AND a.mime_type='application/json'
  AND a.storage_path LIKE 'trello-import/%/original.json';

INSERT INTO migration_backup.trello_source_exports (attachment_id,attachment,client_files)
SELECT a.id,to_jsonb(a),COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM public.client_files f WHERE f.source_attachment_id=a.id),'[]'::jsonb)
FROM public.attachments a JOIN source_exports_to_archive e ON e.id=a.id
ON CONFLICT (attachment_id) DO NOTHING;

DELETE FROM public.client_files f USING source_exports_to_archive e
WHERE f.source_attachment_id=e.id;
DELETE FROM public.attachments a USING source_exports_to_archive e WHERE a.id=e.id;
-- Storage bytes stay intact for recovery. No original PDF, image or document is removed.
UPDATE public.tasks t SET description=replace(t.description,
  'Os documentos e a exportação original deste cartão estão nos anexos desta tarefa.',
  'Os documentos estão nos anexos desta tarefa. A exportação técnica original foi preservada no backup da migração.')
WHERE t.id IN (SELECT (b.attachment->>'task_id')::uuid FROM migration_backup.trello_source_exports b);
