--
-- PostgreSQL database dump
--

\restrict EBT8UmETBGEMYCfWB41YTMXzzev1M6wa4xLHJ6ZwdjyKQ31923NtqABTaVaP0ow

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = on;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'collaborator',
    'client'
);


--
-- Name: task_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_priority AS ENUM (
    'low',
    'medium',
    'high',
    'urgent'
);


--
-- Name: task_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_status AS ENUM (
    'todo',
    'in_progress',
    'review',
    'done'
);


--
-- Name: add_mentioned_as_collaborator(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_mentioned_as_collaborator() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_task_id uuid;
  v_author uuid;
  v_workspace uuid;
  v_count int;
BEGIN
  SELECT c.task_id, c.author_id INTO v_task_id, v_author
  FROM public.comments c
  WHERE c.id = NEW.comment_id;
  IF v_task_id IS NULL THEN RETURN NEW; END IF;

  -- Já é o responsável da tarefa.
  IF EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = v_task_id AND t.assignee_id = NEW.mentioned_user_id
  ) THEN
    RETURN NEW;
  END IF;

  -- Já é colaborador.
  IF EXISTS (
    SELECT 1 FROM public.task_collaborators tc
    WHERE tc.task_id = v_task_id AND tc.collaborator_id = NEW.mentioned_user_id
  ) THEN
    RETURN NEW;
  END IF;

  -- A pessoa precisa pertencer ao ambiente da tarefa.
  SELECT t.workspace_id INTO v_workspace FROM public.tasks t WHERE t.id = v_task_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = v_workspace AND m.user_id = NEW.mentioned_user_id
  ) THEN
    RETURN NEW;
  END IF;

  -- Teto de 3 colaboradores.
  SELECT count(*) INTO v_count FROM public.task_collaborators WHERE task_id = v_task_id;
  IF v_count >= 3 THEN RETURN NEW; END IF;

  INSERT INTO public.task_collaborators (task_id, collaborator_id, added_by)
  VALUES (v_task_id, NEW.mentioned_user_id, v_author)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;


--
-- Name: add_profile_to_consultoria(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_profile_to_consultoria() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE consultoria_id UUID;
BEGIN
  SELECT id INTO consultoria_id FROM public.workspaces WHERE slug = 'consultoria';
  INSERT INTO public.workspace_memberships (workspace_id, user_id, role, permissions)
  VALUES (
    consultoria_id,
    NEW.id,
    COALESCE((SELECT role FROM public.user_roles WHERE user_id = NEW.id LIMIT 1), 'collaborator'::public.app_role),
    COALESCE((SELECT permissions FROM public.user_permissions WHERE user_id = NEW.id), ARRAY[]::TEXT[])
  ) ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET active_workspace_id = consultoria_id WHERE id = NEW.id;
  RETURN NEW;
END;
$$;


--
-- Name: admin_get_profile_emails(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_profile_emails() RETURNS TABLE(id uuid, email text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT p.id, p.email
  FROM public.profiles p
  WHERE public.has_role(auth.uid(), 'admin');
$$;


--
-- Name: archive_inactive_client_operations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.archive_inactive_client_operations() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF OLD.is_active IS DISTINCT FROM false AND NEW.is_active = false THEN
    UPDATE public.tasks
    SET archived_at = now(), archived_reason = 'client_inactive'
    WHERE client_id = NEW.id
      AND archived_at IS NULL
      AND deleted_at IS NULL;

    -- Sem essa pausa, o materializador continuaria criando tarefas para um
    -- cliente cuja operacao ja foi encerrada.
    UPDATE public.obligations
    SET is_active = false
    WHERE client_id = NEW.id
      AND is_active = true;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: assign_current_workspace(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_current_workspace() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  marketing_id uuid;
  consultoria_id uuid;
  is_directory_mirror boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.workspace_id IS NULL THEN
    NEW.workspace_id := public.current_workspace_id();
  END IF;

  -- Use JSON for this optional field because this function also serves
  -- tables whose row type does not include source_client_id.
  IF TG_TABLE_NAME = 'clients'
     AND pg_trigger_depth() > 1
     AND (to_jsonb(NEW) ->> 'source_client_id') IS NOT NULL THEN
    SELECT id INTO marketing_id FROM public.workspaces WHERE slug = 'marketing';
    SELECT id INTO consultoria_id FROM public.workspaces WHERE slug = 'consultoria';
    is_directory_mirror := NEW.workspace_id = marketing_id
      AND EXISTS (
        SELECT 1
        FROM public.clients AS source_client
        WHERE source_client.id = (to_jsonb(NEW) ->> 'source_client_id')::uuid
          AND source_client.workspace_id = consultoria_id
      );
  END IF;

  IF NOT public.has_workspace_access(NEW.workspace_id) AND NOT is_directory_mirror THEN
    RAISE EXCEPTION 'You cannot write records in this TaskFlow environment';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: assign_task_workspace(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_task_workspace() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  resolved_column uuid;
  resolved_status uuid;
  resolved_client uuid;
BEGIN
  -- Migrations e rotinas de servidor rodam sem JWT de usuário final.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF NEW.workspace_id IS NULL THEN
    NEW.workspace_id := public.current_workspace_id();
  END IF;

  IF NOT public.can_create_in_workspace(NEW.workspace_id) THEN
    RAISE EXCEPTION 'Você não pode lançar tarefas neste ambiente do TaskFlow';
  END IF;

  -- Ambiente de onde a tarefa saiu. Sem sessão de usuário, cai no próprio
  -- ambiente da tarefa, para o espelho nunca disparar por acidente.
  IF TG_OP = 'INSERT' AND NEW.origin_workspace_id IS NULL THEN
    NEW.origin_workspace_id := COALESCE(public.current_workspace_id(), NEW.workspace_id);
  END IF;

  IF NEW.column_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.kanban_columns
    WHERE id = NEW.column_id AND workspace_id = NEW.workspace_id
  ) THEN
    SELECT id INTO resolved_column
    FROM public.kanban_columns
    WHERE workspace_id = NEW.workspace_id
    ORDER BY position, created_at
    LIMIT 1;
    NEW.column_id := resolved_column;
  END IF;

  IF NEW.status_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.task_statuses
    WHERE id = NEW.status_id AND workspace_id = NEW.workspace_id
  ) THEN
    SELECT id INTO resolved_status
    FROM public.task_statuses
    WHERE workspace_id = NEW.workspace_id AND is_active
    ORDER BY position
    LIMIT 1;
    NEW.status_id := resolved_status;
  END IF;

  -- Os clientes já são espelhados entre os ambientes (source_client_id), então
  -- o cliente escolhido tem um correspondente do outro lado. Sem espelho, a
  -- tarefa nasce sem cliente em vez de apontar para fora do ambiente.
  IF NEW.client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = NEW.client_id AND workspace_id = NEW.workspace_id
  ) THEN
    SELECT c.id INTO resolved_client
    FROM public.clients c
    WHERE c.workspace_id = NEW.workspace_id
      AND (
        c.source_client_id = NEW.client_id
        OR c.id = (SELECT o.source_client_id FROM public.clients o WHERE o.id = NEW.client_id)
      )
    LIMIT 1;
    NEW.client_id := resolved_client;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: attach_imported_ata_to_meeting(uuid, uuid, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.attach_imported_ata_to_meeting(target_import_id uuid, target_meeting_id uuid, ata_title text, ata_text text, ata_html text, imported_tasks jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  meeting_record public.recurring_meetings%ROWTYPE;
  occurrence_record public.recurring_meeting_occurrences%ROWTYPE;
  existing_import public.meeting_ata_imports%ROWTYPE;
  imported_task jsonb;
  new_task_id uuid;
  new_note_id uuid;
  task_title text;
  due_day date;
  assignee uuid;
  imported_status_id uuid;
  column_id uuid;
  tag uuid;
  imported_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'client'::public.app_role) THEN
    RAISE EXCEPTION 'Você não pode importar atas para reuniões';
  END IF;
  IF target_import_id IS NULL OR target_meeting_id IS NULL THEN
    RAISE EXCEPTION 'Importação inválida';
  END IF;

  SELECT * INTO meeting_record FROM public.recurring_meetings
  WHERE id = target_meeting_id FOR UPDATE;
  IF NOT FOUND OR meeting_record.client_id IS NULL
     OR NOT public.has_workspace_access(meeting_record.workspace_id) THEN
    RAISE EXCEPTION 'Reunião ou cliente não encontrado neste ambiente';
  END IF;
  IF NOT meeting_record.is_active THEN RAISE EXCEPTION 'Ative a reunião antes de importar a ata'; END IF;

  SELECT * INTO existing_import FROM public.meeting_ata_imports
  WHERE id = target_import_id;
  IF FOUND THEN
    IF existing_import.recurring_meeting_id <> target_meeting_id THEN
      RAISE EXCEPTION 'Esta importação pertence a outra reunião';
    END IF;
    RETURN existing_import.task_count;
  END IF;

  SELECT * INTO occurrence_record FROM public.recurring_meeting_occurrences AS occurrence
  WHERE occurrence.recurring_meeting_id = target_meeting_id
    AND occurrence.status NOT IN ('completed', 'skipped')
  ORDER BY occurrence.due_date, occurrence.id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A primeira data da reunião ainda não foi gerada'; END IF;

  IF imported_tasks IS NULL THEN imported_tasks := '[]'::jsonb; END IF;
  IF jsonb_typeof(imported_tasks) <> 'array'
     OR jsonb_array_length(imported_tasks) > 100 THEN
    RAISE EXCEPTION 'A importação aceita até 100 tarefas';
  END IF;

  IF length(trim(coalesce(ata_text, ''))) > 0
     OR length(trim(coalesce(ata_html, ''))) > 0 THEN
    INSERT INTO public.client_notes (
      client_id, title, content, content_html, created_by,
      recurring_meeting_id, recurring_meeting_occurrence_id
    ) VALUES (
      meeting_record.client_id,
      left(coalesce(nullif(trim(ata_title), ''), 'Ata de Reunião'), 240),
      coalesce(ata_text, ''), nullif(ata_html, ''), auth.uid(),
      meeting_record.id, occurrence_record.id
    ) RETURNING id INTO new_note_id;
  END IF;

  INSERT INTO public.meeting_ata_imports (
    id, recurring_meeting_id, occurrence_id, client_note_id, created_by
  ) VALUES (
    target_import_id, meeting_record.id, occurrence_record.id, new_note_id, auth.uid()
  );

  FOR imported_task IN SELECT value FROM jsonb_array_elements(imported_tasks) LOOP
    task_title := trim(coalesce(imported_task->>'title', ''));
    IF task_title = '' THEN RAISE EXCEPTION 'Tarefa importada sem título'; END IF;
    IF length(task_title) > 200 THEN RAISE EXCEPTION 'Título de tarefa muito longo'; END IF;

    due_day := coalesce(nullif(imported_task->>'due_date', '')::date,
                        occurrence_record.due_date);
    assignee := nullif(imported_task->>'assignee_id', '')::uuid;
    imported_status_id := nullif(imported_task->>'status_id', '')::uuid;
    column_id := nullif(imported_task->>'column_id', '')::uuid;
    tag := nullif(imported_task->>'tag_id', '')::uuid;

    IF assignee IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.workspace_memberships member
      WHERE member.user_id = assignee
        AND member.workspace_id = meeting_record.workspace_id
    ) THEN RAISE EXCEPTION 'Responsável não pertence a este ambiente'; END IF;
    IF imported_status_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.task_statuses item
      WHERE item.id = imported_status_id AND item.workspace_id = meeting_record.workspace_id
        AND NOT item.is_completed
    ) THEN RAISE EXCEPTION 'Status inválido para a reunião'; END IF;
    IF column_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.kanban_columns item
      WHERE item.id = column_id AND item.workspace_id = meeting_record.workspace_id
    ) THEN RAISE EXCEPTION 'Coluna inválida para a reunião'; END IF;
    IF tag IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.task_tags item
      WHERE item.id = tag AND item.workspace_id = meeting_record.workspace_id
    ) THEN RAISE EXCEPTION 'Tag inválida para a reunião'; END IF;

    INSERT INTO public.tasks (
      workspace_id, title, description, status, status_id, column_id,
      priority, due_date, assignee_id, client_id, created_by
    ) VALUES (
      meeting_record.workspace_id, task_title,
      nullif(imported_task->>'description', ''), 'todo', imported_status_id, column_id,
      coalesce(nullif(imported_task->>'priority', ''), 'medium')::public.task_priority,
      (due_day + '18:00'::time) AT TIME ZONE 'America/Sao_Paulo',
      assignee, meeting_record.client_id, auth.uid()
    ) RETURNING id INTO new_task_id;

    PERFORM public.link_existing_task_to_meeting(occurrence_record.id, new_task_id);
    IF tag IS NOT NULL THEN
      INSERT INTO public.task_tag_links(task_id, tag_id) VALUES (new_task_id, tag);
    END IF;
    imported_count := imported_count + 1;
  END LOOP;

  UPDATE public.meeting_ata_imports
  SET task_count = imported_count WHERE id = target_import_id;
  RETURN imported_count;
END;
$$;


--
-- Name: auto_complete_meeting_from_agenda(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_complete_meeting_from_agenda() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.auto_complete_meeting_if_ready(OLD.occurrence_id);
    RETURN OLD;
  END IF;

  PERFORM public.auto_complete_meeting_if_ready(NEW.occurrence_id);
  IF NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id THEN
    PERFORM public.auto_complete_meeting_if_ready(OLD.occurrence_id);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: auto_complete_meeting_from_task(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_complete_meeting_from_task() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  target_id uuid;
  old_occurrence_id uuid;
  old_item_id uuid;
BEGIN
  -- O trigger de sincronização da pauta roda antes deste. Reavalia a reunião
  -- inclusive quando uma tarefa muda de pauta ou é arquivada/excluída.
  IF TG_OP = 'UPDATE' THEN
    old_occurrence_id := OLD.recurring_meeting_occurrence_id;
    old_item_id := OLD.recurring_meeting_agenda_item_id;
  END IF;
  FOR target_id IN
    SELECT DISTINCT linked.occurrence_id
    FROM (
      SELECT NEW.recurring_meeting_occurrence_id AS occurrence_id
      UNION ALL
      SELECT old_occurrence_id
      UNION ALL
      SELECT item.occurrence_id
      FROM public.recurring_meeting_agenda_items item
      WHERE item.id IN (NEW.recurring_meeting_agenda_item_id, old_item_id)
    ) linked
    WHERE linked.occurrence_id IS NOT NULL
  LOOP
    PERFORM public.auto_complete_meeting_if_ready(target_id);
  END LOOP;
  RETURN NEW;
END;
$$;


--
-- Name: auto_complete_meeting_if_ready(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_complete_meeting_if_ready(target_occurrence_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF target_occurrence_id IS NULL THEN RETURN; END IF;

  -- Serializa conclusões simultâneas de itens da mesma reunião.
  PERFORM 1
  FROM public.recurring_meeting_occurrences occurrence
  JOIN public.recurring_meetings meeting ON meeting.id = occurrence.recurring_meeting_id
  WHERE occurrence.id = target_occurrence_id
    AND occurrence.status IN ('scheduled', 'open')
    AND occurrence.agenda_prepared_at IS NOT NULL
    AND meeting.meeting_mode
  FOR UPDATE OF occurrence;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.recurring_meeting_agenda_items item
    WHERE item.occurrence_id = target_occurrence_id
  ) OR EXISTS (
    SELECT 1 FROM public.recurring_meeting_agenda_items item
    WHERE item.occurrence_id = target_occurrence_id
      AND item.result IS DISTINCT FROM 'done'
  ) OR EXISTS (
    SELECT 1
    FROM public.tasks task
    WHERE task.deleted_at IS NULL
      AND task.archived_at IS NULL
      AND (
        task.recurring_meeting_occurrence_id = target_occurrence_id
        OR EXISTS (
          SELECT 1 FROM public.recurring_meeting_agenda_items item
          WHERE item.id = task.recurring_meeting_agenda_item_id
            AND item.occurrence_id = target_occurrence_id
        )
      )
      AND NOT (
        task.status = 'done'::public.task_status
        OR task.completed_at IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM public.task_statuses status
          WHERE status.id = task.status_id AND status.is_completed
        )
      )
  ) THEN
    RETURN;
  END IF;

  UPDATE public.recurring_meeting_occurrences
  SET status = 'completed',
      completed_at = coalesce(completed_at, now()),
      completed_by = auth.uid()
  WHERE id = target_occurrence_id
    AND status IN ('scheduled', 'open');
END;
$$;


--
-- Name: can_access_client_reference_file(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_client_reference_file(object_name text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.clients c
    WHERE c.id::text = split_part(object_name, '/', 1)
      AND public.can_access_workspace_client(c.id));
$$;


--
-- Name: can_access_crm(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_crm(target_workspace_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.has_workspace_access(target_workspace_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (public.has_role(auth.uid(), 'collaborator'::public.app_role) AND EXISTS (
        SELECT 1 FROM public.workspace_memberships m
        WHERE m.workspace_id = target_workspace_id
          AND m.user_id = auth.uid()
          AND 'crm' = ANY(m.permissions)
      ))
    );
$$;


--
-- Name: can_access_service_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_service_request(target_request_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.service_requests request
    WHERE request.id = target_request_id
      AND (
        NOT public.has_role(auth.uid(), 'client'::public.app_role)
        OR request.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.service_request_participants participant
          WHERE participant.request_id = request.id AND participant.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.client_user_links link
          WHERE link.client_id = request.client_id AND link.user_id = auth.uid()
        )
      )
  );
$$;


--
-- Name: can_access_task_conversation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_task_conversation(_task_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = _task_id
      AND (
        t.assignee_id = auth.uid()
        OR t.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.task_collaborators tc
          WHERE tc.task_id = t.id AND tc.collaborator_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.subtasks s
          WHERE s.task_id = t.id AND s.assignee_id = auth.uid()
        )
        OR (
          public.has_workspace_access(t.workspace_id)
          AND EXISTS (
            SELECT 1 FROM public.workspaces w
            WHERE w.id = t.workspace_id AND w.slug = 'marketing'
          )
          AND EXISTS (
            SELECT 1 FROM public.task_conversation_followers f
            WHERE f.task_id = t.id AND f.user_id = auth.uid()
          )
        )
      )
  )
$$;


--
-- Name: can_access_workspace_client(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_workspace_client(_client_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.clients WHERE id = _client_id AND public.has_workspace_access(workspace_id))
$$;


--
-- Name: can_access_workspace_department(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_workspace_department(_department_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_departments d
    JOIN public.clients c ON c.id = d.client_id
    WHERE d.id = _department_id AND public.has_workspace_access(c.workspace_id)
  )
$$;


--
-- Name: can_access_workspace_employee(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_workspace_employee(_employee_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_department_employees e
    JOIN public.client_departments d ON d.id = e.department_id
    JOIN public.clients c ON c.id = d.client_id
    WHERE e.id = _employee_id AND public.has_workspace_access(c.workspace_id)
  )
$$;


--
-- Name: can_access_workspace_mural_post(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_workspace_mural_post(_post_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.mural_posts WHERE id = _post_id AND public.has_workspace_access(workspace_id))
$$;


--
-- Name: can_access_workspace_note(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_workspace_note(_note_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_notes n
    JOIN public.clients c ON c.id = n.client_id
    WHERE n.id = _note_id AND public.has_workspace_access(c.workspace_id)
  )
$$;


--
-- Name: can_access_workspace_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_workspace_request(_request_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.service_requests WHERE id = _request_id AND public.has_workspace_access(workspace_id))
$$;


--
-- Name: can_access_workspace_task(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_workspace_task(_task_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE id = _task_id
      AND (
        public.has_workspace_access(workspace_id)
        -- Administrador associado ao ambiente de destino, preenchendo a tarefa
        -- que acabou de lançar lá sem precisar trocar de ambiente.
        OR public.can_create_in_workspace(workspace_id)
        -- Pessoa de outro ambiente marcada na tarefa.
        OR public.participates_in_task(id)
      )
  )
$$;


--
-- Name: can_change_active_workspace(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_change_active_workspace() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.active_workspace_id IS DISTINCT FROM OLD.active_workspace_id
     AND NOT EXISTS (
       SELECT 1 FROM public.workspace_memberships
       WHERE workspace_id = NEW.active_workspace_id AND user_id = auth.uid()
     ) THEN
    RAISE EXCEPTION 'You do not have access to this TaskFlow environment';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: can_create_in_workspace(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_create_in_workspace(_workspace_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT _workspace_id IS NOT NULL
    -- Pertencer ao ambiente de destino é condição inegociável, inclusive para
    -- administradores: quem não é membro não cria nada lá.
    AND EXISTS (
      SELECT 1 FROM public.workspace_memberships
      WHERE workspace_id = _workspace_id AND user_id = auth.uid()
    )
    AND (
      public.has_workspace_access(_workspace_id)
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
$$;


--
-- Name: can_manage_task_collaborators(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_manage_task_collaborators(_task_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = _task_id
      AND (
        public.has_role(auth.uid(), 'admin'::app_role)
        OR t.created_by = auth.uid()
        OR t.assignee_id = auth.uid()
      )
  )
$$;


--
-- Name: can_manage_workspace_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_manage_workspace_user(_target_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.has_role(auth.uid(), 'admin'::public.app_role)
    AND EXISTS (
      SELECT 1
      FROM public.workspace_memberships caller
      JOIN public.workspace_memberships target
        ON target.workspace_id = caller.workspace_id
      WHERE caller.user_id = auth.uid()
        AND caller.workspace_id = public.current_workspace_id()
        AND target.user_id = _target_user_id
    )
$$;


--
-- Name: can_oversee_task_conversation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_oversee_task_conversation(_task_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND EXISTS (
       SELECT 1 FROM public.tasks t
       WHERE t.id = _task_id AND public.has_workspace_access(t.workspace_id)
     )
$$;


--
-- Name: can_preview_workspace_tasks(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_preview_workspace_tasks(target_workspace_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT target_workspace_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_roles role
      WHERE role.user_id = auth.uid()
        AND role.role = 'admin'::public.app_role
    )
    AND EXISTS (
      SELECT 1
      FROM public.workspace_memberships membership
      WHERE membership.workspace_id = target_workspace_id
        AND membership.user_id = auth.uid()
    )
$$;


--
-- Name: can_sync_client_file_from_task(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_sync_client_file_from_task(_client_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.can_access_workspace_client(_client_id)
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = _client_id
        AND (
          -- Administrador associado ao ambiente de destino, preenchendo a
          -- tarefa (e a ficha do cliente dela) que acabou de lançar lá.
          public.can_create_in_workspace(c.workspace_id)
          -- Pessoa de outro ambiente marcada numa tarefa deste cliente.
          OR EXISTS (
            SELECT 1 FROM public.tasks t
            WHERE t.client_id = _client_id AND public.participates_in_task(t.id)
          )
        )
    )
$$;


--
-- Name: can_view_invited_meeting(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_invited_meeting(target_meeting_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.recurring_meetings meeting
    JOIN public.workspace_memberships membership
      ON membership.workspace_id = meeting.workspace_id
     AND membership.user_id = auth.uid()
    WHERE meeting.id = target_meeting_id
      AND (
        meeting.assignee_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.recurring_meeting_participants participant
          WHERE participant.recurring_meeting_id = meeting.id
            AND participant.user_id = auth.uid()
        )
      )
  );
$$;


--
-- Name: can_view_task(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_task(_task_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = _task_id
      AND (
        public.has_role(auth.uid(), 'admin'::app_role)
        OR t.assignee_id = auth.uid()
        OR t.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.task_collaborators tc
          WHERE tc.task_id = t.id AND tc.collaborator_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.subtasks s
          WHERE s.task_id = t.id AND s.assignee_id = auth.uid()
        )
      )
  )
$$;


--
-- Name: complete_meeting_agenda_tasks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_meeting_agenda_tasks() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  completed_status_id uuid;
  target_workspace_id uuid;
BEGIN
  IF NEW.result IS DISTINCT FROM 'done' OR NEW.result IS NOT DISTINCT FROM OLD.result THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tasks task
    JOIN public.subtasks subtask ON subtask.task_id = task.id
    WHERE task.recurring_meeting_agenda_item_id = NEW.id
      AND task.deleted_at IS NULL
      AND task.archived_at IS NULL
      AND NOT subtask.done
      AND task.status IS DISTINCT FROM 'done'::public.task_status
      AND task.completed_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.task_statuses status
        WHERE status.id = task.status_id AND status.is_completed
      )
  ) THEN
    RAISE EXCEPTION 'Conclua todas as subtarefas antes de concluir a pauta';
  END IF;

  SELECT occurrence.workspace_id INTO target_workspace_id
  FROM public.recurring_meeting_occurrences occurrence
  WHERE occurrence.id = NEW.occurrence_id;

  SELECT status.id INTO completed_status_id
  FROM public.task_statuses status
  WHERE status.workspace_id = target_workspace_id AND status.is_completed
  ORDER BY status.position
  LIMIT 1;

  IF completed_status_id IS NULL AND EXISTS (
    SELECT 1 FROM public.tasks task
    WHERE task.recurring_meeting_agenda_item_id = NEW.id
      AND task.deleted_at IS NULL AND task.archived_at IS NULL
      AND task.status IS DISTINCT FROM 'done'::public.task_status
      AND task.completed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Cadastre um status marcado como concluído antes de concluir as tarefas';
  END IF;

  UPDATE public.tasks task
  SET status = 'done'::public.task_status,
      status_id = completed_status_id,
      completed_at = coalesce(task.completed_at, now())
  WHERE task.recurring_meeting_agenda_item_id = NEW.id
    AND task.deleted_at IS NULL
    AND task.archived_at IS NULL
    AND NOT (
      task.status = 'done'::public.task_status
      OR task.completed_at IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM public.task_statuses status
        WHERE status.id = task.status_id AND status.is_completed
      )
    );

  RETURN NEW;
END;
$$;


--
-- Name: complete_obligation_occurrence(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_obligation_occurrence(target_occurrence_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE occurrence_record record; completed_status_id uuid;
BEGIN
  SELECT * INTO occurrence_record FROM public.obligation_occurrences
  WHERE id = target_occurrence_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ocorrência não encontrada'; END IF;
  IF NOT public.has_workspace_access(occurrence_record.workspace_id) THEN
    RAISE EXCEPTION 'Você não pode concluir esta ocorrência';
  END IF;

  UPDATE public.obligation_occurrences
  SET status = 'completed', completed_at = coalesce(completed_at, now()), completed_by = auth.uid()
  WHERE id = target_occurrence_id;

  IF occurrence_record.task_id IS NOT NULL THEN
    SELECT id INTO completed_status_id FROM public.task_statuses
    WHERE workspace_id = occurrence_record.workspace_id AND is_completed
    ORDER BY position LIMIT 1;
    UPDATE public.tasks
    SET status = 'done'::public.task_status,
        status_id = coalesce(completed_status_id, status_id),
        completed_at = coalesce(completed_at, now())
    WHERE id = occurrence_record.task_id;
  END IF;
  RETURN true;
END;
$$;


--
-- Name: complete_recurring_meeting_occurrence(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_recurring_meeting_occurrence(target_occurrence_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE occurrence_record record; completed_status_id uuid;
BEGIN
  SELECT occurrence.*, recurring_meeting.meeting_mode
  INTO occurrence_record
  FROM public.recurring_meeting_occurrences occurrence
  JOIN public.recurring_meetings recurring_meeting ON recurring_meeting.id = occurrence.recurring_meeting_id
  WHERE occurrence.id = target_occurrence_id
  FOR UPDATE OF occurrence;

  IF NOT FOUND THEN RAISE EXCEPTION 'Ocorrência não encontrada'; END IF;
  IF NOT public.has_workspace_access(occurrence_record.workspace_id) THEN
    RAISE EXCEPTION 'Você não pode concluir esta ocorrência';
  END IF;

  IF occurrence_record.meeting_mode THEN
    PERFORM public.prepare_recurring_meeting_agenda(target_occurrence_id);
    IF EXISTS (
      SELECT 1 FROM public.recurring_meeting_agenda_items item
      WHERE item.occurrence_id = target_occurrence_id AND item.result IS NULL
    ) THEN
      RAISE EXCEPTION 'Defina o resultado de todos os itens da pauta antes de encerrar a reunião';
    END IF;
  END IF;

  UPDATE public.recurring_meeting_occurrences
  SET status = 'completed', completed_at = coalesce(completed_at, now()), completed_by = auth.uid()
  WHERE id = target_occurrence_id;

  IF NOT occurrence_record.meeting_mode AND occurrence_record.task_id IS NOT NULL THEN
    SELECT id INTO completed_status_id FROM public.task_statuses
    WHERE workspace_id = occurrence_record.workspace_id AND is_completed
    ORDER BY position LIMIT 1;
    UPDATE public.tasks
    SET status = 'done'::public.task_status,
        status_id = coalesce(completed_status_id, status_id),
        completed_at = coalesce(completed_at, now())
    WHERE id = occurrence_record.task_id;
  END IF;
  RETURN true;
END;
$$;


--
-- Name: create_obligation_task(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_obligation_task(target_occurrence_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  occurrence_record record;
  obligation_record public.obligations%ROWTYPE;
  selected_status_id uuid;
  selected_column_id uuid;
  new_task_id uuid;
  next_position integer;
  linked_task_deleted_at timestamptz;
BEGIN
  SELECT * INTO occurrence_record
  FROM public.obligation_occurrences
  WHERE id = target_occurrence_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Ocorrência não encontrada'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_workspace_access(occurrence_record.workspace_id) THEN
    RAISE EXCEPTION 'Você não pode criar tarefas neste ambiente';
  END IF;

  IF occurrence_record.task_id IS NOT NULL THEN
    SELECT deleted_at INTO linked_task_deleted_at
    FROM public.tasks
    WHERE id = occurrence_record.task_id;

    IF FOUND AND linked_task_deleted_at IS NULL THEN
      RETURN occurrence_record.task_id;
    END IF;

    IF FOUND THEN
      UPDATE public.tasks
      SET deleted_at = NULL,
          deleted_by = NULL
      WHERE id = occurrence_record.task_id;

      UPDATE public.obligation_occurrences
      SET status = 'open'
      WHERE id = occurrence_record.id;

      RETURN occurrence_record.task_id;
    END IF;
  END IF;

  IF occurrence_record.status IN ('completed', 'skipped') THEN
    RAISE EXCEPTION 'Esta ocorrência já foi encerrada';
  END IF;

  SELECT * INTO obligation_record
  FROM public.obligations
  WHERE id = occurrence_record.obligation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Obrigação não encontrada'; END IF;

  selected_status_id := obligation_record.status_id;
  IF selected_status_id IS NULL THEN
    SELECT id INTO selected_status_id
    FROM public.task_statuses
    WHERE workspace_id = obligation_record.workspace_id AND NOT is_completed
    ORDER BY position, created_at
    LIMIT 1;
  END IF;

  selected_column_id := obligation_record.column_id;
  IF selected_column_id IS NULL THEN
    SELECT id INTO selected_column_id
    FROM public.kanban_columns
    WHERE workspace_id = obligation_record.workspace_id
    ORDER BY position, created_at
    LIMIT 1;
  END IF;

  SELECT coalesce(max(position), -1) + 1 INTO next_position
  FROM public.tasks
  WHERE workspace_id = obligation_record.workspace_id
    AND column_id IS NOT DISTINCT FROM selected_column_id
    AND deleted_at IS NULL;

  INSERT INTO public.tasks (
    title, description, status, status_id, priority, due_date, due_time,
    assignee_id, client_id, column_id, position, created_by, workspace_id
  ) VALUES (
    obligation_record.title,
    obligation_record.description,
    'todo'::public.task_status,
    selected_status_id,
    obligation_record.priority,
    (
      occurrence_record.due_date
      + coalesce(occurrence_record.due_time, time '12:00')
    ) AT TIME ZONE 'America/Sao_Paulo',
    occurrence_record.due_time,
    obligation_record.assignee_id,
    obligation_record.client_id,
    selected_column_id,
    next_position,
    obligation_record.created_by,
    obligation_record.workspace_id
  )
  RETURNING id INTO new_task_id;

  UPDATE public.obligation_occurrences
  SET task_id = new_task_id, status = 'open'
  WHERE id = occurrence_record.id;

  RETURN new_task_id;
END;
$$;


--
-- Name: create_recurring_meeting_agenda_tasks(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_recurring_meeting_agenda_tasks(target_occurrence_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  occurrence_record record;
  recurring_meeting_record public.recurring_meetings%ROWTYPE;
  template_record record;
  selected_status_id uuid;
  selected_column_id uuid;
  next_position integer;
  created_count integer := 0;
  inserted_count integer;
BEGIN
  SELECT * INTO occurrence_record
  FROM public.recurring_meeting_occurrences
  WHERE id = target_occurrence_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Ocorrência não encontrada'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_workspace_access(occurrence_record.workspace_id) THEN
    RAISE EXCEPTION 'Você não pode criar tarefas neste ambiente';
  END IF;
  IF occurrence_record.status IN ('completed', 'skipped') THEN RETURN 0; END IF;

  SELECT * INTO recurring_meeting_record
  FROM public.recurring_meetings
  WHERE id = occurrence_record.recurring_meeting_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reunião não encontrada'; END IF;

  -- Mesmas regras de create_recurring_meeting_task para status, coluna e prazo.
  selected_status_id := recurring_meeting_record.status_id;
  IF selected_status_id IS NULL THEN
    SELECT id INTO selected_status_id
    FROM public.task_statuses
    WHERE workspace_id = recurring_meeting_record.workspace_id AND NOT is_completed
    ORDER BY position, created_at
    LIMIT 1;
  END IF;

  selected_column_id := recurring_meeting_record.column_id;
  IF selected_column_id IS NULL THEN
    SELECT id INTO selected_column_id
    FROM public.kanban_columns
    WHERE workspace_id = recurring_meeting_record.workspace_id
    ORDER BY position, created_at
    LIMIT 1;
  END IF;

  SELECT coalesce(max(position), -1) + 1 INTO next_position
  FROM public.tasks
  WHERE workspace_id = recurring_meeting_record.workspace_id
    AND column_id IS NOT DISTINCT FROM selected_column_id
    AND deleted_at IS NULL;

  FOR template_record IN
    SELECT template.*
    FROM public.recurring_meeting_agenda_templates template
    WHERE template.recurring_meeting_id = recurring_meeting_record.id
      AND NOT EXISTS (
        SELECT 1 FROM public.tasks task
        WHERE task.recurring_meeting_occurrence_id = occurrence_record.id
          AND task.recurring_meeting_agenda_template_id = template.id
      )
    ORDER BY template.position, template.created_at
  LOOP
    INSERT INTO public.tasks (
      title, description, status, status_id, priority, due_date, due_time,
      assignee_id, client_id, column_id, position, created_by, workspace_id,
      recurring_meeting_occurrence_id, recurring_meeting_agenda_template_id
    ) VALUES (
      template_record.title,
      template_record.description,
      'todo'::public.task_status,
      selected_status_id,
      coalesce(template_record.priority::public.task_priority, recurring_meeting_record.priority),
      (
        occurrence_record.due_date
        + coalesce(occurrence_record.due_time, time '12:00')
      ) AT TIME ZONE 'America/Sao_Paulo',
      occurrence_record.due_time,
      coalesce(template_record.assignee_id, recurring_meeting_record.assignee_id),
      recurring_meeting_record.client_id,
      selected_column_id,
      next_position,
      recurring_meeting_record.created_by,
      recurring_meeting_record.workspace_id,
      occurrence_record.id,
      template_record.id
    )
    ON CONFLICT (recurring_meeting_occurrence_id, recurring_meeting_agenda_template_id)
      WHERE recurring_meeting_occurrence_id IS NOT NULL AND recurring_meeting_agenda_template_id IS NOT NULL
      DO NOTHING;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    created_count := created_count + inserted_count;
    next_position := next_position + inserted_count;
  END LOOP;

  RETURN created_count;
END;
$$;


--
-- Name: create_recurring_meeting_task(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_recurring_meeting_task(target_occurrence_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  occurrence_record record;
  recurring_meeting_record public.recurring_meetings%ROWTYPE;
  selected_status_id uuid;
  selected_column_id uuid;
  new_task_id uuid;
  next_position integer;
BEGIN
  SELECT * INTO occurrence_record
  FROM public.recurring_meeting_occurrences
  WHERE id = target_occurrence_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Ocorrência não encontrada'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_workspace_access(occurrence_record.workspace_id) THEN
    RAISE EXCEPTION 'Você não pode criar tarefas neste ambiente';
  END IF;
  IF occurrence_record.task_id IS NOT NULL THEN RETURN occurrence_record.task_id; END IF;
  IF occurrence_record.status IN ('completed', 'skipped') THEN
    RAISE EXCEPTION 'Esta ocorrência já foi encerrada';
  END IF;

  SELECT * INTO recurring_meeting_record
  FROM public.recurring_meetings
  WHERE id = occurrence_record.recurring_meeting_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reunião não encontrada'; END IF;

  selected_status_id := recurring_meeting_record.status_id;
  IF selected_status_id IS NULL THEN
    SELECT id INTO selected_status_id
    FROM public.task_statuses
    WHERE workspace_id = recurring_meeting_record.workspace_id AND NOT is_completed
    ORDER BY position, created_at
    LIMIT 1;
  END IF;

  selected_column_id := recurring_meeting_record.column_id;
  IF selected_column_id IS NULL THEN
    SELECT id INTO selected_column_id
    FROM public.kanban_columns
    WHERE workspace_id = recurring_meeting_record.workspace_id
    ORDER BY position, created_at
    LIMIT 1;
  END IF;

  SELECT coalesce(max(position), -1) + 1 INTO next_position
  FROM public.tasks
  WHERE workspace_id = recurring_meeting_record.workspace_id
    AND column_id IS NOT DISTINCT FROM selected_column_id
    AND deleted_at IS NULL;

  INSERT INTO public.tasks (
    title, description, status, status_id, priority, due_date, due_time,
    assignee_id, client_id, column_id, position, created_by, workspace_id
  ) VALUES (
    recurring_meeting_record.title,
    recurring_meeting_record.description,
    'todo'::public.task_status,
    selected_status_id,
    recurring_meeting_record.priority,
    (
      occurrence_record.due_date
      + coalesce(occurrence_record.due_time, time '12:00')
    ) AT TIME ZONE 'America/Sao_Paulo',
    occurrence_record.due_time,
    recurring_meeting_record.assignee_id,
    recurring_meeting_record.client_id,
    selected_column_id,
    next_position,
    recurring_meeting_record.created_by,
    recurring_meeting_record.workspace_id
  )
  RETURNING id INTO new_task_id;

  UPDATE public.recurring_meeting_occurrences
  SET task_id = new_task_id, status = 'open'
  WHERE id = occurrence_record.id;

  RETURN new_task_id;
END;
$$;


--
-- Name: create_service_request(text, text, uuid, text, date, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_service_request(p_title text, p_description text DEFAULT NULL::text, p_client_id uuid DEFAULT NULL::uuid, p_priority text DEFAULT 'medium'::text, p_due_date date DEFAULT NULL::date, p_participant_ids uuid[] DEFAULT ARRAY[]::uuid[]) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_request_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida. Entre novamente para criar uma solicitação.' USING ERRCODE = '42501';
  END IF;

  IF char_length(trim(coalesce(p_title, ''))) = 0 THEN
    RAISE EXCEPTION 'Informe o assunto da solicitação.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.service_requests (title, description, client_id, priority, due_date, created_by)
  VALUES (trim(p_title), nullif(trim(coalesce(p_description, '')), ''), p_client_id, p_priority, p_due_date, auth.uid())
  RETURNING id INTO v_request_id;

  INSERT INTO public.service_request_participants (request_id, user_id, added_by)
  VALUES (v_request_id, auth.uid(), auth.uid())
  ON CONFLICT DO NOTHING;

  INSERT INTO public.service_request_participants (request_id, user_id, added_by)
  SELECT v_request_id, participant_id, auth.uid()
  FROM unnest(coalesce(p_participant_ids, ARRAY[]::uuid[])) AS selected(participant_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.service_request_activity (request_id, actor_id, kind, details)
  VALUES (v_request_id, auth.uid(), 'created', 'Solicitação criada');

  RETURN v_request_id;
END;
$$;


--
-- Name: crm_opportunities_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_opportunities_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: crm_validate_client_workspace(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_validate_client_workspace() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = NEW.client_id AND c.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'A empresa selecionada não pertence ao ambiente do lead';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: current_client_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_client_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT client_id FROM public.client_user_links WHERE user_id = auth.uid() LIMIT 1
$$;


--
-- Name: current_workspace_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_workspace_id() RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT active_workspace_id
  FROM public.profiles
  WHERE id = auth.uid()
$$;


--
-- Name: delete_completed_task_conversation_attachments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_completed_task_conversation_attachments() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'storage'
    AS $$
DECLARE
  was_completed boolean := OLD.status = 'done'::public.task_status OR OLD.completed_at IS NOT NULL;
  is_completed boolean := NEW.status = 'done'::public.task_status OR NEW.completed_at IS NOT NULL;
BEGIN
  IF was_completed OR NOT is_completed THEN
    RETURN NEW;
  END IF;

  -- storage.protect_delete aceita a remoção apenas dentro desta transação
  -- explicitamente autorizada. Sem isso, a conclusão inteira é recusada.
  PERFORM set_config('storage.allow_delete_query', 'true', true);

  DELETE FROM storage.objects AS object
  USING public.comment_attachments AS attachment
  WHERE attachment.task_id = NEW.id
    AND object.bucket_id = 'task-attachments'
    AND object.name = attachment.storage_path;

  DELETE FROM public.comment_attachments
  WHERE task_id = NEW.id;

  RETURN NEW;
END;
$$;


--
-- Name: delete_empty_recurring_meeting(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_empty_recurring_meeting(target_meeting_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  meeting_record public.recurring_meetings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'É necessário entrar na sua conta.';
  END IF;

  SELECT * INTO meeting_record
  FROM public.recurring_meetings
  WHERE id = target_meeting_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.has_workspace_access(meeting_record.workspace_id)
     OR NOT (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'collaborator'::public.app_role)
     ) THEN
    RAISE EXCEPTION 'Você não pode excluir esta reunião.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.recurring_meeting_occurrences occurrence
    WHERE occurrence.recurring_meeting_id = target_meeting_id
      AND (occurrence.status <> 'scheduled' OR occurrence.completed_at IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.recurring_meeting_agenda_items item
    JOIN public.recurring_meeting_occurrences occurrence ON occurrence.id = item.occurrence_id
    WHERE occurrence.recurring_meeting_id = target_meeting_id
  ) OR EXISTS (
    SELECT 1 FROM public.tasks task
    JOIN public.recurring_meeting_occurrences occurrence
      ON occurrence.id = task.recurring_meeting_occurrence_id
    WHERE occurrence.recurring_meeting_id = target_meeting_id
  ) OR EXISTS (
    SELECT 1 FROM public.tasks task
    JOIN public.recurring_meeting_agenda_templates template
      ON template.id = task.recurring_meeting_agenda_template_id
    WHERE template.recurring_meeting_id = target_meeting_id
  ) OR EXISTS (
    SELECT 1 FROM public.client_notes note
    WHERE note.recurring_meeting_id = target_meeting_id
  ) OR EXISTS (
    SELECT 1 FROM public.meeting_ata_imports imported
    WHERE imported.recurring_meeting_id = target_meeting_id
  ) OR EXISTS (
    SELECT 1 FROM public.calendar_events event
    JOIN public.recurring_meeting_occurrences occurrence
      ON occurrence.id = event.recurring_meeting_occurrence_id
    WHERE occurrence.recurring_meeting_id = target_meeting_id
      AND (
        EXISTS (SELECT 1 FROM public.meeting_transcripts transcript WHERE transcript.calendar_event_id = event.id)
        OR EXISTS (SELECT 1 FROM public.meeting_minutes minutes WHERE minutes.calendar_event_id = event.id)
      )
  ) THEN
    RAISE EXCEPTION 'Esta reunião já possui registros. Arquive-a para preservar o histórico.';
  END IF;

  -- Mark events before the occurrence foreign key detaches them. Google sync
  -- will delete the remote events while retaining local retry state on error.
  UPDATE public.calendar_events event
  SET deleted_at = coalesce(event.deleted_at, now()),
      deleted_by = auth.uid(),
      updated_by = auth.uid(),
      sync_status = 'pending'
  FROM public.recurring_meeting_occurrences occurrence
  WHERE event.recurring_meeting_occurrence_id = occurrence.id
    AND occurrence.recurring_meeting_id = target_meeting_id
    AND event.deleted_at IS NULL;

  DELETE FROM public.recurring_meetings WHERE id = target_meeting_id;
END;
$$;


--
-- Name: delete_recurring_meeting(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_recurring_meeting(target_meeting_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  meeting_record public.recurring_meetings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'É necessário entrar na sua conta.';
  END IF;

  SELECT * INTO meeting_record
  FROM public.recurring_meetings
  WHERE id = target_meeting_id
  FOR UPDATE;

  IF NOT FOUND OR NOT meeting_record.meeting_mode
     OR NOT public.has_workspace_access(meeting_record.workspace_id)
     OR NOT (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'collaborator'::public.app_role)
     ) THEN
    RAISE EXCEPTION 'Você não pode excluir esta reunião.';
  END IF;

  -- Keep the local tombstone for retries if Google is unavailable. Set the
  -- acting user as updated_by so their calendar connection pushes the delete.
  UPDATE public.calendar_events event
  SET deleted_at = coalesce(event.deleted_at, now()),
      deleted_by = auth.uid(),
      updated_by = auth.uid(),
      sync_status = 'pending',
      sync_error = null
  FROM public.recurring_meeting_occurrences occurrence
  WHERE event.recurring_meeting_occurrence_id = occurrence.id
    AND occurrence.recurring_meeting_id = target_meeting_id
    AND event.deleted_at IS NULL;

  DELETE FROM public.recurring_meetings WHERE id = target_meeting_id;
END;
$$;


--
-- Name: fix_ptbr_mojibake(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fix_ptbr_mojibake(value text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
BEGIN
  IF value IS NULL
    OR (position(chr(195) IN value) = 0
      AND position(chr(194) IN value) = 0
      AND position(chr(226) IN value) = 0) THEN
    RETURN value;
  END IF;

  RETURN convert_from(convert_to(value, 'WIN1252'), 'UTF8');
EXCEPTION
  WHEN character_not_in_repertoire OR untranslatable_character THEN
    -- Mantém textos que já são válidos e apenas contenham esses caracteres.
    RETURN value;
END;
$$;


--
-- Name: guard_comment_edit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_comment_edit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    IF auth.uid() <> OLD.author_id AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
      RAISE EXCEPTION 'Só o autor pode editar a própria mensagem';
    END IF;
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: guard_cross_workspace_task_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_cross_workspace_task_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF public.has_workspace_access(OLD.workspace_id)
     OR public.can_create_in_workspace(OLD.workspace_id) THEN
    RETURN NEW;
  END IF;

  -- Daqui para baixo é quem entrou só por participação: trabalha na tarefa, mas
  -- não a reposiciona no quadro alheio nem a remove.
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'Uma tarefa não muda de ambiente';
  END IF;
  IF NEW.column_id IS DISTINCT FROM OLD.column_id THEN
    RAISE EXCEPTION 'Somente o ambiente dono da tarefa pode movê-la de coluna';
  END IF;
  IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'Somente o ambiente dono da tarefa pode trocar o cliente';
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'Somente o ambiente dono da tarefa pode excluí-la';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  invitation_is_valid BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.access_invitations
    WHERE email = lower(NEW.email)
      AND expires_at > now()
  ) INTO invitation_is_valid;

  IF NOT invitation_is_valid THEN
    RAISE EXCEPTION 'Cadastro público desativado. Solicite um convite ao administrador.';
  END IF;

  DELETE FROM public.access_invitations WHERE email = lower(NEW.email);

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'collaborator'::public.app_role);
  INSERT INTO public.user_permissions (user_id, permissions) VALUES (NEW.id, ARRAY['dashboard', 'tasks']::TEXT[]);
  RETURN NEW;
END;
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;


--
-- Name: has_workspace_access(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_workspace_access(_workspace_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT _workspace_id IS NOT NULL
    AND _workspace_id = public.current_workspace_id()
    AND EXISTS (
      SELECT 1
      FROM public.workspace_memberships
      WHERE workspace_id = _workspace_id
        AND user_id = auth.uid()
    )
$$;


--
-- Name: is_taskflow_access_manager(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_taskflow_access_manager(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT public.has_role(_user_id, 'admin'::public.app_role)
$$;


--
-- Name: link_existing_task_to_meeting(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_existing_task_to_meeting(target_occurrence_id uuid, target_task_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  meeting_record record;
  task_record public.tasks%ROWTYPE;
  new_item_id uuid;
  next_position integer;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'client'::public.app_role) THEN
    RAISE EXCEPTION 'Você não pode vincular tarefas a reuniões';
  END IF;

  SELECT occurrence.id, occurrence.workspace_id, occurrence.status, meeting.client_id
    INTO meeting_record
  FROM public.recurring_meeting_occurrences occurrence
  JOIN public.recurring_meetings meeting ON meeting.id = occurrence.recurring_meeting_id
  WHERE occurrence.id = target_occurrence_id
  FOR UPDATE OF occurrence;

  IF NOT FOUND THEN RAISE EXCEPTION 'Reunião não encontrada'; END IF;
  IF NOT public.has_workspace_access(meeting_record.workspace_id) THEN
    RAISE EXCEPTION 'Você não pode alterar esta reunião';
  END IF;
  IF meeting_record.status IN ('completed', 'skipped') THEN
    RAISE EXCEPTION 'Esta reunião já foi encerrada';
  END IF;

  SELECT * INTO task_record
  FROM public.tasks
  WHERE id = target_task_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.can_view_task(target_task_id) THEN
    RAISE EXCEPTION 'Tarefa não encontrada';
  END IF;
  IF task_record.workspace_id IS DISTINCT FROM meeting_record.workspace_id
     OR task_record.client_id IS DISTINCT FROM meeting_record.client_id THEN
    RAISE EXCEPTION 'A tarefa precisa pertencer ao mesmo cliente e ambiente da reunião';
  END IF;
  IF task_record.deleted_at IS NOT NULL OR task_record.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'A tarefa excluída ou arquivada não pode ser vinculada';
  END IF;
  IF task_record.recurring_meeting_agenda_item_id IS NOT NULL
     OR task_record.recurring_meeting_occurrence_id IS NOT NULL
     OR task_record.recurring_meeting_agenda_template_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta tarefa já está vinculada a uma reunião';
  END IF;

  PERFORM public.prepare_recurring_meeting_agenda(target_occurrence_id);

  SELECT coalesce(max(position), -1) + 1 INTO next_position
  FROM public.recurring_meeting_agenda_items
  WHERE occurrence_id = target_occurrence_id;

  INSERT INTO public.recurring_meeting_agenda_items (occurrence_id, title, position)
  VALUES (target_occurrence_id, task_record.title, next_position)
  RETURNING id INTO new_item_id;

  UPDATE public.tasks
  SET recurring_meeting_agenda_item_id = new_item_id
  WHERE id = target_task_id;

  RETURN new_item_id;
END;
$$;


--
-- Name: link_existing_tasks_to_meeting(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_existing_tasks_to_meeting(target_occurrence_id uuid, target_task_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  task_id uuid;
  linked_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF target_task_ids IS NULL OR cardinality(target_task_ids) = 0 THEN RETURN 0; END IF;
  FOREACH task_id IN ARRAY target_task_ids LOOP
    IF task_id IS NULL OR task_id = ANY(linked_ids) THEN
      RAISE EXCEPTION 'A lista contém uma tarefa inválida ou repetida';
    END IF;
    PERFORM public.link_existing_task_to_meeting(target_occurrence_id, task_id);
    linked_ids := array_append(linked_ids, task_id);
  END LOOP;

  RETURN cardinality(linked_ids);
END;
$$;


--
-- Name: list_related_client_names(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_related_client_names() RETURNS TABLE(id uuid, name text, color text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT c.id, c.name, c.color
  FROM public.clients c
  WHERE EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.user_id = auth.uid() AND m.workspace_id = c.workspace_id
  )
$$;


--
-- Name: list_task_assignees(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_task_assignees(target_workspace_id uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, full_name text, email text, avatar_url text, is_active boolean, workspace_slugs text[])
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    p.id,
    p.full_name,
    p.email,
    p.avatar_url,
    COALESCE(p.is_active, true),
    array_agg(DISTINCT w.slug ORDER BY w.slug)
  FROM public.profiles p
  -- O papel continua vindo de user_roles, como na função original. A coluna
  -- role da associação é uma cópia feita no backfill e pode estar defasada;
  -- alguém sumir do seletor por causa disso seria pior do que o vazamento que
  -- esta função fecha.
  JOIN public.user_roles ur ON ur.user_id = p.id
  JOIN public.workspace_memberships m ON m.user_id = p.id
  JOIN public.workspaces w ON w.id = m.workspace_id
  WHERE COALESCE(p.is_active, true)
    AND ur.role IN ('admin'::public.app_role, 'collaborator'::public.app_role)
    -- Sem argumento, o ambiente é o que quem chama está usando. Se não houver
    -- ambiente ativo, a lista degrada para todos os ambientes de quem chama em
    -- vez de vir vazia: tela sem nenhum nome é pior que uma lista ampla demais.
    AND (
      COALESCE(target_workspace_id, public.current_workspace_id()) IS NULL
      OR m.workspace_id = COALESCE(target_workspace_id, public.current_workspace_id())
    )
    -- Você só enxerga pessoas de ambientes a que você mesmo pertence.
    AND EXISTS (
      SELECT 1 FROM public.workspace_memberships own
      WHERE own.user_id = auth.uid() AND own.workspace_id = m.workspace_id
    )
  GROUP BY p.id, p.full_name, p.email, p.avatar_url, p.is_active
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: client_important_dates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_important_dates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    title text NOT NULL,
    event_date date NOT NULL,
    recurrence text DEFAULT 'annual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT client_important_dates_recurrence_check CHECK ((recurrence = ANY (ARRAY['annual'::text, 'once'::text]))),
    CONSTRAINT client_important_dates_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 120)))
);


--
-- Name: list_workspace_client_important_dates_for_admin_preview(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_workspace_client_important_dates_for_admin_preview(target_workspace_id uuid) RETURNS SETOF public.client_important_dates
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.can_preview_workspace_tasks(target_workspace_id) THEN
    RAISE EXCEPTION 'Você não pode visualizar as datas deste ambiente';
  END IF;

  RETURN QUERY
  SELECT important_date.*
  FROM public.client_important_dates important_date
  JOIN public.clients client ON client.id = important_date.client_id
  WHERE client.workspace_id = target_workspace_id
  ORDER BY important_date.event_date, important_date.title;
END;
$$;


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#1e3a8a'::text,
    description text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cnpj text,
    legal_name text,
    trade_name text,
    state_registration text,
    municipal_registration text,
    address text,
    phone text,
    email text,
    responsible text,
    avatar_path text,
    is_active boolean DEFAULT true NOT NULL,
    workspace_id uuid,
    source_client_id uuid
);


--
-- Name: list_workspace_clients_for_admin_preview(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_workspace_clients_for_admin_preview(target_workspace_id uuid) RETURNS SETOF public.clients
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.can_preview_workspace_tasks(target_workspace_id) THEN
    RAISE EXCEPTION 'Você não pode visualizar os clientes deste ambiente';
  END IF;

  RETURN QUERY
  SELECT client.*
  FROM public.clients client
  WHERE client.workspace_id = target_workspace_id
  ORDER BY client.name;
END;
$$;


--
-- Name: kanban_columns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kanban_columns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#1e3a8a'::text,
    "position" integer DEFAULT 0 NOT NULL,
    client_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid
);


--
-- Name: list_workspace_columns_for_admin_preview(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_workspace_columns_for_admin_preview(target_workspace_id uuid) RETURNS SETOF public.kanban_columns
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.can_preview_workspace_tasks(target_workspace_id) THEN
    RAISE EXCEPTION 'Você não pode visualizar as colunas deste ambiente';
  END IF;

  RETURN QUERY
  SELECT column_item.*
  FROM public.kanban_columns column_item
  WHERE column_item.workspace_id = target_workspace_id
  ORDER BY column_item.position;
END;
$$;


--
-- Name: list_workspace_member_ids(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_workspace_member_ids(target_workspace_id uuid DEFAULT NULL::uuid) RETURNS TABLE(user_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT m.user_id
  FROM public.workspace_memberships m
  WHERE m.workspace_id = COALESCE(target_workspace_id, public.current_workspace_id())
    AND EXISTS (
      SELECT 1 FROM public.workspace_memberships me
      WHERE me.workspace_id = m.workspace_id
        AND me.user_id = auth.uid()
    );
$$;


--
-- Name: task_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_statuses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#64748b'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    is_completed boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid
);


--
-- Name: list_workspace_statuses_for_admin_preview(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_workspace_statuses_for_admin_preview(target_workspace_id uuid) RETURNS SETOF public.task_statuses
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.can_preview_workspace_tasks(target_workspace_id) THEN
    RAISE EXCEPTION 'Você não pode visualizar os status deste ambiente';
  END IF;

  RETURN QUERY
  SELECT status_item.*
  FROM public.task_statuses status_item
  WHERE status_item.workspace_id = target_workspace_id
  ORDER BY status_item.position;
END;
$$;


--
-- Name: task_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#6366f1'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    workspace_id uuid
);


--
-- Name: list_workspace_tags_for_admin_preview(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_workspace_tags_for_admin_preview(target_workspace_id uuid) RETURNS SETOF public.task_tags
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.can_preview_workspace_tasks(target_workspace_id) THEN
    RAISE EXCEPTION 'Você não pode visualizar as categorias deste ambiente';
  END IF;

  RETURN QUERY
  SELECT tag.*
  FROM public.task_tags tag
  WHERE tag.workspace_id = target_workspace_id
  ORDER BY tag.position, tag.name;
END;
$$;


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    status public.task_status DEFAULT 'todo'::public.task_status,
    priority public.task_priority DEFAULT 'medium'::public.task_priority,
    due_date timestamp with time zone,
    assignee_id uuid,
    client_id uuid,
    column_id uuid,
    "position" integer DEFAULT 0 NOT NULL,
    color text,
    completed_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tag_id uuid,
    status_id uuid,
    interruptions integer DEFAULT 0 NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    card_width integer,
    assigned_by uuid,
    assigned_at timestamp with time zone,
    due_time time without time zone,
    workspace_id uuid,
    origin_workspace_id uuid,
    archived_at timestamp with time zone,
    archived_reason text,
    conversation_closed_at timestamp with time zone,
    recurring_meeting_occurrence_id uuid,
    recurring_meeting_agenda_template_id uuid,
    recurring_meeting_agenda_item_id uuid,
    objective_id uuid,
    is_draft boolean DEFAULT false NOT NULL,
    deadline_conversation_active_at timestamp with time zone,
    CONSTRAINT tasks_archived_reason_check CHECK (((archived_reason IS NULL) OR (archived_reason = ANY (ARRAY['client_inactive'::text, 'manual'::text])))),
    CONSTRAINT tasks_card_width_check CHECK (((card_width IS NULL) OR ((card_width >= 240) AND (card_width <= 800))))
);


--
-- Name: COLUMN tasks.due_time; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.due_time IS 'Horário opcional do prazo da tarefa, exibido e usado nos alertas do Kanban.';


--
-- Name: COLUMN tasks.conversation_closed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tasks.conversation_closed_at IS 'When set, hides the task conversation from the Conversations inbox without deleting its history.';


--
-- Name: list_workspace_tasks_for_admin_preview(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_workspace_tasks_for_admin_preview(target_workspace_id uuid) RETURNS SETOF public.tasks
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.can_preview_workspace_tasks(target_workspace_id) THEN
    RAISE EXCEPTION 'Você não pode visualizar as tarefas deste ambiente';
  END IF;

  RETURN QUERY
  SELECT task.*
  FROM public.tasks task
  WHERE task.workspace_id = target_workspace_id
    AND task.deleted_at IS NULL
  ORDER BY task.position, task.created_at DESC;
END;
$$;


--
-- Name: magalhaes_consultoria_only_membership(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.magalhaes_consultoria_only_membership() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = NEW.workspace_id AND slug = 'consultoria') THEN
    RAISE EXCEPTION 'Somente o ambiente da consultoria está habilitado.';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: mark_recurring_meeting_agenda_item_with_task(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_recurring_meeting_agenda_item_with_task() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.recurring_meeting_agenda_item_id IS NOT NULL THEN
    UPDATE public.recurring_meeting_agenda_items
    SET result = 'task'
    WHERE id = NEW.recurring_meeting_agenda_item_id
      AND result IS DISTINCT FROM 'task';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: materialize_obligations(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.materialize_obligations(p_horizon_days integer DEFAULT 180) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  obligation_record public.obligations%ROWTYPE;
  candidate date;
  generated_count integer := 0;
  inserted_count integer;
  occurrence_record record;
BEGIN
  p_horizon_days := greatest(30, least(coalesce(p_horizon_days, 180), 730));

  FOR obligation_record IN
    SELECT * FROM public.obligations obligation
    WHERE obligation.is_active
      AND (
        auth.uid() IS NULL
        OR obligation.workspace_id = public.current_workspace_id()
      )
  LOOP
    FOR candidate IN
      SELECT day_value::date
      FROM generate_series(
        greatest(CURRENT_DATE, obligation_record.start_date)::timestamp,
        least(
          CURRENT_DATE + p_horizon_days,
          coalesce(obligation_record.end_date, CURRENT_DATE + p_horizon_days)
        )::timestamp,
        interval '1 day'
      ) day_value
    LOOP
      IF public.obligation_matches_date(obligation_record, candidate) THEN
        INSERT INTO public.obligation_occurrences (
          workspace_id, obligation_id, due_date, due_time
        ) VALUES (
          obligation_record.workspace_id,
          obligation_record.id,
          candidate,
          obligation_record.due_time
        )
        ON CONFLICT (obligation_id, due_date) DO NOTHING;
        GET DIAGNOSTICS inserted_count = ROW_COUNT;
        generated_count := generated_count + inserted_count;
      END IF;
    END LOOP;
  END LOOP;

  FOR occurrence_record IN
    SELECT occurrence.id
    FROM public.obligation_occurrences occurrence
    JOIN public.obligations obligation ON obligation.id = occurrence.obligation_id
    WHERE occurrence.task_id IS NULL
      AND occurrence.status = 'scheduled'
      AND obligation.is_active
      AND occurrence.due_date - obligation.create_before_days <= CURRENT_DATE
      AND (auth.uid() IS NULL OR occurrence.workspace_id = public.current_workspace_id())
    ORDER BY occurrence.due_date
  LOOP
    PERFORM public.create_obligation_task(occurrence_record.id);
  END LOOP;

  RETURN generated_count;
END;
$$;


--
-- Name: materialize_recurring_meetings(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.materialize_recurring_meetings(p_horizon_days integer DEFAULT 180) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  recurring_meeting_record public.recurring_meetings%ROWTYPE;
  candidate date;
  generated_count integer := 0;
  inserted_count integer;
  occurrence_record record;
  local_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  p_horizon_days := greatest(30, least(coalesce(p_horizon_days, 180), 730));

  FOR recurring_meeting_record IN
    SELECT * FROM public.recurring_meetings recurring_meeting
    WHERE recurring_meeting.is_active
      AND (auth.uid() IS NULL OR recurring_meeting.workspace_id = public.current_workspace_id())
  LOOP
    FOR candidate IN
      SELECT day_value::date
      FROM generate_series(
        greatest(local_today, recurring_meeting_record.start_date)::timestamp,
        least(
          local_today + p_horizon_days,
          coalesce(recurring_meeting_record.end_date, local_today + p_horizon_days)
        )::timestamp,
        interval '1 day'
      ) day_value
    LOOP
      IF public.recurring_meeting_matches_date(recurring_meeting_record, candidate) THEN
        INSERT INTO public.recurring_meeting_occurrences (
          workspace_id, recurring_meeting_id, due_date, due_time
        ) VALUES (
          recurring_meeting_record.workspace_id,
          recurring_meeting_record.id,
          candidate,
          recurring_meeting_record.due_time
        )
        ON CONFLICT (recurring_meeting_id, due_date) DO NOTHING;
        GET DIAGNOSTICS inserted_count = ROW_COUNT;
        generated_count := generated_count + inserted_count;
      END IF;
    END LOOP;
  END LOOP;

  FOR occurrence_record IN
    SELECT occurrence.id
    FROM public.recurring_meeting_occurrences occurrence
    JOIN public.recurring_meetings recurring_meeting ON recurring_meeting.id = occurrence.recurring_meeting_id
    WHERE occurrence.task_id IS NULL
      AND occurrence.status = 'scheduled'
      AND recurring_meeting.is_active
      AND NOT recurring_meeting.meeting_mode
      AND occurrence.due_date - recurring_meeting.create_before_days <= local_today
      AND (auth.uid() IS NULL OR occurrence.workspace_id = public.current_workspace_id())
    ORDER BY occurrence.due_date
  LOOP
    PERFORM public.create_recurring_meeting_task(occurrence_record.id);
  END LOOP;

  RETURN generated_count;
END;
$$;


--
-- Name: notify_comment_mention(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_comment_mention() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  comment_row record;
  task_row record;
  author_name text;
BEGIN
  SELECT id, task_id, author_id, body INTO comment_row
  FROM public.comments WHERE id = NEW.comment_id;

  IF comment_row.id IS NULL OR NEW.mentioned_user_id = comment_row.author_id THEN
    RETURN NEW;
  END IF;

  SELECT id, title INTO task_row FROM public.tasks WHERE id = comment_row.task_id;
  SELECT COALESCE(full_name, email) INTO author_name
  FROM public.profiles WHERE id = comment_row.author_id;

  -- A mentioned person needs access to the task to be able to read and reply
  -- to the conversation opened from the notification bell.
  PERFORM set_config('app.comment_mention', 'true', true);
  INSERT INTO public.task_collaborators (task_id, collaborator_id, added_by)
  VALUES (task_row.id, NEW.mentioned_user_id, comment_row.author_id)
  ON CONFLICT (task_id, collaborator_id) DO NOTHING;

  -- The assignee may already have received the standard comment notification.
  -- Avoid showing two bell entries for that same message.
  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = NEW.mentioned_user_id
      AND n.task_id = task_row.id
      AND n.type = 'comment'
      AND n.created_at >= now() - interval '10 seconds'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, task_id, type, title, body)
  VALUES (
    NEW.mentioned_user_id,
    task_row.id,
    'mention',
    U&'Voc\00EA foi mencionado em uma tarefa',
    COALESCE(author_name, U&'Algu\00E9m') || U&' mencionou voc\00EA em: ' || task_row.title
  );

  RETURN NEW;
END;
$$;


--
-- Name: notify_mural_post_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_mural_post_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  actor_id uuid := COALESCE(auth.uid(), NEW.created_by);
  actor_name text;
  notification_title text;
  notification_body text;
BEGIN
  SELECT COALESCE(full_name, email, 'Alguém') INTO actor_name FROM public.profiles WHERE id = actor_id;
  IF TG_OP = 'INSERT' THEN
    notification_title := 'Novo post-it no mural';
    notification_body := COALESCE(actor_name, 'Alguém') || ' publicou: ' || NEW.title;
  ELSE
    notification_title := 'Post-it atualizado no mural';
    notification_body := COALESCE(actor_name, 'Alguém') || ' atualizou: ' || NEW.title;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body)
  SELECT profile.id, 'mural_post', notification_title, notification_body
  FROM public.profiles profile
  WHERE profile.is_active = true
    AND profile.id <> actor_id
    AND NOT public.has_role(profile.id, 'client'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.workspace_memberships m
      WHERE m.user_id = profile.id AND m.workspace_id = NEW.workspace_id
    );
  RETURN NEW;
END;
$$;


--
-- Name: notify_service_request_member(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_service_request_member() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  request_title text;
  request_creator uuid;
  actor_name text;
  role_label text;
BEGIN
  SELECT title, created_by
    INTO request_title, request_creator
    FROM public.service_requests
   WHERE id = NEW.request_id;

  -- Não gera pendência para a própria pessoa que criou/adicionou a si mesma.
  IF NEW.user_id = auth.uid() OR NEW.user_id = request_creator THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, email)
    INTO actor_name
    FROM public.profiles
   WHERE id = auth.uid();

  role_label := CASE TG_TABLE_NAME
    WHEN 'service_request_assignees' THEN 'como responsável'
    ELSE 'como participante'
  END;

  INSERT INTO public.notifications (user_id, task_id, type, title, body)
  VALUES (
    NEW.user_id,
    NULL,
    'service_request',
    'Nova solicitação para você',
    COALESCE(actor_name, 'Alguém') || ' adicionou você ' || role_label || ': ' || COALESCE(request_title, 'Solicitação')
  );

  RETURN NEW;
END;
$$;


--
-- Name: notify_subtask_assignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_subtask_assignment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE actor uuid := auth.uid(); assigner_name text; task_title text; clean_title text;
BEGIN
  IF NEW.assignee_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.assignee_id IS NOT DISTINCT FROM NEW.assignee_id THEN RETURN NEW; END IF;
  IF NEW.assignee_id = actor THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name, email) INTO assigner_name FROM public.profiles WHERE id = actor;
  SELECT title INTO task_title FROM public.tasks WHERE id = NEW.task_id;
  clean_title := regexp_replace(COALESCE(NEW.title, ''), '<[^>]+>', '', 'g');
  INSERT INTO public.notifications (user_id, task_id, type, title, body)
  VALUES (NEW.assignee_id, NEW.task_id, 'subtask_assignment',
    U&'Nova subtarefa atribu\00EDda a voc\00EA',
    COALESCE(assigner_name, U&'Algu\00E9m') || ' atribuiu a subtarefa "' || clean_title || '"' ||
    CASE WHEN task_title IS NOT NULL THEN ' em: ' || task_title ELSE '' END);
  RETURN NEW;
END; $$;


--
-- Name: notify_subtask_completion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_subtask_completion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  actor uuid := auth.uid();
  actor_name text;
  task_title text;
  clean_subtask_title text;
  recipient_id uuid;
BEGIN
  -- Only notify on the transition from open to completed.
  IF NEW.done IS NOT TRUE OR OLD.done IS TRUE THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, email) INTO actor_name
  FROM public.profiles
  WHERE id = actor;

  SELECT title INTO task_title
  FROM public.tasks
  WHERE id = NEW.task_id;

  clean_subtask_title := regexp_replace(COALESCE(NEW.title, ''), '<[^>]+>', '', 'g');

  FOR recipient_id IN
    SELECT DISTINCT participant.user_id
    FROM (
      SELECT t.assignee_id AS user_id FROM public.tasks t WHERE t.id = NEW.task_id
      UNION ALL
      SELECT t.created_by AS user_id FROM public.tasks t WHERE t.id = NEW.task_id
      UNION ALL
      SELECT tc.collaborator_id AS user_id FROM public.task_collaborators tc WHERE tc.task_id = NEW.task_id
      UNION ALL
      SELECT s.assignee_id AS user_id FROM public.subtasks s WHERE s.task_id = NEW.task_id
    ) AS participant
    WHERE participant.user_id IS NOT NULL
      AND (actor IS NULL OR participant.user_id <> actor)
  LOOP
    INSERT INTO public.notifications (user_id, task_id, type, title, body)
    VALUES (
      recipient_id,
      NEW.task_id,
      'subtask_completed',
      U&'Subtarefa conclu\00EDda',
      COALESCE(actor_name, U&'Algu\00E9m') || ' concluiu a subtarefa "' || clean_subtask_title || '"'
        || CASE WHEN task_title IS NOT NULL THEN ' em: ' || task_title ELSE '' END
    );
  END LOOP;

  RETURN NEW;
END;
$$;


--
-- Name: notify_task_assignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_task_assignment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE actor uuid := auth.uid(); assigner_name text;
BEGIN
  IF NEW.assignee_id IS NULL OR NEW.is_draft THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.assignee_id IS NOT DISTINCT FROM NEW.assignee_id
     AND NOT OLD.is_draft THEN RETURN NEW; END IF;
  IF NEW.assignee_id = actor THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name, email) INTO assigner_name FROM public.profiles WHERE id = actor;
  INSERT INTO public.notifications (user_id, task_id, type, title, body)
  VALUES (NEW.assignee_id, NEW.id, 'assignment',
    U&'Nova tarefa atribu\00EDda a voc\00EA',
    COALESCE(assigner_name, U&'Algu\00E9m') || ' atribuiu: ' || NEW.title);
  RETURN NEW;
END; $$;


--
-- Name: notify_task_attachment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_task_attachment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE t record; uploader_name text;
BEGIN
  SELECT id, title, assignee_id INTO t FROM public.tasks WHERE id = NEW.task_id;
  IF t.assignee_id IS NULL OR t.assignee_id = NEW.uploaded_by THEN RETURN NEW; END IF;
  SELECT COALESCE(full_name, email) INTO uploader_name FROM public.profiles WHERE id = NEW.uploaded_by;
  INSERT INTO public.notifications (user_id, task_id, type, title, body)
  VALUES (t.assignee_id, t.id, 'attachment', 'Novo arquivo em sua tarefa',
    COALESCE(uploader_name, U&'Algu\00E9m') || ' anexou "' || NEW.file_name || '" em: ' || t.title);
  RETURN NEW;
END; $$;


--
-- Name: notify_task_collaborator_added(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_task_collaborator_added() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  actor uuid := COALESCE(NEW.added_by, auth.uid());
  actor_name text;
  task_title text;
BEGIN
  IF NEW.collaborator_id = actor
     OR current_setting('app.comment_mention', true) = 'true' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, email) INTO actor_name
  FROM public.profiles WHERE id = actor;
  SELECT title INTO task_title FROM public.tasks WHERE id = NEW.task_id;

  INSERT INTO public.notifications (user_id, task_id, type, title, body)
  VALUES (
    NEW.collaborator_id,
    NEW.task_id,
    'collaborator_assignment',
    U&'Voc\00EA foi adicionado como colaborador',
    COALESCE(actor_name, U&'Algu\00E9m') || U&' adicionou voc\00EA como colaborador em: ' || COALESCE(task_title, 'uma tarefa')
  );
  RETURN NEW;
END;
$$;


--
-- Name: notify_task_comment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_task_comment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  t record;
  author_name text;
BEGIN
  SELECT id, title, assignee_id INTO t FROM public.tasks WHERE id = NEW.task_id;
  IF t.assignee_id IS NULL OR t.assignee_id = NEW.author_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, email) INTO author_name
  FROM public.profiles
  WHERE id = NEW.author_id;

  INSERT INTO public.notifications (user_id, task_id, type, title, body)
  VALUES (
    t.assignee_id,
    t.id,
    'comment',
    'Nova observação em sua tarefa',
    COALESCE(author_name, 'Alguém') || ' comentou em: ' || t.title
  );

  RETURN NEW;
END;
$$;


--
-- Name: notify_task_completion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_task_completion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  actor uuid := auth.uid();
  actor_name text;
  recipient_id uuid;
  was_completed boolean := OLD.status = 'done' OR OLD.completed_at IS NOT NULL;
  is_completed boolean := NEW.status = 'done' OR NEW.completed_at IS NOT NULL;
BEGIN
  IF NOT is_completed OR was_completed THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, email) INTO actor_name
  FROM public.profiles
  WHERE id = actor;

  FOR recipient_id IN
    SELECT DISTINCT participant.user_id
    FROM (
      SELECT NEW.assignee_id AS user_id
      UNION ALL
      SELECT NEW.created_by AS user_id
      UNION ALL
      SELECT tc.collaborator_id AS user_id FROM public.task_collaborators tc WHERE tc.task_id = NEW.id
      UNION ALL
      SELECT s.assignee_id AS user_id FROM public.subtasks s WHERE s.task_id = NEW.id
    ) AS participant
    WHERE participant.user_id IS NOT NULL
      AND (actor IS NULL OR participant.user_id <> actor)
  LOOP
    INSERT INTO public.notifications (user_id, task_id, type, title, body)
    VALUES (
      recipient_id,
      NEW.id,
      'task_completed',
      U&'Tarefa conclu\00EDda',
      COALESCE(actor_name, U&'Algu\00E9m') || ' concluiu a tarefa: ' || NEW.title
    );
  END LOOP;

  RETURN NEW;
END;
$$;


--
-- Name: obligations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.obligations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    client_id uuid,
    assignee_id uuid,
    frequency text DEFAULT 'monthly'::text NOT NULL,
    interval_count integer DEFAULT 1 NOT NULL,
    days_of_week smallint[] DEFAULT ARRAY[]::smallint[] NOT NULL,
    days_of_month smallint[] DEFAULT ARRAY[]::smallint[] NOT NULL,
    month_rule text DEFAULT 'specific_days'::text NOT NULL,
    business_days_only boolean DEFAULT false NOT NULL,
    start_date date DEFAULT CURRENT_DATE NOT NULL,
    end_date date,
    create_before_days integer DEFAULT 7 NOT NULL,
    due_time time without time zone,
    priority public.task_priority DEFAULT 'medium'::public.task_priority NOT NULL,
    column_id uuid,
    status_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT obligations_check CHECK (((end_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT obligations_create_before_days_check CHECK (((create_before_days >= 0) AND (create_before_days <= 365))),
    CONSTRAINT obligations_frequency_check CHECK ((frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text]))),
    CONSTRAINT obligations_interval_count_check CHECK (((interval_count >= 1) AND (interval_count <= 365))),
    CONSTRAINT obligations_month_rule_check CHECK ((month_rule = ANY (ARRAY['specific_days'::text, 'last_day'::text, 'last_business_day'::text]))),
    CONSTRAINT obligations_title_check CHECK ((char_length(TRIM(BOTH FROM title)) > 0))
);


--
-- Name: obligation_matches_date(public.obligations, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.obligation_matches_date(obligation public.obligations, candidate date) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
DECLARE
  month_start date;
  month_end date;
  target_date date;
  months_since integer;
  weeks_since integer;
BEGIN
  IF candidate < obligation.start_date
     OR (obligation.end_date IS NOT NULL AND candidate > obligation.end_date) THEN
    RETURN false;
  END IF;

  IF obligation.frequency = 'daily' THEN
    IF mod(candidate - obligation.start_date, obligation.interval_count) <> 0 THEN
      RETURN false;
    END IF;
    RETURN NOT obligation.business_days_only
      OR extract(isodow FROM candidate)::integer BETWEEN 1 AND 5;
  END IF;

  IF obligation.frequency = 'weekly' THEN
    weeks_since := (
      date_trunc('week', candidate)::date - date_trunc('week', obligation.start_date)::date
    ) / 7;
    RETURN mod(weeks_since, obligation.interval_count) = 0
      AND extract(isodow FROM candidate)::smallint = ANY(obligation.days_of_week);
  END IF;

  month_start := date_trunc('month', candidate)::date;
  month_end := (month_start + interval '1 month - 1 day')::date;
  months_since :=
    (extract(year FROM candidate)::integer - extract(year FROM obligation.start_date)::integer) * 12
    + extract(month FROM candidate)::integer - extract(month FROM obligation.start_date)::integer;
  IF mod(months_since, obligation.interval_count) <> 0 THEN RETURN false; END IF;

  IF obligation.month_rule = 'last_day' THEN
    RETURN candidate = month_end;
  END IF;

  IF obligation.month_rule = 'last_business_day' THEN
    target_date := month_end;
    IF extract(isodow FROM target_date)::integer = 6 THEN target_date := target_date - 1; END IF;
    IF extract(isodow FROM target_date)::integer = 7 THEN target_date := target_date - 2; END IF;
    RETURN candidate = target_date;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM unnest(obligation.days_of_month) configured_day
    WHERE candidate = make_date(
      extract(year FROM candidate)::integer,
      extract(month FROM candidate)::integer,
      least(configured_day::integer, extract(day FROM month_end)::integer)
    )
  );
END;
$$;


--
-- Name: participates_in_task(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.participates_in_task(_task_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    WHERE t.id = _task_id
      -- Membro do ambiente da tarefa não entra por aqui: ele já tem o caminho
      -- normal, e conceder acesso extra faria um quadro derramar no outro.
      AND NOT EXISTS (
        SELECT 1 FROM public.workspace_memberships m
        WHERE m.workspace_id = t.workspace_id AND m.user_id = auth.uid()
      )
      -- Os três vínculos de atribuição do sistema. created_by saiu de propósito:
      -- criar uma tarefa para o outro ambiente não é participar do trabalho
      -- dela, e era o que mais poluía o quadro de destino.
      AND (
        t.assignee_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.task_collaborators tc
          WHERE tc.task_id = t.id AND tc.collaborator_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.subtasks s
          WHERE s.task_id = t.id AND s.assignee_id = auth.uid()
        )
      )
  )
$$;


--
-- Name: prepare_meeting_calendar_events(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prepare_meeting_calendar_events(target_meeting_id uuid DEFAULT NULL::uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  occurrence_id uuid;
  prepared_count integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND target_meeting_id IS NULL THEN
    RAISE EXCEPTION 'Informe a reunião';
  END IF;
  FOR occurrence_id IN
    SELECT occurrence.id
    FROM public.recurring_meeting_occurrences occurrence
    JOIN public.recurring_meetings meeting ON meeting.id = occurrence.recurring_meeting_id
    WHERE (target_meeting_id IS NULL OR meeting.id = target_meeting_id)
      AND (auth.uid() IS NULL OR public.has_workspace_access(meeting.workspace_id))
      AND (occurrence.due_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
           OR EXISTS (SELECT 1 FROM public.calendar_events event
                      WHERE event.recurring_meeting_occurrence_id = occurrence.id))
      AND (occurrence.due_date <= (now() AT TIME ZONE 'America/Sao_Paulo')::date + 30
           OR NOT meeting.is_recurring
           OR EXISTS (SELECT 1 FROM public.calendar_events event
                      WHERE event.recurring_meeting_occurrence_id = occurrence.id))
  LOOP
    PERFORM public.sync_meeting_calendar_event(occurrence_id);
    prepared_count := prepared_count + 1;
  END LOOP;
  RETURN prepared_count;
END;
$$;


--
-- Name: prepare_obligation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prepare_obligation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN NEW.created_by := auth.uid(); END IF;
    IF NEW.workspace_id IS NULL THEN NEW.workspace_id := public.current_workspace_id(); END IF;
  END IF;

  NEW.title := trim(NEW.title);
  NEW.description := nullif(trim(coalesce(NEW.description, '')), '');
  NEW.days_of_week := ARRAY(
    SELECT DISTINCT day_value
    FROM unnest(NEW.days_of_week) AS day_value
    ORDER BY day_value
  );
  NEW.days_of_month := ARRAY(
    SELECT DISTINCT day_value
    FROM unnest(NEW.days_of_month) AS day_value
    ORDER BY day_value
  );

  IF EXISTS (
    SELECT 1 FROM unnest(NEW.days_of_week) AS day_value
    WHERE day_value < 1 OR day_value > 7
  ) THEN
    RAISE EXCEPTION 'Os dias da semana devem estar entre 1 e 7';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.days_of_month) AS day_value
    WHERE day_value < 1 OR day_value > 31
  ) THEN
    RAISE EXCEPTION 'Os dias do mês devem estar entre 1 e 31';
  END IF;
  IF NEW.frequency = 'weekly' AND cardinality(NEW.days_of_week) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um dia da semana';
  END IF;
  IF NEW.frequency = 'monthly'
     AND NEW.month_rule = 'specific_days'
     AND cardinality(NEW.days_of_month) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um dia do mês';
  END IF;
  IF NEW.client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients client
    WHERE client.id = NEW.client_id AND client.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'O cliente não pertence ao ambiente atual';
  END IF;
  IF NEW.assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships membership
    WHERE membership.workspace_id = NEW.workspace_id
      AND membership.user_id = NEW.assignee_id
  ) THEN
    RAISE EXCEPTION 'O responsável não pertence ao ambiente atual';
  END IF;
  IF NEW.column_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.kanban_columns kanban_column
    WHERE kanban_column.id = NEW.column_id
      AND kanban_column.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'A coluna não pertence ao ambiente atual';
  END IF;
  IF NEW.status_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.task_statuses task_status
    WHERE task_status.id = NEW.status_id
      AND task_status.workspace_id = NEW.workspace_id
      AND NOT task_status.is_completed
  ) THEN
    RAISE EXCEPTION 'O status inicial precisa ser um status aberto do ambiente atual';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: prepare_recurring_meeting(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prepare_recurring_meeting() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN NEW.created_by := auth.uid(); END IF;
    IF NEW.workspace_id IS NULL THEN NEW.workspace_id := public.current_workspace_id(); END IF;
  END IF;

  NEW.title := trim(NEW.title);
  NEW.description := nullif(trim(coalesce(NEW.description, '')), '');
  NEW.days_of_week := ARRAY(
    SELECT DISTINCT day_value
    FROM unnest(NEW.days_of_week) AS day_value
    ORDER BY day_value
  );
  NEW.days_of_month := ARRAY(
    SELECT DISTINCT day_value
    FROM unnest(NEW.days_of_month) AS day_value
    ORDER BY day_value
  );

  IF EXISTS (
    SELECT 1 FROM unnest(NEW.days_of_week) AS day_value
    WHERE day_value < 1 OR day_value > 7
  ) THEN
    RAISE EXCEPTION 'Os dias da semana devem estar entre 1 e 7';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.days_of_month) AS day_value
    WHERE day_value < 1 OR day_value > 31
  ) THEN
    RAISE EXCEPTION 'Os dias do mês devem estar entre 1 e 31';
  END IF;
  IF NEW.frequency = 'weekly' AND cardinality(NEW.days_of_week) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um dia da semana';
  END IF;
  IF NEW.frequency = 'monthly'
     AND NEW.month_rule = 'specific_days'
     AND cardinality(NEW.days_of_month) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um dia do mês';
  END IF;
  IF NEW.client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients client
    WHERE client.id = NEW.client_id AND client.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'O cliente não pertence ao ambiente atual';
  END IF;
  IF NEW.assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships membership
    WHERE membership.workspace_id = NEW.workspace_id
      AND membership.user_id = NEW.assignee_id
  ) THEN
    RAISE EXCEPTION 'O responsável não pertence ao ambiente atual';
  END IF;
  IF NEW.column_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.kanban_columns kanban_column
    WHERE kanban_column.id = NEW.column_id
      AND kanban_column.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'A coluna não pertence ao ambiente atual';
  END IF;
  IF NEW.status_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.task_statuses task_status
    WHERE task_status.id = NEW.status_id
      AND task_status.workspace_id = NEW.workspace_id
      AND NOT task_status.is_completed
  ) THEN
    RAISE EXCEPTION 'O status inicial precisa ser um status aberto do ambiente atual';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: prepare_recurring_meeting_agenda(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prepare_recurring_meeting_agenda(target_occurrence_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  occurrence_record public.recurring_meeting_occurrences%ROWTYPE;
  inserted_count integer;
BEGIN
  SELECT * INTO occurrence_record
  FROM public.recurring_meeting_occurrences
  WHERE id = target_occurrence_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reunião não encontrada'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_workspace_access(occurrence_record.workspace_id) THEN
    RAISE EXCEPTION 'Você não pode alterar esta reunião';
  END IF;
  IF occurrence_record.agenda_prepared_at IS NOT NULL THEN RETURN 0; END IF;

  INSERT INTO public.recurring_meeting_agenda_items (occurrence_id, template_id, title, position)
  SELECT target_occurrence_id, preview.template_id, preview.title, preview.position
  FROM public.recurring_meeting_agenda_preview(target_occurrence_id) preview
  ON CONFLICT (occurrence_id, template_id) WHERE template_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  UPDATE public.recurring_meeting_occurrences
  SET agenda_prepared_at = now()
  WHERE id = target_occurrence_id;
  RETURN inserted_count;
END;
$$;


--
-- Name: prepare_recurring_meeting_agenda_item(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prepare_recurring_meeting_agenda_item() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN NEW.created_by := auth.uid(); END IF;
  NEW.title := trim(NEW.title);
  IF NEW.result IS NULL THEN
    NEW.resolved_by := NULL;
    NEW.resolved_at := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW.result IS DISTINCT FROM OLD.result THEN
    NEW.resolved_by := coalesce(auth.uid(), NEW.resolved_by);
    NEW.resolved_at := now();
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: prepare_recurring_meeting_agenda_template(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prepare_recurring_meeting_agenda_template() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN NEW.created_by := auth.uid(); END IF;
  NEW.title := trim(NEW.title);
  NEW.description := nullif(trim(coalesce(NEW.description, '')), '');
  RETURN NEW;
END;
$$;


--
-- Name: prepare_recurring_meeting_department(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prepare_recurring_meeting_department() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN NEW.created_by := auth.uid(); END IF;
    IF NEW.workspace_id IS NULL THEN NEW.workspace_id := public.current_workspace_id(); END IF;
  END IF;
  NEW.name := trim(NEW.name);
  NEW.description := nullif(trim(coalesce(NEW.description, '')), '');
  RETURN NEW;
END;
$$;


--
-- Name: prevent_assignee_subtask_deletion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_assignee_subtask_deletion() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  task_creator uuid;
BEGIN
  SELECT created_by INTO task_creator FROM public.tasks WHERE id = OLD.task_id;

  IF OLD.assignee_id = auth.uid()
     AND task_creator IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Apenas o criador da tarefa ou um administrador pode excluir esta subtarefa.';
  END IF;

  RETURN OLD;
END;
$$;


--
-- Name: prevent_assignee_task_cancellation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_assignee_task_cancellation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN
    RETURN NEW;
  END IF;

  IF OLD.assignee_id = auth.uid()
     AND OLD.created_by IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Apenas o criador ou um administrador pode cancelar esta tarefa.';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: prevent_inactive_client_obligation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_inactive_client_obligation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.client_id IS NULL OR NEW.is_active = false THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id
     AND OLD.is_active = true THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.clients client
       WHERE client.id = NEW.client_id AND client.is_active = false
     ) THEN
    RAISE EXCEPTION 'Nao e possivel ativar uma obrigacao para um cliente inativo';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: prevent_inactive_client_service_request(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_inactive_client_service_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.clients client
       WHERE client.id = NEW.client_id AND client.is_active = false
     ) THEN
    RAISE EXCEPTION 'Nao e possivel vincular uma solicitacao a um cliente inativo';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: prevent_inactive_client_task_assignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_inactive_client_task_assignment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.client_id IS NULL OR NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id
     AND OLD.archived_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.clients client
       WHERE client.id = NEW.client_id AND client.is_active = false
     ) THEN
    RAISE EXCEPTION 'Nao e possivel vincular uma tarefa ativa a um cliente inativo';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: record_marketing_deadline_conversation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_marketing_deadline_conversation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  task_id_for_message uuid;
  task_workspace_id uuid;
  subtask_title text;
  actor uuid := auth.uid();
  actor_name text;
  event_time timestamptz := clock_timestamp();
  old_label text;
  new_label text;
  subject_label text;
  body_text text;
  igor_id constant uuid := '76c2c067-e336-4d94-ab99-1247f7b6a0de'::uuid;
BEGIN
  IF OLD.due_date IS NOT DISTINCT FROM NEW.due_date OR actor IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'tasks' THEN
    task_id_for_message := NEW.id;
    task_workspace_id := NEW.workspace_id;
    subject_label := 'da tarefa';
  ELSE
    task_id_for_message := NEW.task_id;
    subtask_title := regexp_replace(coalesce(NEW.title, ''), '<[^>]*>', '', 'g');
    subject_label := format('da subtarefa "%s"', subtask_title);
    SELECT t.workspace_id INTO task_workspace_id
      FROM public.tasks t WHERE t.id = task_id_for_message;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = task_workspace_id AND w.slug = 'marketing'
  ) THEN
    RETURN NEW;
  END IF;

  -- Se a conversa estava concluída, uma mudança de prazo a reabre. Uma tarefa
  -- concluída continua concluída, mas essa conversa pode ser respondida.
  IF TG_TABLE_NAME = 'tasks' THEN
    NEW.conversation_closed_at := NULL;
    NEW.deadline_conversation_active_at := event_time;
  ELSE
    UPDATE public.tasks t
      SET conversation_closed_at = NULL,
          deadline_conversation_active_at = event_time
      WHERE t.id = task_id_for_message;
  END IF;

  INSERT INTO public.task_conversation_followers (task_id, user_id)
  SELECT task_id_for_message, igor_id
  WHERE EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = task_workspace_id AND m.user_id = igor_id
  )
  ON CONFLICT (task_id, user_id) DO NOTHING;

  SELECT coalesce(nullif(p.full_name, ''), p.email, 'Alguém') INTO actor_name
    FROM public.profiles p WHERE p.id = actor;
  old_label := coalesce(to_char(OLD.due_date AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'), 'sem prazo');
  new_label := coalesce(to_char(NEW.due_date AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'), 'sem prazo');
  body_text := format(
    'Prazo %s alterado por %s: %s → %s em %s (horário de Brasília).',
    subject_label, coalesce(actor_name, 'Alguém'), old_label, new_label,
    to_char(event_time AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
  );
  INSERT INTO public.comments (task_id, author_id, body, title, created_at)
    VALUES (task_id_for_message, actor, body_text, 'Alteração de prazo', event_time);

  RETURN NEW;
END;
$$;


--
-- Name: record_task_card_open(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_task_card_open(target_task_id uuid, opened_at timestamp with time zone DEFAULT now()) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE actor uuid := auth.uid(); observed timestamptz := LEAST(opened_at, clock_timestamp());
BEGIN
  IF actor IS NULL OR public.has_role(actor, 'client') THEN
    RAISE EXCEPTION 'Você não pode acessar esta tarefa' USING ERRCODE = '42501';
  END IF;
  IF opened_at IS NULL THEN RAISE EXCEPTION 'Horário de abertura inválido'; END IF;
  PERFORM id FROM public.tasks WHERE id = target_task_id AND deleted_at IS NULL FOR KEY SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT public.can_access_workspace_task(target_task_id) THEN
    RAISE EXCEPTION 'Você não pode acessar esta tarefa' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.task_card_opens AS existing(task_id, user_id, first_opened_at, last_opened_at)
    VALUES (target_task_id, actor, observed, observed)
    ON CONFLICT (task_id, user_id) DO UPDATE SET
      first_opened_at = LEAST(existing.first_opened_at, EXCLUDED.first_opened_at),
      last_opened_at = GREATEST(existing.last_opened_at, EXCLUDED.last_opened_at);
  RETURN true;
END; $$;


--
-- Name: recurring_meeting_agenda_preview(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recurring_meeting_agenda_preview(target_occurrence_id uuid) RETURNS TABLE(template_id uuid, title text, "position" integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  occurrence_record public.recurring_meeting_occurrences%ROWTYPE;
  recurring_meeting_record public.recurring_meetings%ROWTYPE;
BEGIN
  SELECT * INTO occurrence_record
  FROM public.recurring_meeting_occurrences
  WHERE id = target_occurrence_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reunião não encontrada'; END IF;
  IF auth.uid() IS NOT NULL
     AND NOT public.has_workspace_access(occurrence_record.workspace_id)
     AND NOT public.can_view_invited_meeting(occurrence_record.recurring_meeting_id) THEN
    RAISE EXCEPTION 'Você não pode acessar esta reunião';
  END IF;
  SELECT * INTO recurring_meeting_record
  FROM public.recurring_meetings
  WHERE id = occurrence_record.recurring_meeting_id;

  RETURN QUERY
  SELECT template.id, template.title, (row_number() OVER (
    ORDER BY template.position, template.created_at
  ) - 1)::integer
  FROM public.recurring_meeting_agenda_templates template
  WHERE template.recurring_meeting_id = recurring_meeting_record.id
    AND public.recurring_meeting_agenda_template_applies(
      recurring_meeting_record, template, occurrence_record.due_date
    )
  ORDER BY template.position, template.created_at;
END;
$$;


--
-- Name: recurring_meeting_agenda_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurring_meeting_agenda_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recurring_meeting_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    assignee_id uuid,
    priority text,
    "position" integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cadence text DEFAULT 'every'::text NOT NULL,
    cadence_day smallint,
    CONSTRAINT recurring_meeting_agenda_templates_cadence_check CHECK ((cadence = ANY (ARRAY['every'::text, 'biweekly'::text, 'first_of_month'::text, 'last_of_month'::text, 'until_day'::text]))),
    CONSTRAINT recurring_meeting_agenda_templates_cadence_day_check CHECK (((cadence_day >= 1) AND (cadence_day <= 31))),
    CONSTRAINT recurring_meeting_agenda_templates_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT recurring_meeting_agenda_templates_title_check CHECK ((char_length(TRIM(BOTH FROM title)) > 0)),
    CONSTRAINT recurring_meeting_agenda_templates_until_day_check CHECK (((cadence <> 'until_day'::text) OR (cadence_day IS NOT NULL)))
);


--
-- Name: recurring_meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurring_meetings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    client_id uuid,
    assignee_id uuid,
    frequency text DEFAULT 'monthly'::text NOT NULL,
    interval_count integer DEFAULT 1 NOT NULL,
    days_of_week smallint[] DEFAULT ARRAY[]::smallint[] NOT NULL,
    days_of_month smallint[] DEFAULT ARRAY[]::smallint[] NOT NULL,
    month_rule text DEFAULT 'specific_days'::text NOT NULL,
    business_days_only boolean DEFAULT false NOT NULL,
    start_date date DEFAULT CURRENT_DATE NOT NULL,
    end_date date,
    create_before_days integer DEFAULT 7 NOT NULL,
    due_time time without time zone,
    priority public.task_priority DEFAULT 'medium'::public.task_priority NOT NULL,
    column_id uuid,
    status_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    department_id uuid,
    meeting_mode boolean DEFAULT true NOT NULL,
    reminder_days_before integer DEFAULT 2 NOT NULL,
    is_recurring boolean DEFAULT true NOT NULL,
    create_google_meet boolean DEFAULT false NOT NULL,
    auto_smart_notes boolean DEFAULT true NOT NULL,
    auto_transcription boolean DEFAULT false NOT NULL,
    google_calendar_id text,
    duration_minutes integer DEFAULT 60 NOT NULL,
    add_to_calendar boolean DEFAULT false NOT NULL,
    meeting_location text,
    meeting_attendee_emails text[] DEFAULT ARRAY[]::text[] NOT NULL,
    manual_meeting_url text,
    archived_at timestamp with time zone,
    CONSTRAINT recurring_meetings_archived_inactive CHECK (((archived_at IS NULL) OR (NOT is_active))),
    CONSTRAINT recurring_meetings_check CHECK (((end_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT recurring_meetings_create_before_days_check CHECK (((create_before_days >= 0) AND (create_before_days <= 365))),
    CONSTRAINT recurring_meetings_duration_minutes_check CHECK (((duration_minutes >= 15) AND (duration_minutes <= 1440))),
    CONSTRAINT recurring_meetings_frequency_check CHECK ((frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text]))),
    CONSTRAINT recurring_meetings_interval_count_check CHECK (((interval_count >= 1) AND (interval_count <= 365))),
    CONSTRAINT recurring_meetings_month_rule_check CHECK ((month_rule = ANY (ARRAY['specific_days'::text, 'last_day'::text, 'last_business_day'::text]))),
    CONSTRAINT recurring_meetings_reminder_days_before_check CHECK (((reminder_days_before >= 0) AND (reminder_days_before <= 30))),
    CONSTRAINT recurring_meetings_title_check CHECK ((char_length(TRIM(BOTH FROM title)) > 0))
);


--
-- Name: COLUMN recurring_meetings.is_recurring; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.recurring_meetings.is_recurring IS 'Quando false, a reunião possui uma única ocorrência na start_date.';


--
-- Name: recurring_meeting_agenda_template_applies(public.recurring_meetings, public.recurring_meeting_agenda_templates, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recurring_meeting_agenda_template_applies(recurring_meeting public.recurring_meetings, template public.recurring_meeting_agenda_templates, meeting_date date) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
DECLARE
  month_start date := date_trunc('month', meeting_date)::date;
  month_end date := (date_trunc('month', meeting_date) + interval '1 month - 1 day')::date;
  limit_date date;
BEGIN
  IF template.cadence = 'every' THEN RETURN true; END IF;

  IF template.cadence = 'biweekly' THEN
    RETURN mod(
      (date_trunc('week', meeting_date)::date - date_trunc('week', recurring_meeting.start_date)::date) / 7,
      2
    ) = 0;
  END IF;

  IF template.cadence = 'first_of_month' THEN
    RETURN NOT EXISTS (
      SELECT 1 FROM generate_series(month_start, meeting_date - 1, interval '1 day') day_value
      WHERE public.recurring_meeting_matches_date(recurring_meeting, day_value::date)
    );
  END IF;

  IF template.cadence = 'last_of_month' THEN
    RETURN NOT EXISTS (
      SELECT 1 FROM generate_series(meeting_date + 1, month_end, interval '1 day') day_value
      WHERE public.recurring_meeting_matches_date(recurring_meeting, day_value::date)
    );
  END IF;

  -- until_day: a última reunião que acontece até o dia X do mês.
  limit_date := make_date(
    extract(year FROM meeting_date)::integer,
    extract(month FROM meeting_date)::integer,
    least(template.cadence_day, extract(day FROM month_end)::integer)
  );
  RETURN meeting_date <= limit_date AND NOT EXISTS (
    SELECT 1 FROM generate_series(meeting_date + 1, limit_date, interval '1 day') day_value
    WHERE public.recurring_meeting_matches_date(recurring_meeting, day_value::date)
  );
END;
$$;


--
-- Name: recurring_meeting_matches_date(public.recurring_meetings, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recurring_meeting_matches_date(recurring_meeting public.recurring_meetings, candidate date) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
DECLARE
  month_start date;
  month_end date;
  target_date date;
  months_since integer;
  weeks_since integer;
BEGIN
  IF candidate < recurring_meeting.start_date
     OR (recurring_meeting.end_date IS NOT NULL AND candidate > recurring_meeting.end_date) THEN
    RETURN false;
  END IF;

  IF recurring_meeting.frequency = 'daily' THEN
    IF mod(candidate - recurring_meeting.start_date, recurring_meeting.interval_count) <> 0 THEN
      RETURN false;
    END IF;
    RETURN NOT recurring_meeting.business_days_only
      OR extract(isodow FROM candidate)::integer BETWEEN 1 AND 5;
  END IF;

  IF recurring_meeting.frequency = 'weekly' THEN
    weeks_since := (
      date_trunc('week', candidate)::date - date_trunc('week', recurring_meeting.start_date)::date
    ) / 7;
    RETURN mod(weeks_since, recurring_meeting.interval_count) = 0
      AND extract(isodow FROM candidate)::smallint = ANY(recurring_meeting.days_of_week);
  END IF;

  month_start := date_trunc('month', candidate)::date;
  month_end := (month_start + interval '1 month - 1 day')::date;
  months_since :=
    (extract(year FROM candidate)::integer - extract(year FROM recurring_meeting.start_date)::integer) * 12
    + extract(month FROM candidate)::integer - extract(month FROM recurring_meeting.start_date)::integer;
  IF mod(months_since, recurring_meeting.interval_count) <> 0 THEN RETURN false; END IF;

  IF recurring_meeting.month_rule = 'last_day' THEN
    RETURN candidate = month_end;
  END IF;

  IF recurring_meeting.month_rule = 'last_business_day' THEN
    target_date := month_end;
    IF extract(isodow FROM target_date)::integer = 6 THEN target_date := target_date - 1; END IF;
    IF extract(isodow FROM target_date)::integer = 7 THEN target_date := target_date - 2; END IF;
    RETURN candidate = target_date;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM unnest(recurring_meeting.days_of_month) configured_day
    WHERE candidate = make_date(
      extract(year FROM candidate)::integer,
      extract(month FROM candidate)::integer,
      least(configured_day::integer, extract(day FROM month_end)::integer)
    )
  );
END;
$$;


--
-- Name: refresh_obligation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_obligation(target_obligation_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE target_workspace uuid;
BEGIN
  SELECT workspace_id INTO target_workspace FROM public.obligations WHERE id = target_obligation_id;
  IF target_workspace IS NULL THEN RAISE EXCEPTION 'Obrigação não encontrada'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_workspace_access(target_workspace) THEN
    RAISE EXCEPTION 'Você não pode atualizar esta obrigação';
  END IF;

  DELETE FROM public.obligation_occurrences
  WHERE obligation_id = target_obligation_id
    AND task_id IS NULL
    AND status = 'scheduled'
    AND due_date >= CURRENT_DATE;

  RETURN public.materialize_obligations(365);
END;
$$;


--
-- Name: refresh_recurring_meeting(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_recurring_meeting(target_recurring_meeting_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  meeting_record public.recurring_meetings%ROWTYPE;
  inserted_count integer := 0;
BEGIN
  SELECT * INTO meeting_record FROM public.recurring_meetings
  WHERE id = target_recurring_meeting_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reunião não encontrada'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_workspace_access(meeting_record.workspace_id) THEN
    RAISE EXCEPTION 'Você não pode atualizar esta reunião';
  END IF;

  IF NOT meeting_record.is_recurring THEN
    IF NOT meeting_record.is_active THEN RETURN 0; END IF;
    UPDATE public.recurring_meeting_occurrences
    SET due_date = meeting_record.start_date, due_time = meeting_record.due_time
    WHERE recurring_meeting_id = meeting_record.id
      AND task_id IS NULL AND status = 'scheduled'
      AND (due_date IS DISTINCT FROM meeting_record.start_date
           OR due_time IS DISTINCT FROM meeting_record.due_time);
    INSERT INTO public.recurring_meeting_occurrences (
      workspace_id, recurring_meeting_id, due_date, due_time
    ) VALUES (
      meeting_record.workspace_id, meeting_record.id,
      meeting_record.start_date, meeting_record.due_time
    ) ON CONFLICT (recurring_meeting_id, due_date) DO NOTHING;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    RETURN inserted_count;
  END IF;

  DELETE FROM public.recurring_meeting_occurrences occurrence
  WHERE occurrence.recurring_meeting_id = target_recurring_meeting_id
    AND occurrence.task_id IS NULL
    AND occurrence.status = 'scheduled'
    AND occurrence.due_date >= CURRENT_DATE
    AND occurrence.rescheduled_at IS NULL
    AND occurrence.agenda_prepared_at IS NULL
    AND NOT occurrence.calendar_event_disabled
    AND occurrence.calendar_title_override IS NULL
    AND occurrence.calendar_description_override IS NULL
    AND occurrence.calendar_location_override IS NULL
    AND occurrence.calendar_attendee_emails_override IS NULL
    AND occurrence.calendar_duration_minutes_override IS NULL
    AND occurrence.calendar_google_calendar_id_override IS NULL
    AND occurrence.calendar_meeting_url_override IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.calendar_events event
      WHERE event.recurring_meeting_occurrence_id = occurrence.id
    );

  IF NOT meeting_record.is_active THEN RETURN 0; END IF;
  RETURN public.materialize_recurring_meetings(365);
END;
$$;


--
-- Name: remove_meeting_calendar_event(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_meeting_calendar_event(target_event_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  event_record public.calendar_events%ROWTYPE;
  occurrence_record public.recurring_meeting_occurrences%ROWTYPE;
BEGIN
  SELECT * INTO event_record FROM public.calendar_events
  WHERE id = target_event_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR event_record.recurring_meeting_occurrence_id IS NULL THEN
    RAISE EXCEPTION 'Compromisso da reunião não encontrado';
  END IF;
  SELECT * INTO occurrence_record FROM public.recurring_meeting_occurrences
  WHERE id = event_record.recurring_meeting_occurrence_id;
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'client'::public.app_role)
     OR NOT public.has_workspace_access(occurrence_record.workspace_id) THEN
    RAISE EXCEPTION 'Você não pode excluir este compromisso';
  END IF;
  UPDATE public.recurring_meeting_occurrences
  SET calendar_event_disabled = true
  WHERE id = occurrence_record.id;
  UPDATE public.calendar_events
  SET deleted_at = coalesce(deleted_at, now()), deleted_by = auth.uid(),
      updated_by = auth.uid(), sync_status = 'pending'
  WHERE id = target_event_id;
  RETURN true;
END;
$$;


--
-- Name: restore_meeting_calendar_event(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_meeting_calendar_event(target_occurrence_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE target_workspace_id uuid;
BEGIN
  SELECT workspace_id INTO target_workspace_id
  FROM public.recurring_meeting_occurrences WHERE id = target_occurrence_id;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT public.has_workspace_access(target_workspace_id)
     OR public.has_role(auth.uid(), 'client'::public.app_role) THEN
    RAISE EXCEPTION 'Você não pode restaurar este compromisso';
  END IF;
  UPDATE public.recurring_meeting_occurrences
  SET calendar_event_disabled = false WHERE id = target_occurrence_id;
  PERFORM public.sync_meeting_calendar_event(target_occurrence_id);
  RETURN true;
END;
$$;


--
-- Name: run_recurring_meeting_cycle(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.run_recurring_meeting_cycle() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  local_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  meeting record;
  reminded_count integer := 0;
BEGIN
  PERFORM public.materialize_recurring_meetings(180);

  FOR meeting IN
    SELECT occurrence.id, occurrence.due_date, occurrence.reminded_at,
           recurring_meeting.id AS recurring_meeting_id, recurring_meeting.title, recurring_meeting.assignee_id
    FROM public.recurring_meeting_occurrences occurrence
    JOIN public.recurring_meetings recurring_meeting ON recurring_meeting.id = occurrence.recurring_meeting_id
    WHERE occurrence.status IN ('scheduled', 'open')
      AND recurring_meeting.is_active
      AND recurring_meeting.meeting_mode
      AND occurrence.due_date >= local_today
      AND occurrence.due_date - recurring_meeting.reminder_days_before <= local_today
      AND (auth.uid() IS NULL OR occurrence.workspace_id = public.current_workspace_id())
    ORDER BY occurrence.due_date
  LOOP
    PERFORM public.prepare_recurring_meeting_agenda(meeting.id);

    IF meeting.reminded_at IS NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, recurring_meeting_occurrence_id)
      SELECT recipient.user_id,
             'recurring_meeting_reminder',
             'Reunião em ' || to_char(meeting.due_date, 'DD/MM') || ': ' || meeting.title,
             'Revise a pauta e inclua novos assuntos antes da reunião.',
             meeting.id
      FROM (
        SELECT participant.user_id
        FROM public.recurring_meeting_participants participant
        WHERE participant.recurring_meeting_id = meeting.recurring_meeting_id
        UNION
        SELECT meeting.assignee_id WHERE meeting.assignee_id IS NOT NULL
      ) recipient
      ON CONFLICT (user_id, recurring_meeting_occurrence_id, type)
        WHERE recurring_meeting_occurrence_id IS NOT NULL
        DO NOTHING;

      UPDATE public.recurring_meeting_occurrences SET reminded_at = now() WHERE id = meeting.id;
      reminded_count := reminded_count + 1;
    END IF;
  END LOOP;

  RETURN reminded_count;
END;
$$;


--
-- Name: seed_user_kanban_defaults(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_user_kanban_defaults(_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.task_statuses WHERE created_by = _user_id
  ) THEN
    INSERT INTO public.task_statuses
      (name, color, position, is_completed, is_active, created_by)
    VALUES
      ('Em andamento', '#3b82f6', 0, false, true,  _user_id),
      ('Concluída',    '#10b981', 1, true,  false, _user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.kanban_columns WHERE created_by = _user_id
  ) THEN
    INSERT INTO public.kanban_columns
      (name, color, position, created_by)
    VALUES
      ('A fazer', '#64748b', 0, _user_id);
  END IF;
END
$$;


--
-- Name: select_active_workspace(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.select_active_workspace(target_workspace_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  current_user_id UUID := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to select a TaskFlow environment';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_memberships
    WHERE workspace_id = target_workspace_id
      AND user_id = current_user_id
  ) THEN
    RAISE EXCEPTION 'You do not have access to this TaskFlow environment';
  END IF;

  UPDATE public.profiles
  SET active_workspace_id = target_workspace_id
  WHERE id = current_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TaskFlow profile was not found';
  END IF;

  RETURN target_workspace_id;
END;
$$;


--
-- Name: set_calendar_event_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_calendar_event_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: set_calendar_google_connection_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_calendar_google_connection_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: set_calendar_source_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_calendar_source_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: set_client_file_uploaded_by(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_client_file_uploaded_by() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.uploaded_by IS NULL THEN NEW.uploaded_by := auth.uid(); END IF;
  RETURN NEW;
END $$;


--
-- Name: set_client_invoices_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_client_invoices_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


--
-- Name: set_client_note_created_by(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_client_note_created_by() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END $$;


--
-- Name: set_client_user_links_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_client_user_links_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


--
-- Name: set_created_by_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_created_by_owner() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.created_by IS NULL THEN NEW.created_by := auth.uid(); END IF;
  RETURN NEW;
END $$;


--
-- Name: set_marketing_admin_visibility(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_marketing_admin_visibility(enabled boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RAISE EXCEPTION 'Marketing não está disponível no sistema Magalhães Advocacia.';
END;
$$;


--
-- Name: set_marketing_user_access(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_marketing_user_access(target_user_id uuid, enabled boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RAISE EXCEPTION 'Marketing não está disponível no sistema Magalhães Advocacia.';
END;
$$;


--
-- Name: set_meeting_minutes_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_meeting_minutes_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: set_service_request_creator(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_service_request_creator() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.created_by = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: set_task_conversation_read(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_task_conversation_read(target_task_id uuid, mark_unread boolean DEFAULT false) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF target_task_id IS NULL OR mark_unread IS NULL THEN
    RETURN false;
  END IF;

  -- Lock the parent until the receipt is saved. If the task disappeared or is
  -- not visible under RLS, leave the receipt untouched instead of violating FK.
  PERFORM t.id FROM public.tasks t
  WHERE t.id = target_task_id AND t.deleted_at IS NULL
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.task_conversation_reads AS existing
    (user_id, task_id, last_read_at, manual_unread)
  VALUES (actor, target_task_id, CASE WHEN mark_unread THEN '1970-01-01 00:00:00+00'::timestamptz ELSE clock_timestamp() END, mark_unread)
  ON CONFLICT (user_id, task_id) DO UPDATE
    SET last_read_at = CASE WHEN mark_unread THEN existing.last_read_at
                           ELSE GREATEST(existing.last_read_at, EXCLUDED.last_read_at) END,
        manual_unread = EXCLUDED.manual_unread;
  RETURN true;
END;
$$;


--
-- Name: set_task_created_by(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_task_created_by() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.created_by := auth.uid();
    ELSIF NEW.created_by IS NULL THEN
      RAISE EXCEPTION 'created_by is required for server-side task creation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: set_task_personal_pin(uuid, boolean, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_task_personal_pin(target_task_id uuid, pinned boolean, changed_at timestamp with time zone DEFAULT now()) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE actor uuid := auth.uid(); observed timestamptz := LEAST(changed_at, clock_timestamp());
BEGIN
  IF actor IS NULL OR public.has_role(actor, 'client') THEN
    RAISE EXCEPTION 'Você não pode acessar esta tarefa' USING ERRCODE = '42501';
  END IF;
  IF pinned IS NULL OR changed_at IS NULL THEN RAISE EXCEPTION 'Prioridade pessoal inválida'; END IF;
  PERFORM id FROM public.tasks WHERE id = target_task_id AND deleted_at IS NULL FOR KEY SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT public.can_access_workspace_task(target_task_id) THEN
    RAISE EXCEPTION 'Você não pode acessar esta tarefa' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.task_personal_pins AS existing(task_id, user_id, is_pinned, changed_at)
    VALUES (target_task_id, actor, pinned, observed)
    ON CONFLICT (task_id, user_id) DO UPDATE SET
      is_pinned = EXCLUDED.is_pinned, changed_at = EXCLUDED.changed_at
    WHERE existing.changed_at <= EXCLUDED.changed_at;
  RETURN true;
END; $$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


--
-- Name: set_user_permissions_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_user_permissions_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: sync_consultoria_client_to_marketing(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_consultoria_client_to_marketing() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  consultoria_id uuid;
  marketing_id uuid;
BEGIN
  SELECT id INTO consultoria_id FROM public.workspaces WHERE slug = 'consultoria';
  SELECT id INTO marketing_id FROM public.workspaces WHERE slug = 'marketing';

  IF NEW.workspace_id <> consultoria_id OR NEW.source_client_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.clients (
    workspace_id, source_client_id, name, color, description, created_by,
    cnpj, legal_name, trade_name, state_registration, municipal_registration,
    address, phone, email, responsible, avatar_path, is_active
  ) VALUES (
    marketing_id, NEW.id, NEW.name, NEW.color, NEW.description, NEW.created_by,
    NEW.cnpj, NEW.legal_name, NEW.trade_name, NEW.state_registration,
    NEW.municipal_registration, NEW.address, NEW.phone, NEW.email,
    NEW.responsible, NEW.avatar_path, NEW.is_active
  )
  ON CONFLICT (workspace_id, source_client_id) WHERE source_client_id IS NOT NULL
  DO UPDATE SET
    name = EXCLUDED.name,
    color = EXCLUDED.color,
    description = EXCLUDED.description,
    cnpj = EXCLUDED.cnpj,
    legal_name = EXCLUDED.legal_name,
    trade_name = EXCLUDED.trade_name,
    state_registration = EXCLUDED.state_registration,
    municipal_registration = EXCLUDED.municipal_registration,
    address = EXCLUDED.address,
    phone = EXCLUDED.phone,
    email = EXCLUDED.email,
    responsible = EXCLUDED.responsible,
    avatar_path = EXCLUDED.avatar_path,
    is_active = EXCLUDED.is_active;

  RETURN NEW;
END;
$$;


--
-- Name: sync_meeting_agenda_from_task(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_meeting_agenda_from_task() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  item_id uuid;
  old_item_id uuid;
  has_pending boolean;
  has_active boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN old_item_id := OLD.recurring_meeting_agenda_item_id; END IF;
  FOR item_id IN
    SELECT DISTINCT linked.id
    FROM (VALUES (NEW.recurring_meeting_agenda_item_id),
                 (old_item_id)) linked(id)
    WHERE linked.id IS NOT NULL
  LOOP
    SELECT
      EXISTS (
        SELECT 1 FROM public.tasks task
        WHERE task.recurring_meeting_agenda_item_id = item_id
          AND task.deleted_at IS NULL AND task.archived_at IS NULL
      ),
      EXISTS (
        SELECT 1 FROM public.tasks task
        WHERE task.recurring_meeting_agenda_item_id = item_id
          AND task.deleted_at IS NULL AND task.archived_at IS NULL
          AND NOT (
            task.status = 'done'::public.task_status
            OR task.completed_at IS NOT NULL
            OR EXISTS (
              SELECT 1 FROM public.task_statuses status
              WHERE status.id = task.status_id AND status.is_completed
            )
          )
      )
    INTO has_active, has_pending;

    IF has_active THEN
      UPDATE public.recurring_meeting_agenda_items item
      SET result = CASE WHEN has_pending THEN 'task' ELSE 'done' END
      WHERE item.id = item_id
        AND item.result IS DISTINCT FROM CASE WHEN has_pending THEN 'task' ELSE 'done' END;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;


--
-- Name: sync_meeting_calendar_event(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_meeting_calendar_event(target_occurrence_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  meeting_record public.recurring_meetings%ROWTYPE;
  occurrence_record public.recurring_meeting_occurrences%ROWTYPE;
  existing_event public.calendar_events%ROWTYPE;
  event_start timestamptz;
  event_end timestamptz;
  event_id uuid;
  event_title text;
  event_description text;
  event_location text;
  event_attendees text[];
  event_calendar_id text;
  event_manual_url text;
  previous_sync_flag text;
BEGIN
  SELECT * INTO occurrence_record
  FROM public.recurring_meeting_occurrences
  WHERE id = target_occurrence_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reunião não encontrada'; END IF;

  SELECT * INTO meeting_record
  FROM public.recurring_meetings
  WHERE id = occurrence_record.recurring_meeting_id;
  IF auth.uid() IS NOT NULL AND NOT public.has_workspace_access(meeting_record.workspace_id) THEN
    RAISE EXCEPTION 'Você não pode alterar esta reunião';
  END IF;

  SELECT * INTO existing_event
  FROM public.calendar_events
  WHERE recurring_meeting_occurrence_id = target_occurrence_id;

  IF NOT meeting_record.add_to_calendar OR NOT meeting_record.is_active
     OR occurrence_record.calendar_event_disabled
     OR occurrence_record.status = 'skipped' THEN
    IF existing_event.id IS NOT NULL AND existing_event.deleted_at IS NULL THEN
      UPDATE public.calendar_events
      SET deleted_at = now(), deleted_by = auth.uid(),
          updated_by = coalesce(auth.uid(), meeting_record.created_by),
          sync_status = 'pending'
      WHERE id = existing_event.id;
    END IF;
    RETURN existing_event.id;
  END IF;

  IF occurrence_record.due_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date
     AND existing_event.id IS NULL THEN RETURN NULL; END IF;

  IF meeting_record.is_recurring
     AND occurrence_record.due_date > (now() AT TIME ZONE 'America/Sao_Paulo')::date + 30
     AND existing_event.id IS NULL THEN RETURN NULL; END IF;

  event_title := coalesce(occurrence_record.calendar_title_override, meeting_record.title);
  event_description := nullif(coalesce(occurrence_record.calendar_description_override,
                                       meeting_record.description), '');
  event_location := nullif(coalesce(occurrence_record.calendar_location_override,
                                    meeting_record.meeting_location), '');
  event_attendees := coalesce(occurrence_record.calendar_attendee_emails_override,
                              meeting_record.meeting_attendee_emails);
  event_calendar_id := coalesce(occurrence_record.calendar_google_calendar_id_override,
                               meeting_record.google_calendar_id);
  event_manual_url := nullif(coalesce(occurrence_record.calendar_meeting_url_override,
                                     meeting_record.manual_meeting_url), '');
  event_start := (occurrence_record.due_date + coalesce(occurrence_record.due_time, '09:00'::time))
    AT TIME ZONE 'America/Sao_Paulo';
  event_end := event_start + make_interval(
    mins => coalesce(occurrence_record.calendar_duration_minutes_override,
                     meeting_record.duration_minutes)
  );

  previous_sync_flag := current_setting('taskflow.meeting_calendar_sync', true);
  PERFORM set_config('taskflow.meeting_calendar_sync', 'true', true);
  IF existing_event.id IS NULL THEN
    INSERT INTO public.calendar_events (
      title, description, starts_at, ends_at, is_all_day, location, attendee_emails,
      meeting_url, create_google_meet, auto_smart_notes, auto_transcription,
      google_calendar_id, created_by, updated_by, source, sync_status,
      recurring_meeting_occurrence_id
    ) VALUES (
      event_title, event_description, event_start, event_end, false,
      event_location, event_attendees,
      CASE WHEN meeting_record.create_google_meet THEN NULL ELSE event_manual_url END,
      meeting_record.create_google_meet,
      meeting_record.create_google_meet AND meeting_record.auto_smart_notes,
      meeting_record.create_google_meet AND meeting_record.auto_transcription,
      event_calendar_id, meeting_record.created_by,
      coalesce(auth.uid(), meeting_record.created_by), 'taskflow', 'pending',
      occurrence_record.id
    ) RETURNING id INTO event_id;
  ELSE
    UPDATE public.calendar_events event
    SET title = event_title,
        description = event_description,
        starts_at = event_start,
        ends_at = event_end,
        location = event_location,
        attendee_emails = event_attendees,
        google_calendar_id = event_calendar_id,
        auto_smart_notes = meeting_record.create_google_meet AND meeting_record.auto_smart_notes,
        auto_transcription = meeting_record.create_google_meet AND meeting_record.auto_transcription,
        create_google_meet = meeting_record.create_google_meet AND (
          event.meeting_url IS NULL
          OR event.meeting_url !~* '^https://meet[.]google[.]com/'
          OR event.auto_smart_notes IS DISTINCT FROM meeting_record.auto_smart_notes
          OR event.auto_transcription IS DISTINCT FROM meeting_record.auto_transcription
        ),
        meeting_url = CASE WHEN meeting_record.create_google_meet
                           THEN CASE WHEN event.meeting_url ~* '^https://meet[.]google[.]com/'
                                     THEN event.meeting_url ELSE NULL END
                           ELSE event_manual_url END,
        deleted_at = NULL,
        deleted_by = NULL,
        updated_by = coalesce(auth.uid(), meeting_record.created_by),
        sync_status = 'pending'
    WHERE event.id = existing_event.id
      AND (
        event.title IS DISTINCT FROM event_title
        OR event.description IS DISTINCT FROM event_description
        OR event.starts_at IS DISTINCT FROM event_start
        OR event.ends_at IS DISTINCT FROM event_end
        OR event.location IS DISTINCT FROM event_location
        OR event.attendee_emails IS DISTINCT FROM event_attendees
        OR event.google_calendar_id IS DISTINCT FROM event_calendar_id
        OR event.auto_smart_notes IS DISTINCT FROM
          (meeting_record.create_google_meet AND meeting_record.auto_smart_notes)
        OR event.auto_transcription IS DISTINCT FROM
          (meeting_record.create_google_meet AND meeting_record.auto_transcription)
        OR event.create_google_meet IS DISTINCT FROM
          (meeting_record.create_google_meet AND event.meeting_url IS NULL)
        OR (meeting_record.create_google_meet AND event.meeting_url IS NOT NULL
            AND event.meeting_url !~* '^https://meet[.]google[.]com/')
        OR (NOT meeting_record.create_google_meet
            AND event.meeting_url IS DISTINCT FROM event_manual_url)
        OR event.deleted_at IS NOT NULL
      );
    event_id := existing_event.id;
  END IF;
  PERFORM set_config('taskflow.meeting_calendar_sync', coalesce(previous_sync_flag, ''), true);
  RETURN event_id;
END;
$$;


--
-- Name: sync_meeting_calendar_event_on_occurrence(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_meeting_calendar_event_on_occurrence() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.calendar_events
    SET deleted_at = coalesce(deleted_at, now()),
        deleted_by = auth.uid(),
        updated_by = coalesce(auth.uid(), updated_by, created_by),
        sync_status = 'pending'
    WHERE recurring_meeting_occurrence_id = OLD.id AND deleted_at IS NULL;
    RETURN OLD;
  END IF;
  PERFORM public.sync_meeting_calendar_event(NEW.id);
  RETURN NEW;
END;
$$;


--
-- Name: sync_obligation_occurrence_from_task(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_obligation_occurrence_from_task() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE is_task_completed boolean;
BEGIN
  is_task_completed := NEW.completed_at IS NOT NULL OR NEW.status = 'done'::public.task_status
    OR EXISTS (SELECT 1 FROM public.task_statuses status WHERE status.id = NEW.status_id AND status.is_completed);

  UPDATE public.obligation_occurrences
  SET status = CASE WHEN is_task_completed THEN 'completed' ELSE 'open' END,
      completed_at = CASE WHEN is_task_completed THEN coalesce(completed_at, NEW.completed_at, now()) ELSE NULL END,
      completed_by = CASE WHEN is_task_completed THEN coalesce(completed_by, auth.uid()) ELSE NULL END
  WHERE task_id = NEW.id AND status <> 'skipped';
  RETURN NEW;
END;
$$;


--
-- Name: sync_recurring_meeting_from_task(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_recurring_meeting_from_task() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  target_occurrence uuid := coalesce(NEW.recurring_meeting_occurrence_id, OLD.recurring_meeting_occurrence_id);
  task_count integer;
  pending_count integer;
BEGIN
  IF target_occurrence IS NULL THEN RETURN NEW; END IF;

  SELECT count(*) FILTER (
    WHERE task.deleted_at IS NULL AND task.archived_at IS NULL
  ), count(*) FILTER (
    WHERE task.deleted_at IS NULL
      AND task.archived_at IS NULL
      AND NOT (
        task.completed_at IS NOT NULL
        OR task.status = 'done'::public.task_status
        OR EXISTS (
          SELECT 1 FROM public.task_statuses status
          WHERE status.id = task.status_id AND status.is_completed
        )
      )
  )
  INTO task_count, pending_count
  FROM public.tasks task
  WHERE task.recurring_meeting_occurrence_id = target_occurrence;

  UPDATE public.recurring_meeting_occurrences
  SET status = CASE
        WHEN task_count > 0 AND pending_count = 0 THEN 'completed'
        ELSE 'open'
      END,
      completed_at = CASE
        WHEN task_count > 0 AND pending_count = 0 THEN coalesce(completed_at, now())
        ELSE NULL
      END,
      completed_by = CASE
        WHEN task_count > 0 AND pending_count = 0 THEN coalesce(completed_by, auth.uid())
        ELSE NULL
      END
  WHERE id = target_occurrence AND status <> 'skipped';

  RETURN NEW;
END;
$$;


--
-- Name: sync_recurring_meeting_occurrence_from_task(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_recurring_meeting_occurrence_from_task() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE is_task_completed boolean;
BEGIN
  is_task_completed := NEW.completed_at IS NOT NULL OR NEW.status = 'done'::public.task_status
    OR EXISTS (SELECT 1 FROM public.task_statuses status WHERE status.id = NEW.status_id AND status.is_completed);

  UPDATE public.recurring_meeting_occurrences
  SET status = CASE WHEN is_task_completed THEN 'completed' ELSE 'open' END,
      completed_at = CASE WHEN is_task_completed THEN coalesce(completed_at, NEW.completed_at, now()) ELSE NULL END,
      completed_by = CASE WHEN is_task_completed THEN coalesce(completed_by, auth.uid()) ELSE NULL END
  WHERE task_id = NEW.id AND status <> 'skipped';
  RETURN NEW;
END;
$$;


--
-- Name: sync_single_meeting_occurrence(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_single_meeting_occurrence() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF current_setting('taskflow.calendar_event_edit', true) = 'true' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.archived_at IS DISTINCT FROM NEW.archived_at THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.is_recurring AND (
    OLD.is_recurring IS DISTINCT FROM NEW.is_recurring
    OR OLD.is_active IS DISTINCT FROM NEW.is_active
    OR OLD.start_date IS DISTINCT FROM NEW.start_date
  ) THEN
    DELETE FROM public.recurring_meeting_occurrences occurrence
    WHERE occurrence.recurring_meeting_id = NEW.id
      AND occurrence.task_id IS NULL
      AND occurrence.status = 'scheduled'
      AND occurrence.agenda_prepared_at IS NULL
      AND occurrence.rescheduled_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.calendar_events event
        WHERE event.recurring_meeting_occurrence_id = occurrence.id
      );
  END IF;

  IF NOT NEW.is_recurring AND NEW.is_active THEN
    IF TG_OP = 'UPDATE' AND NOT OLD.is_recurring THEN
      UPDATE public.recurring_meeting_occurrences
      SET due_date = NEW.start_date, due_time = NEW.due_time
      WHERE recurring_meeting_id = NEW.id AND task_id IS NULL
        AND status = 'scheduled'
        AND (due_date IS DISTINCT FROM NEW.start_date
             OR due_time IS DISTINCT FROM NEW.due_time);
    END IF;
    INSERT INTO public.recurring_meeting_occurrences (
      workspace_id, recurring_meeting_id, due_date, due_time
    ) VALUES (
      NEW.workspace_id, NEW.id, NEW.start_date, NEW.due_time
    )
    ON CONFLICT (recurring_meeting_id, due_date)
    DO UPDATE SET due_time = EXCLUDED.due_time
    WHERE public.recurring_meeting_occurrences.task_id IS NULL
      AND public.recurring_meeting_occurrences.status = 'scheduled';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: sync_subtask_completed_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_subtask_completed_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.done AND (TG_OP = 'INSERT' OR OLD.done IS DISTINCT FROM NEW.done) THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  ELSIF NOT NEW.done THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END; $$;


--
-- Name: sync_task_interruptions_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_task_interruptions_count() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE tid uuid;
BEGIN
  tid := COALESCE(NEW.task_id, OLD.task_id);
  UPDATE public.tasks SET interruptions = (SELECT count(*) FROM public.task_interruptions WHERE task_id = tid) WHERE id = tid;
  RETURN NULL;
END; $$;


--
-- Name: touch_service_request(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_service_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' THEN NEW.resolved_at = now(); END IF;
  IF NEW.status <> 'resolved' THEN NEW.resolved_at = NULL; END IF;
  RETURN NEW;
END;
$$;


--
-- Name: track_task_assignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.track_task_assignment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.assignee_id IS NOT DISTINCT FROM NEW.assignee_id THEN
    RETURN NEW;
  END IF;

  IF NEW.assignee_id IS NULL THEN
    NEW.assigned_by := NULL;
    NEW.assigned_at := NULL;
  ELSIF actor IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM actor THEN
    NEW.assigned_by := actor;
    NEW.assigned_at := now();
  ELSE
    NEW.assigned_by := NULL;
    NEW.assigned_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: update_meeting_calendar_event(uuid, text, text, timestamp with time zone, timestamp with time zone, text, text[], text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_meeting_calendar_event(target_event_id uuid, new_title text, new_description text, new_starts_at timestamp with time zone, new_ends_at timestamp with time zone, new_location text, new_attendee_emails text[], new_google_calendar_id text, new_meeting_url text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  event_record public.calendar_events%ROWTYPE;
  occurrence_record public.recurring_meeting_occurrences%ROWTYPE;
  meeting_record public.recurring_meetings%ROWTYPE;
  local_date date;
  local_time time;
  duration integer;
  previous_edit_flag text;
BEGIN
  SELECT * INTO event_record FROM public.calendar_events
  WHERE id = target_event_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR event_record.recurring_meeting_occurrence_id IS NULL THEN
    RAISE EXCEPTION 'Compromisso da reunião não encontrado';
  END IF;
  SELECT * INTO occurrence_record FROM public.recurring_meeting_occurrences
  WHERE id = event_record.recurring_meeting_occurrence_id FOR UPDATE;
  SELECT * INTO meeting_record FROM public.recurring_meetings
  WHERE id = occurrence_record.recurring_meeting_id;
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'client'::public.app_role)
     OR NOT public.has_workspace_access(meeting_record.workspace_id) THEN
    RAISE EXCEPTION 'Você não pode editar este compromisso';
  END IF;
  IF length(trim(coalesce(new_title, ''))) = 0
     OR new_starts_at IS NULL OR new_ends_at IS NULL
     OR new_ends_at <= new_starts_at THEN
    RAISE EXCEPTION 'Título ou horário do compromisso inválido';
  END IF;
  duration := round(extract(epoch FROM new_ends_at - new_starts_at) / 60)::integer;
  IF duration < 15 OR duration > 1440 THEN
    RAISE EXCEPTION 'A duração deve estar entre 15 e 1440 minutos';
  END IF;
  local_date := (new_starts_at AT TIME ZONE 'America/Sao_Paulo')::date;
  local_time := (new_starts_at AT TIME ZONE 'America/Sao_Paulo')::time;

  IF NOT meeting_record.is_recurring THEN
    previous_edit_flag := current_setting('taskflow.calendar_event_edit', true);
    PERFORM set_config('taskflow.calendar_event_edit', 'true', true);
    UPDATE public.recurring_meetings
    SET start_date = local_date, end_date = local_date, due_time = local_time,
        duration_minutes = duration
    WHERE id = meeting_record.id;
    PERFORM set_config('taskflow.calendar_event_edit', coalesce(previous_edit_flag, ''), true);
  END IF;

  UPDATE public.recurring_meeting_occurrences
  SET due_date = local_date,
      due_time = local_time,
      rescheduled_at = CASE WHEN meeting_record.is_recurring THEN now() ELSE rescheduled_at END,
      calendar_title_override = CASE WHEN new_title IS DISTINCT FROM event_record.title
                                     THEN trim(new_title) ELSE calendar_title_override END,
      calendar_description_override = CASE
        WHEN new_description IS DISTINCT FROM event_record.description
        THEN coalesce(new_description, '') ELSE calendar_description_override END,
      calendar_location_override = CASE
        WHEN new_location IS DISTINCT FROM event_record.location
        THEN coalesce(new_location, '') ELSE calendar_location_override END,
      calendar_attendee_emails_override = CASE
        WHEN new_attendee_emails IS DISTINCT FROM event_record.attendee_emails
        THEN coalesce(new_attendee_emails, ARRAY[]::text[]) ELSE calendar_attendee_emails_override END,
      calendar_duration_minutes_override = CASE
        WHEN duration IS DISTINCT FROM round(extract(epoch FROM
             event_record.ends_at - event_record.starts_at) / 60)::integer
        THEN duration ELSE calendar_duration_minutes_override END,
      calendar_google_calendar_id_override = CASE
        WHEN new_google_calendar_id IS DISTINCT FROM event_record.google_calendar_id
        THEN new_google_calendar_id ELSE calendar_google_calendar_id_override END,
      calendar_meeting_url_override = CASE
        WHEN NOT meeting_record.create_google_meet
             AND new_meeting_url IS DISTINCT FROM event_record.meeting_url
        THEN coalesce(new_meeting_url, '') ELSE calendar_meeting_url_override END
  WHERE id = occurrence_record.id;

  UPDATE public.calendar_events
  SET title = trim(new_title),
      description = nullif(trim(coalesce(new_description, '')), ''),
      starts_at = new_starts_at,
      ends_at = new_ends_at,
      location = nullif(trim(coalesce(new_location, '')), ''),
      attendee_emails = coalesce(new_attendee_emails, ARRAY[]::text[]),
      google_calendar_id = new_google_calendar_id,
      meeting_url = CASE WHEN meeting_record.create_google_meet
                         THEN event_record.meeting_url ELSE nullif(trim(coalesce(new_meeting_url, '')), '') END,
      updated_by = auth.uid(),
      sync_status = 'pending'
  WHERE id = target_event_id;
  RETURN true;
END;
$$;


--
-- Name: validate_recurring_meeting_department(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_recurring_meeting_department() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.recurring_meeting_departments department
    WHERE department.id = NEW.department_id
      AND department.workspace_id = NEW.workspace_id
      AND department.is_active
  ) THEN
    RAISE EXCEPTION 'O departamento não pertence ao ambiente atual ou está inativo';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: validate_recurring_meeting_department_member(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_recurring_meeting_department_member() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.recurring_meeting_departments department
    JOIN public.workspace_memberships membership
      ON membership.workspace_id = department.workspace_id
     AND membership.user_id = NEW.user_id
    WHERE department.id = NEW.department_id
      AND public.has_workspace_access(department.workspace_id)
  ) THEN
    RAISE EXCEPTION 'O membro precisa pertencer ao ambiente do departamento';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: validate_recurring_meeting_participant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_recurring_meeting_participant() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.recurring_meetings meeting
    JOIN public.workspace_memberships membership
      ON membership.workspace_id = meeting.workspace_id
     AND membership.user_id = NEW.user_id
    WHERE meeting.id = NEW.recurring_meeting_id
      AND public.has_workspace_access(meeting.workspace_id)
  ) THEN
    RAISE EXCEPTION 'O participante precisa pertencer ao ambiente da reunião';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: access_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_invitations (
    email text NOT NULL,
    invited_by uuid,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    mime_type text,
    size_bytes bigint,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.attachments REPLICA IDENTITY FULL;


--
-- Name: board_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    field_order jsonb DEFAULT '["tags", "description", "assignee", "priority", "status", "due", "subtasks", "comments", "attachments", "interruptions"]'::jsonb NOT NULL,
    hidden_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    interruption_color text DEFAULT '#ef4444'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    kanban_orientation text DEFAULT 'vertical'::text NOT NULL,
    workspace_id uuid
);


--
-- Name: calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    is_all_day boolean DEFAULT false NOT NULL,
    location text,
    meeting_url text,
    color text DEFAULT '#2563eb'::text NOT NULL,
    created_by uuid NOT NULL,
    updated_by uuid,
    source text DEFAULT 'taskflow'::text NOT NULL,
    google_event_id text,
    google_calendar_id text,
    google_etag text,
    google_updated_at timestamp with time zone,
    sync_status text DEFAULT 'not_configured'::text NOT NULL,
    sync_error text,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid,
    create_google_meet boolean DEFAULT false NOT NULL,
    auto_smart_notes boolean DEFAULT true NOT NULL,
    auto_transcription boolean DEFAULT false NOT NULL,
    attendee_emails text[] DEFAULT '{}'::text[] NOT NULL,
    recurring_meeting_occurrence_id uuid,
    google_synced_calendar_id text,
    hidden_at timestamp with time zone,
    CONSTRAINT calendar_events_color_check CHECK ((color ~ '^#[0-9A-Fa-f]{6}$'::text)),
    CONSTRAINT calendar_events_source_check CHECK ((source = ANY (ARRAY['taskflow'::text, 'google'::text]))),
    CONSTRAINT calendar_events_sync_status_check CHECK ((sync_status = ANY (ARRAY['not_configured'::text, 'pending'::text, 'synced'::text, 'error'::text]))),
    CONSTRAINT calendar_events_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 240))),
    CONSTRAINT calendar_events_valid_interval CHECK ((ends_at > starts_at))
);


--
-- Name: COLUMN calendar_events.create_google_meet; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.calendar_events.create_google_meet IS 'When true, the next Google Calendar sync creates an official Google Meet for the event.';


--
-- Name: COLUMN calendar_events.auto_smart_notes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.calendar_events.auto_smart_notes IS 'Whether a Google Meet created by TaskFlow should automatically generate Gemini Smart Notes.';


--
-- Name: COLUMN calendar_events.auto_transcription; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.calendar_events.auto_transcription IS 'Whether a Google Meet created by TaskFlow should automatically generate a transcript.';


--
-- Name: COLUMN calendar_events.attendee_emails; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.calendar_events.attendee_emails IS 'Guest email addresses invited to the Google Calendar event.';


--
-- Name: calendar_google_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_google_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    google_email text NOT NULL,
    refresh_token text NOT NULL,
    access_token text,
    access_token_expires_at timestamp with time zone,
    granted_scopes text NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: calendar_google_oauth_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_google_oauth_states (
    state uuid NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    return_origin text
);


--
-- Name: calendar_source_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_source_preferences (
    user_id uuid NOT NULL,
    google_calendar_id text NOT NULL,
    is_visible boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: calendar_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_sources (
    google_calendar_id text NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#2563eb'::text NOT NULL,
    is_shared boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_sources_color_check CHECK ((color ~ '^#[0-9A-Fa-f]{6}$'::text))
);


--
-- Name: client_branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    name text NOT NULL,
    cnpj text,
    address text,
    phone text,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text
);


--
-- Name: client_department_employee_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_department_employee_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    mime_type text,
    size_bytes bigint,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    title text
);


--
-- Name: client_department_employee_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_department_employee_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    content text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT client_department_employee_notes_content_check CHECK ((char_length(TRIM(BOTH FROM content)) > 0))
);


--
-- Name: client_department_employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_department_employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id uuid NOT NULL,
    full_name text NOT NULL,
    cbo text,
    role text,
    salary numeric(12,2),
    activities text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    avatar_path text,
    salary_extrafolha numeric(12,2),
    person_type text DEFAULT 'individual'::text NOT NULL,
    document text,
    CONSTRAINT client_department_employees_person_type_check CHECK ((person_type = ANY (ARRAY['individual'::text, 'company'::text])))
);


--
-- Name: client_departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_departments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);


--
-- Name: client_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    mime_type text,
    size_bytes bigint,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    title text,
    "position" integer DEFAULT 0 NOT NULL,
    source_attachment_id uuid
);


--
-- Name: client_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    description text NOT NULL,
    amount numeric(12,2) NOT NULL,
    due_date date NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    paid_at timestamp with time zone,
    payment_method text DEFAULT 'pix'::text NOT NULL,
    payment_link text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pix_key text,
    boleto_file_name text,
    boleto_storage_path text,
    boleto_mime_type text,
    invoice_file_name text,
    invoice_storage_path text,
    invoice_mime_type text,
    CONSTRAINT client_invoices_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT client_invoices_payment_method_check CHECK ((payment_method = ANY (ARRAY['pix'::text, 'boleto'::text, 'link'::text]))),
    CONSTRAINT client_invoices_status_check CHECK ((status = ANY (ARRAY['open'::text, 'paid'::text])))
);


--
-- Name: client_note_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_note_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    note_id uuid NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    mime_type text,
    size_bytes bigint,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: client_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    done boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    note_date date DEFAULT (now())::date NOT NULL,
    task_id uuid,
    content_html text,
    recurring_meeting_id uuid,
    recurring_meeting_occurrence_id uuid,
    meet_transcript_id uuid
);


--
-- Name: client_reference_topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_reference_topics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT client_reference_topics_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 120)))
);


--
-- Name: client_references; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_references (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    topic_id uuid NOT NULL,
    title text NOT NULL,
    url text,
    notes text DEFAULT ''::text NOT NULL,
    storage_path text,
    file_name text,
    mime_type text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT client_references_check CHECK (((url IS NOT NULL) OR (storage_path IS NOT NULL) OR (char_length(btrim(notes)) > 0))),
    CONSTRAINT client_references_check1 CHECK (((storage_path IS NULL) OR (split_part(storage_path, '/'::text, 1) = (client_id)::text))),
    CONSTRAINT client_references_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 160))),
    CONSTRAINT client_references_url_check CHECK (((url IS NULL) OR (url ~ '^https?://'::text)))
);


--
-- Name: client_social_account_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_social_account_stats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    snapshot_date date NOT NULL,
    followers_count integer,
    reach integer,
    impressions integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: client_social_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_social_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    platform text DEFAULT 'instagram'::text NOT NULL,
    ig_business_id text NOT NULL,
    page_id text NOT NULL,
    page_name text,
    access_token text NOT NULL,
    token_expires_at timestamp with time zone,
    connected_by uuid,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sync_at timestamp with time zone,
    last_sync_error text
);


--
-- Name: client_social_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_social_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    platform_post_id text NOT NULL,
    permalink text,
    caption text,
    media_type text,
    thumbnail_url text,
    posted_at timestamp with time zone,
    reach integer,
    likes integer,
    comments integer,
    saved integer,
    shares integer,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: client_system_accesses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_system_accesses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    title text NOT NULL,
    login text NOT NULL,
    password text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: client_user_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_user_links (
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: comment_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comment_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    comment_id uuid NOT NULL,
    task_id uuid NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    mime_type text,
    size_bytes bigint,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: comment_mentions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comment_mentions (
    comment_id uuid NOT NULL,
    mentioned_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    title text,
    "position" integer DEFAULT 0 NOT NULL,
    reply_to_id uuid,
    edited_at timestamp with time zone
);

ALTER TABLE ONLY public.comments REPLICA IDENTITY FULL;


--
-- Name: crm_opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    title text NOT NULL,
    company_name text,
    contact_name text,
    contact_email text,
    contact_phone text,
    stage text DEFAULT 'novo'::text NOT NULL,
    source text,
    amount numeric(14,2),
    expected_close_date date,
    notes text,
    created_by uuid DEFAULT auth.uid(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_id uuid,
    CONSTRAINT crm_opportunities_amount_check CHECK (((amount IS NULL) OR (amount >= (0)::numeric))),
    CONSTRAINT crm_opportunities_company_name_check CHECK (((company_name IS NULL) OR ((char_length(btrim(company_name)) >= 1) AND (char_length(btrim(company_name)) <= 180)))),
    CONSTRAINT crm_opportunities_stage_check CHECK ((stage = ANY (ARRAY['atendendo'::text, 'novo'::text, 'qualificado'::text, 'proposta'::text, 'negociacao'::text, 'finalizado'::text]))),
    CONSTRAINT crm_opportunities_title_check CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 180)))
);


--
-- Name: crm_pipeline_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_pipeline_stages (
    workspace_id uuid NOT NULL,
    stage_id text NOT NULL,
    label text NOT NULL,
    color text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_pipeline_stages_color_check CHECK ((color ~ '^#[0-9A-Fa-f]{6}$'::text)),
    CONSTRAINT crm_pipeline_stages_label_check CHECK (((char_length(btrim(label)) >= 1) AND (char_length(btrim(label)) <= 60))),
    CONSTRAINT crm_pipeline_stages_stage_id_check CHECK ((stage_id = ANY (ARRAY['atendendo'::text, 'novo'::text, 'qualificado'::text, 'proposta'::text, 'negociacao'::text, 'finalizado'::text])))
);


--
-- Name: instagram_oauth_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instagram_oauth_states (
    state uuid NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: meeting_ata_imports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_ata_imports (
    id uuid NOT NULL,
    recurring_meeting_id uuid NOT NULL,
    occurrence_id uuid NOT NULL,
    client_note_id uuid,
    task_count integer DEFAULT 0 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: meeting_minutes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_minutes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    calendar_event_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    conference_record_name text,
    smart_note_name text,
    google_doc_url text,
    generated_at timestamp with time zone,
    last_checked_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    file_path text,
    file_name text,
    file_size integer,
    file_error text,
    CONSTRAINT meeting_minutes_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'unavailable'::text, 'error'::text])))
);


--
-- Name: meeting_transcripts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_transcripts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    calendar_event_id uuid NOT NULL,
    conference_record_name text NOT NULL,
    transcript_name text NOT NULL,
    google_doc_url text,
    entries jsonb DEFAULT '[]'::jsonb NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    entry_count integer DEFAULT 0 NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    file_path text,
    file_name text,
    file_size integer,
    file_error text,
    CONSTRAINT meeting_transcripts_entry_count_check CHECK ((entry_count >= 0))
);


--
-- Name: mural_post_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mural_post_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    mime_type text,
    size_bytes bigint,
    uploaded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.mural_post_attachments REPLICA IDENTITY FULL;


--
-- Name: mural_post_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mural_post_orders (
    user_id uuid NOT NULL,
    post_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);


--
-- Name: mural_post_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mural_post_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mural_post_reactions_emoji_check CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 16)))
);

ALTER TABLE ONLY public.mural_post_reactions REPLICA IDENTITY FULL;


--
-- Name: mural_post_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mural_post_reads (
    user_id uuid NOT NULL,
    post_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mural_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mural_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    content text,
    color text DEFAULT 'sky'::text NOT NULL,
    tag text,
    image_url text,
    checklist jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    is_pinned boolean DEFAULT false NOT NULL,
    card_size text DEFAULT 'normal'::text NOT NULL,
    text_style text DEFAULT 'clean'::text NOT NULL,
    canvas_x integer DEFAULT 520 NOT NULL,
    canvas_y integer DEFAULT 180 NOT NULL,
    is_featured boolean DEFAULT false NOT NULL,
    expires_at date,
    workspace_id uuid,
    CONSTRAINT mural_posts_canvas_x_check CHECK ((canvas_x >= 0)),
    CONSTRAINT mural_posts_canvas_y_check CHECK ((canvas_y >= 0)),
    CONSTRAINT mural_posts_card_size_check CHECK ((card_size = ANY (ARRAY['compact'::text, 'normal'::text, 'large'::text]))),
    CONSTRAINT mural_posts_color_check CHECK ((color = ANY (ARRAY['sky'::text, 'amber'::text, 'violet'::text, 'green'::text, 'rose'::text, 'red'::text, 'stone'::text]))),
    CONSTRAINT mural_posts_text_style_check CHECK ((text_style = ANY (ARRAY['clean'::text, 'handwritten'::text, 'pen'::text, 'marker'::text, 'casual'::text, 'scribble'::text, 'architect'::text, 'editorial'::text, 'typewriter'::text]))),
    CONSTRAINT mural_posts_title_check CHECK ((char_length(title) <= 180))
);

ALTER TABLE ONLY public.mural_posts REPLICA IDENTITY FULL;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    task_id uuid,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    recurring_meeting_occurrence_id uuid
);

ALTER TABLE ONLY public.notifications REPLICA IDENTITY FULL;


--
-- Name: obligation_occurrences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.obligation_occurrences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    obligation_id uuid NOT NULL,
    due_date date NOT NULL,
    due_time time without time zone,
    status text DEFAULT 'scheduled'::text NOT NULL,
    task_id uuid,
    completed_at timestamp with time zone,
    completed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT obligation_occurrences_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'open'::text, 'completed'::text, 'skipped'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text,
    email text,
    avatar_url text,
    color text DEFAULT '#752832'::text,
    theme_preferences jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    active_workspace_id uuid
);


--
-- Name: recurring_meeting_agenda_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurring_meeting_agenda_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    occurrence_id uuid NOT NULL,
    template_id uuid,
    title text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    result text,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recurring_meeting_agenda_items_result_check CHECK ((result = ANY (ARRAY['done'::text, 'task'::text]))),
    CONSTRAINT recurring_meeting_agenda_items_title_check CHECK ((char_length(TRIM(BOTH FROM title)) > 0))
);


--
-- Name: recurring_meeting_department_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurring_meeting_department_members (
    department_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: recurring_meeting_departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurring_meeting_departments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    color text DEFAULT '#64748b'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recurring_meeting_departments_name_check CHECK ((char_length(TRIM(BOTH FROM name)) > 0))
);


--
-- Name: recurring_meeting_occurrences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurring_meeting_occurrences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    recurring_meeting_id uuid NOT NULL,
    due_date date NOT NULL,
    due_time time without time zone,
    status text DEFAULT 'scheduled'::text NOT NULL,
    task_id uuid,
    completed_at timestamp with time zone,
    completed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    agenda_prepared_at timestamp with time zone,
    reminded_at timestamp with time zone,
    rescheduled_at timestamp with time zone,
    calendar_event_disabled boolean DEFAULT false NOT NULL,
    calendar_title_override text,
    calendar_description_override text,
    calendar_location_override text,
    calendar_attendee_emails_override text[],
    calendar_duration_minutes_override integer,
    calendar_google_calendar_id_override text,
    calendar_meeting_url_override text,
    CONSTRAINT recurring_meeting_occurrence_calendar_duration_minutes_ov_check CHECK (((calendar_duration_minutes_override >= 15) AND (calendar_duration_minutes_override <= 1440))),
    CONSTRAINT recurring_meeting_occurrences_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'open'::text, 'completed'::text, 'skipped'::text])))
);


--
-- Name: recurring_meeting_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurring_meeting_participants (
    recurring_meeting_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_request_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_request_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    actor_id uuid,
    kind text NOT NULL,
    details text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_request_activity_kind_check CHECK ((kind = ANY (ARRAY['created'::text, 'status_changed'::text, 'priority_changed'::text, 'participant_added'::text, 'assignee_added'::text, 'attachment_added'::text])))
);


--
-- Name: service_request_assignees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_request_assignees (
    request_id uuid NOT NULL,
    user_id uuid NOT NULL,
    assigned_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_request_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_request_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    mime_type text,
    size_bytes bigint,
    uploaded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_request_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_request_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    body text NOT NULL,
    author_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_request_messages_body_check CHECK ((char_length(TRIM(BOTH FROM body)) > 0))
);


--
-- Name: service_request_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_request_participants (
    request_id uuid NOT NULL,
    user_id uuid NOT NULL,
    added_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    status text DEFAULT 'new'::text NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    client_id uuid,
    due_date date,
    created_by uuid NOT NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid,
    CONSTRAINT service_requests_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT service_requests_status_check CHECK ((status = ANY (ARRAY['new'::text, 'in_progress'::text, 'resolved'::text]))),
    CONSTRAINT service_requests_title_check CHECK ((char_length(TRIM(BOTH FROM title)) > 0))
);


--
-- Name: subtask_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subtask_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subtask_id uuid NOT NULL,
    task_id uuid NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    mime_type text,
    size_bytes bigint,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subtask_due_date_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subtask_due_date_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subtask_id uuid NOT NULL,
    old_due_date timestamp with time zone,
    new_due_date timestamp with time zone,
    reason text,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subtasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subtasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    title text NOT NULL,
    done boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    comment_id uuid,
    due_date timestamp with time zone,
    completed_at timestamp with time zone,
    assignee_id uuid,
    notes text
);

ALTER TABLE ONLY public.subtasks REPLICA IDENTITY FULL;


--
-- Name: task_card_opens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_card_opens (
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    first_opened_at timestamp with time zone NOT NULL,
    last_opened_at timestamp with time zone NOT NULL,
    CONSTRAINT task_card_opens_check CHECK ((first_opened_at <= last_opened_at))
);


--
-- Name: task_collaborators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_collaborators (
    task_id uuid NOT NULL,
    collaborator_id uuid NOT NULL,
    added_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: task_conversation_followers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_conversation_followers (
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_conversation_followers_user_id_check CHECK ((user_id = '76c2c067-e336-4d94-ab99-1247f7b6a0de'::uuid))
);


--
-- Name: task_conversation_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_conversation_reads (
    user_id uuid NOT NULL,
    task_id uuid NOT NULL,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL,
    manual_unread boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN task_conversation_reads.manual_unread; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.task_conversation_reads.manual_unread IS 'Indicates a conversation the user explicitly marked as unread.';


--
-- Name: task_due_date_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_due_date_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid,
    old_due_date timestamp with time zone,
    new_due_date timestamp with time zone,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: task_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid,
    action text NOT NULL,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: task_interruptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_interruptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: task_objectives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_objectives (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#6366f1'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: task_personal_pins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_personal_pins (
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    changed_at timestamp with time zone NOT NULL
);


--
-- Name: task_tag_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_tag_links (
    task_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_column_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_column_order (
    user_id uuid NOT NULL,
    column_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid
);


--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_permissions (
    user_id uuid NOT NULL,
    permissions text[] DEFAULT ARRAY['dashboard'::text, 'tasks'::text, 'notes'::text] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role DEFAULT 'collaborator'::public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_task_order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_task_order (
    user_id uuid NOT NULL,
    task_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    workspace_id uuid
);


--
-- Name: workspace_access_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_access_settings (
    workspace_id uuid NOT NULL,
    allow_all_admins boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: workspace_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_memberships (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role DEFAULT 'collaborator'::public.app_role NOT NULL,
    permissions text[] DEFAULT ARRAY[]::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    access_grant text DEFAULT 'manual'::text NOT NULL,
    can_view_all_tasks boolean DEFAULT false NOT NULL,
    CONSTRAINT workspace_memberships_access_grant_check CHECK ((access_grant = ANY (ARRAY['manual'::text, 'admin_policy'::text])))
);


--
-- Name: COLUMN workspace_memberships.can_view_all_tasks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workspace_memberships.can_view_all_tasks IS 'Permite navegar pelas tarefas da equipe no Marketing. Não altera categoria, participação ou permissões de conversas.';


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspaces_slug_check CHECK ((slug = ANY (ARRAY['consultoria'::text, 'marketing'::text])))
);


--
-- Name: access_invitations access_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_invitations
    ADD CONSTRAINT access_invitations_pkey PRIMARY KEY (email);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);


--
-- Name: board_preferences board_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_preferences
    ADD CONSTRAINT board_preferences_pkey PRIMARY KEY (id);


--
-- Name: calendar_events calendar_events_google_calendar_event_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_google_calendar_event_key UNIQUE (google_calendar_id, google_event_id);


--
-- Name: calendar_events calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);


--
-- Name: calendar_google_connections calendar_google_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_google_connections
    ADD CONSTRAINT calendar_google_connections_pkey PRIMARY KEY (id);


--
-- Name: calendar_google_connections calendar_google_connections_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_google_connections
    ADD CONSTRAINT calendar_google_connections_user_id_key UNIQUE (user_id);


--
-- Name: calendar_google_oauth_states calendar_google_oauth_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_google_oauth_states
    ADD CONSTRAINT calendar_google_oauth_states_pkey PRIMARY KEY (state);


--
-- Name: calendar_source_preferences calendar_source_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_source_preferences
    ADD CONSTRAINT calendar_source_preferences_pkey PRIMARY KEY (user_id, google_calendar_id);


--
-- Name: calendar_sources calendar_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_sources
    ADD CONSTRAINT calendar_sources_pkey PRIMARY KEY (google_calendar_id);


--
-- Name: client_branches client_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_branches
    ADD CONSTRAINT client_branches_pkey PRIMARY KEY (id);


--
-- Name: client_department_employee_attachments client_department_employee_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_department_employee_attachments
    ADD CONSTRAINT client_department_employee_attachments_pkey PRIMARY KEY (id);


--
-- Name: client_department_employee_notes client_department_employee_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_department_employee_notes
    ADD CONSTRAINT client_department_employee_notes_pkey PRIMARY KEY (id);


--
-- Name: client_department_employees client_department_employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_department_employees
    ADD CONSTRAINT client_department_employees_pkey PRIMARY KEY (id);


--
-- Name: client_departments client_departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_departments
    ADD CONSTRAINT client_departments_pkey PRIMARY KEY (id);


--
-- Name: client_files client_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_files
    ADD CONSTRAINT client_files_pkey PRIMARY KEY (id);


--
-- Name: client_important_dates client_important_dates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_important_dates
    ADD CONSTRAINT client_important_dates_pkey PRIMARY KEY (id);


--
-- Name: client_invoices client_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_invoices
    ADD CONSTRAINT client_invoices_pkey PRIMARY KEY (id);


--
-- Name: client_note_attachments client_note_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_note_attachments
    ADD CONSTRAINT client_note_attachments_pkey PRIMARY KEY (id);


--
-- Name: client_notes client_notes_meet_transcript_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_meet_transcript_id_key UNIQUE (meet_transcript_id);


--
-- Name: client_notes client_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_pkey PRIMARY KEY (id);


--
-- Name: client_reference_topics client_reference_topics_id_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_reference_topics
    ADD CONSTRAINT client_reference_topics_id_client_id_key UNIQUE (id, client_id);


--
-- Name: client_reference_topics client_reference_topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_reference_topics
    ADD CONSTRAINT client_reference_topics_pkey PRIMARY KEY (id);


--
-- Name: client_references client_references_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_references
    ADD CONSTRAINT client_references_pkey PRIMARY KEY (id);


--
-- Name: client_social_account_stats client_social_account_stats_account_id_snapshot_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_account_stats
    ADD CONSTRAINT client_social_account_stats_account_id_snapshot_date_key UNIQUE (account_id, snapshot_date);


--
-- Name: client_social_account_stats client_social_account_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_account_stats
    ADD CONSTRAINT client_social_account_stats_pkey PRIMARY KEY (id);


--
-- Name: client_social_accounts client_social_accounts_client_id_platform_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_accounts
    ADD CONSTRAINT client_social_accounts_client_id_platform_key UNIQUE (client_id, platform);


--
-- Name: client_social_accounts client_social_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_accounts
    ADD CONSTRAINT client_social_accounts_pkey PRIMARY KEY (id);


--
-- Name: client_social_posts client_social_posts_account_id_platform_post_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_posts
    ADD CONSTRAINT client_social_posts_account_id_platform_post_id_key UNIQUE (account_id, platform_post_id);


--
-- Name: client_social_posts client_social_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_posts
    ADD CONSTRAINT client_social_posts_pkey PRIMARY KEY (id);


--
-- Name: client_system_accesses client_system_accesses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_system_accesses
    ADD CONSTRAINT client_system_accesses_pkey PRIMARY KEY (id);


--
-- Name: client_user_links client_user_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_user_links
    ADD CONSTRAINT client_user_links_pkey PRIMARY KEY (user_id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: comment_attachments comment_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_attachments
    ADD CONSTRAINT comment_attachments_pkey PRIMARY KEY (id);


--
-- Name: comment_attachments comment_attachments_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_attachments
    ADD CONSTRAINT comment_attachments_storage_path_key UNIQUE (storage_path);


--
-- Name: comment_mentions comment_mentions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_mentions
    ADD CONSTRAINT comment_mentions_pkey PRIMARY KEY (comment_id, mentioned_user_id);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: crm_opportunities crm_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_pkey PRIMARY KEY (id);


--
-- Name: crm_pipeline_stages crm_pipeline_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_pipeline_stages
    ADD CONSTRAINT crm_pipeline_stages_pkey PRIMARY KEY (workspace_id, stage_id);


--
-- Name: instagram_oauth_states instagram_oauth_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instagram_oauth_states
    ADD CONSTRAINT instagram_oauth_states_pkey PRIMARY KEY (state);


--
-- Name: kanban_columns kanban_columns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_columns
    ADD CONSTRAINT kanban_columns_pkey PRIMARY KEY (id);


--
-- Name: meeting_ata_imports meeting_ata_imports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_ata_imports
    ADD CONSTRAINT meeting_ata_imports_pkey PRIMARY KEY (id);


--
-- Name: meeting_minutes meeting_minutes_calendar_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_minutes
    ADD CONSTRAINT meeting_minutes_calendar_event_id_key UNIQUE (calendar_event_id);


--
-- Name: meeting_minutes meeting_minutes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_minutes
    ADD CONSTRAINT meeting_minutes_pkey PRIMARY KEY (id);


--
-- Name: meeting_transcripts meeting_transcripts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_transcripts
    ADD CONSTRAINT meeting_transcripts_pkey PRIMARY KEY (id);


--
-- Name: meeting_transcripts meeting_transcripts_transcript_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_transcripts
    ADD CONSTRAINT meeting_transcripts_transcript_name_key UNIQUE (transcript_name);


--
-- Name: mural_post_attachments mural_post_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_post_attachments
    ADD CONSTRAINT mural_post_attachments_pkey PRIMARY KEY (id);


--
-- Name: mural_post_attachments mural_post_attachments_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_post_attachments
    ADD CONSTRAINT mural_post_attachments_storage_path_key UNIQUE (storage_path);


--
-- Name: mural_post_orders mural_post_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_post_orders
    ADD CONSTRAINT mural_post_orders_pkey PRIMARY KEY (user_id, post_id);


--
-- Name: mural_post_reactions mural_post_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_post_reactions
    ADD CONSTRAINT mural_post_reactions_pkey PRIMARY KEY (id);


--
-- Name: mural_post_reactions mural_post_reactions_post_id_user_id_emoji_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_post_reactions
    ADD CONSTRAINT mural_post_reactions_post_id_user_id_emoji_key UNIQUE (post_id, user_id, emoji);


--
-- Name: mural_post_reads mural_post_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_post_reads
    ADD CONSTRAINT mural_post_reads_pkey PRIMARY KEY (user_id, post_id);


--
-- Name: mural_posts mural_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_posts
    ADD CONSTRAINT mural_posts_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: obligation_occurrences obligation_occurrences_obligation_id_due_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligation_occurrences
    ADD CONSTRAINT obligation_occurrences_obligation_id_due_date_key UNIQUE (obligation_id, due_date);


--
-- Name: obligation_occurrences obligation_occurrences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligation_occurrences
    ADD CONSTRAINT obligation_occurrences_pkey PRIMARY KEY (id);


--
-- Name: obligation_occurrences obligation_occurrences_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligation_occurrences
    ADD CONSTRAINT obligation_occurrences_task_id_key UNIQUE (task_id);


--
-- Name: obligations obligations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligations
    ADD CONSTRAINT obligations_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: recurring_meeting_agenda_items recurring_meeting_agenda_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_agenda_items
    ADD CONSTRAINT recurring_meeting_agenda_items_pkey PRIMARY KEY (id);


--
-- Name: recurring_meeting_agenda_templates recurring_meeting_agenda_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_agenda_templates
    ADD CONSTRAINT recurring_meeting_agenda_templates_pkey PRIMARY KEY (id);


--
-- Name: recurring_meeting_department_members recurring_meeting_department_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_department_members
    ADD CONSTRAINT recurring_meeting_department_members_pkey PRIMARY KEY (department_id, user_id);


--
-- Name: recurring_meeting_departments recurring_meeting_departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_departments
    ADD CONSTRAINT recurring_meeting_departments_pkey PRIMARY KEY (id);


--
-- Name: recurring_meeting_occurrences recurring_meeting_occurrences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_occurrences
    ADD CONSTRAINT recurring_meeting_occurrences_pkey PRIMARY KEY (id);


--
-- Name: recurring_meeting_occurrences recurring_meeting_occurrences_recurring_meeting_id_due_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_occurrences
    ADD CONSTRAINT recurring_meeting_occurrences_recurring_meeting_id_due_date_key UNIQUE (recurring_meeting_id, due_date);


--
-- Name: recurring_meeting_occurrences recurring_meeting_occurrences_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_occurrences
    ADD CONSTRAINT recurring_meeting_occurrences_task_id_key UNIQUE (task_id);


--
-- Name: recurring_meeting_participants recurring_meeting_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_participants
    ADD CONSTRAINT recurring_meeting_participants_pkey PRIMARY KEY (recurring_meeting_id, user_id);


--
-- Name: recurring_meetings recurring_meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meetings
    ADD CONSTRAINT recurring_meetings_pkey PRIMARY KEY (id);


--
-- Name: service_request_activity service_request_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_activity
    ADD CONSTRAINT service_request_activity_pkey PRIMARY KEY (id);


--
-- Name: service_request_assignees service_request_assignees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_assignees
    ADD CONSTRAINT service_request_assignees_pkey PRIMARY KEY (request_id, user_id);


--
-- Name: service_request_attachments service_request_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_attachments
    ADD CONSTRAINT service_request_attachments_pkey PRIMARY KEY (id);


--
-- Name: service_request_attachments service_request_attachments_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_attachments
    ADD CONSTRAINT service_request_attachments_storage_path_key UNIQUE (storage_path);


--
-- Name: service_request_messages service_request_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_messages
    ADD CONSTRAINT service_request_messages_pkey PRIMARY KEY (id);


--
-- Name: service_request_participants service_request_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_participants
    ADD CONSTRAINT service_request_participants_pkey PRIMARY KEY (request_id, user_id);


--
-- Name: service_requests service_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_requests
    ADD CONSTRAINT service_requests_pkey PRIMARY KEY (id);


--
-- Name: subtask_attachments subtask_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtask_attachments
    ADD CONSTRAINT subtask_attachments_pkey PRIMARY KEY (id);


--
-- Name: subtask_due_date_changes subtask_due_date_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtask_due_date_changes
    ADD CONSTRAINT subtask_due_date_changes_pkey PRIMARY KEY (id);


--
-- Name: subtasks subtasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtasks
    ADD CONSTRAINT subtasks_pkey PRIMARY KEY (id);


--
-- Name: task_card_opens task_card_opens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_card_opens
    ADD CONSTRAINT task_card_opens_pkey PRIMARY KEY (task_id, user_id);


--
-- Name: task_collaborators task_collaborators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_collaborators
    ADD CONSTRAINT task_collaborators_pkey PRIMARY KEY (task_id, collaborator_id);


--
-- Name: task_conversation_followers task_conversation_followers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_conversation_followers
    ADD CONSTRAINT task_conversation_followers_pkey PRIMARY KEY (task_id, user_id);


--
-- Name: task_conversation_reads task_conversation_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_conversation_reads
    ADD CONSTRAINT task_conversation_reads_pkey PRIMARY KEY (user_id, task_id);


--
-- Name: task_due_date_changes task_due_date_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_due_date_changes
    ADD CONSTRAINT task_due_date_changes_pkey PRIMARY KEY (id);


--
-- Name: task_history task_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_history
    ADD CONSTRAINT task_history_pkey PRIMARY KEY (id);


--
-- Name: task_interruptions task_interruptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_interruptions
    ADD CONSTRAINT task_interruptions_pkey PRIMARY KEY (id);


--
-- Name: task_objectives task_objectives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_objectives
    ADD CONSTRAINT task_objectives_pkey PRIMARY KEY (id);


--
-- Name: task_objectives task_objectives_workspace_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_objectives
    ADD CONSTRAINT task_objectives_workspace_id_name_key UNIQUE (workspace_id, name);


--
-- Name: task_personal_pins task_personal_pins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_personal_pins
    ADD CONSTRAINT task_personal_pins_pkey PRIMARY KEY (task_id, user_id);


--
-- Name: task_statuses task_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_statuses
    ADD CONSTRAINT task_statuses_pkey PRIMARY KEY (id);


--
-- Name: task_tag_links task_tag_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tag_links
    ADD CONSTRAINT task_tag_links_pkey PRIMARY KEY (task_id, tag_id);


--
-- Name: task_tags task_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tags
    ADD CONSTRAINT task_tags_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: user_column_order user_column_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_column_order
    ADD CONSTRAINT user_column_order_pkey PRIMARY KEY (user_id, column_id);


--
-- Name: user_permissions user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (user_id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: user_task_order user_task_order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_task_order
    ADD CONSTRAINT user_task_order_pkey PRIMARY KEY (user_id, task_id);


--
-- Name: workspace_access_settings workspace_access_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_access_settings
    ADD CONSTRAINT workspace_access_settings_pkey PRIMARY KEY (workspace_id);


--
-- Name: workspace_memberships workspace_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_pkey PRIMARY KEY (workspace_id, user_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_slug_key UNIQUE (slug);


--
-- Name: attachments_task_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attachments_task_created_idx ON public.attachments USING btree (task_id, created_at);


--
-- Name: board_preferences_user_workspace_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX board_preferences_user_workspace_key ON public.board_preferences USING btree (user_id, workspace_id);


--
-- Name: calendar_events_active_interval_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_active_interval_idx ON public.calendar_events USING btree (starts_at, ends_at) WHERE (deleted_at IS NULL);


--
-- Name: calendar_events_google_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_google_lookup_idx ON public.calendar_events USING btree (google_calendar_id, google_event_id) WHERE (google_event_id IS NOT NULL);


--
-- Name: calendar_events_meeting_occurrence_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX calendar_events_meeting_occurrence_key ON public.calendar_events USING btree (recurring_meeting_occurrence_id) WHERE (recurring_meeting_occurrence_id IS NOT NULL);


--
-- Name: calendar_events_visible_interval_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_events_visible_interval_idx ON public.calendar_events USING btree (starts_at, ends_at) WHERE ((deleted_at IS NULL) AND (hidden_at IS NULL));


--
-- Name: calendar_google_oauth_states_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_google_oauth_states_expiry_idx ON public.calendar_google_oauth_states USING btree (expires_at);


--
-- Name: client_branches_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_branches_client_id_idx ON public.client_branches USING btree (client_id);


--
-- Name: client_department_employee_attachments_employee_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_department_employee_attachments_employee_id_idx ON public.client_department_employee_attachments USING btree (employee_id);


--
-- Name: client_department_employee_notes_employee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_department_employee_notes_employee_idx ON public.client_department_employee_notes USING btree (employee_id, created_at DESC);


--
-- Name: client_department_employees_department_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_department_employees_department_id_idx ON public.client_department_employees USING btree (department_id);


--
-- Name: client_files_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_files_client_id_idx ON public.client_files USING btree (client_id);


--
-- Name: client_files_client_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_files_client_position_idx ON public.client_files USING btree (client_id, "position");


--
-- Name: client_files_source_attachment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX client_files_source_attachment_id_idx ON public.client_files USING btree (source_attachment_id) WHERE (source_attachment_id IS NOT NULL);


--
-- Name: client_important_dates_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_important_dates_client_idx ON public.client_important_dates USING btree (client_id);


--
-- Name: client_invoices_client_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_invoices_client_due_idx ON public.client_invoices USING btree (client_id, due_date);


--
-- Name: client_note_att_note_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_note_att_note_idx ON public.client_note_attachments USING btree (note_id);


--
-- Name: client_notes_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_notes_client_idx ON public.client_notes USING btree (client_id);


--
-- Name: client_notes_meeting_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_notes_meeting_idx ON public.client_notes USING btree (recurring_meeting_id) WHERE (recurring_meeting_id IS NOT NULL);


--
-- Name: client_reference_topics_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_reference_topics_client_idx ON public.client_reference_topics USING btree (client_id);


--
-- Name: client_references_topic_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_references_topic_idx ON public.client_references USING btree (topic_id, client_id);


--
-- Name: client_social_account_stats_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_social_account_stats_account_idx ON public.client_social_account_stats USING btree (account_id, snapshot_date DESC);


--
-- Name: client_social_accounts_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_social_accounts_client_idx ON public.client_social_accounts USING btree (client_id);


--
-- Name: client_social_posts_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_social_posts_account_idx ON public.client_social_posts USING btree (account_id, posted_at DESC);


--
-- Name: client_system_accesses_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_system_accesses_client_id_idx ON public.client_system_accesses USING btree (client_id);


--
-- Name: client_user_links_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_user_links_client_idx ON public.client_user_links USING btree (client_id);


--
-- Name: clients_active_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_active_name_idx ON public.clients USING btree (is_active, name);


--
-- Name: clients_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_workspace_idx ON public.clients USING btree (workspace_id);


--
-- Name: clients_workspace_source_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX clients_workspace_source_client_idx ON public.clients USING btree (workspace_id, source_client_id) WHERE (source_client_id IS NOT NULL);


--
-- Name: comment_mentions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comment_mentions_user_idx ON public.comment_mentions USING btree (mentioned_user_id, created_at DESC);


--
-- Name: comments_reply_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comments_reply_to_idx ON public.comments USING btree (reply_to_id);


--
-- Name: comments_task_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comments_task_position_idx ON public.comments USING btree (task_id, "position");


--
-- Name: crm_opportunities_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_opportunities_client_id_idx ON public.crm_opportunities USING btree (client_id) WHERE (client_id IS NOT NULL);


--
-- Name: crm_opportunities_workspace_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_opportunities_workspace_stage_idx ON public.crm_opportunities USING btree (workspace_id, stage, updated_at DESC);


--
-- Name: idx_client_notes_note_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_notes_note_date ON public.client_notes USING btree (note_date);


--
-- Name: idx_client_notes_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_notes_task_id ON public.client_notes USING btree (task_id);


--
-- Name: idx_comment_attachments_comment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comment_attachments_comment ON public.comment_attachments USING btree (comment_id);


--
-- Name: idx_comment_attachments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comment_attachments_task ON public.comment_attachments USING btree (task_id);


--
-- Name: idx_subtask_due_date_changes_subtask; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subtask_due_date_changes_subtask ON public.subtask_due_date_changes USING btree (subtask_id, created_at DESC);


--
-- Name: idx_subtasks_comment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subtasks_comment ON public.subtasks USING btree (comment_id);


--
-- Name: idx_task_due_changes_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_due_changes_task ON public.task_due_date_changes USING btree (task_id, created_at DESC);


--
-- Name: instagram_oauth_states_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX instagram_oauth_states_expiry_idx ON public.instagram_oauth_states USING btree (expires_at);


--
-- Name: kanban_columns_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kanban_columns_workspace_idx ON public.kanban_columns USING btree (workspace_id);


--
-- Name: meeting_minutes_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meeting_minutes_pending_idx ON public.meeting_minutes USING btree (status, last_checked_at) WHERE (status = 'pending'::text);


--
-- Name: meeting_transcripts_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meeting_transcripts_event_idx ON public.meeting_transcripts USING btree (calendar_event_id);


--
-- Name: mural_post_attachments_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mural_post_attachments_post_idx ON public.mural_post_attachments USING btree (post_id);


--
-- Name: mural_post_orders_user_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mural_post_orders_user_position_idx ON public.mural_post_orders USING btree (user_id, "position");


--
-- Name: mural_post_reactions_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mural_post_reactions_post_idx ON public.mural_post_reactions USING btree (post_id, created_at);


--
-- Name: mural_post_reads_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mural_post_reads_user_idx ON public.mural_post_reads USING btree (user_id, read_at DESC);


--
-- Name: mural_posts_canvas_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mural_posts_canvas_position_idx ON public.mural_posts USING btree (canvas_y, canvas_x);


--
-- Name: mural_posts_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mural_posts_created_at_idx ON public.mural_posts USING btree (created_at DESC);


--
-- Name: mural_posts_featured_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mural_posts_featured_idx ON public.mural_posts USING btree (is_featured DESC, is_pinned DESC, created_at DESC);


--
-- Name: mural_posts_pinned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mural_posts_pinned_idx ON public.mural_posts USING btree (is_pinned DESC, created_at DESC);


--
-- Name: mural_posts_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mural_posts_workspace_idx ON public.mural_posts USING btree (workspace_id);


--
-- Name: notifications_recurring_meeting_recipient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notifications_recurring_meeting_recipient_idx ON public.notifications USING btree (user_id, recurring_meeting_occurrence_id, type) WHERE (recurring_meeting_occurrence_id IS NOT NULL);


--
-- Name: notifications_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_created_idx ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: obligation_occurrences_obligation_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX obligation_occurrences_obligation_due_idx ON public.obligation_occurrences USING btree (obligation_id, due_date);


--
-- Name: obligation_occurrences_workspace_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX obligation_occurrences_workspace_due_idx ON public.obligation_occurrences USING btree (workspace_id, due_date);


--
-- Name: obligations_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX obligations_client_idx ON public.obligations USING btree (client_id);


--
-- Name: obligations_workspace_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX obligations_workspace_active_idx ON public.obligations USING btree (workspace_id, is_active);


--
-- Name: recurring_meeting_agenda_items_occurrence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_meeting_agenda_items_occurrence_idx ON public.recurring_meeting_agenda_items USING btree (occurrence_id, "position");


--
-- Name: recurring_meeting_agenda_items_template_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX recurring_meeting_agenda_items_template_idx ON public.recurring_meeting_agenda_items USING btree (occurrence_id, template_id) WHERE (template_id IS NOT NULL);


--
-- Name: recurring_meeting_agenda_templates_recurring_meeting_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_meeting_agenda_templates_recurring_meeting_idx ON public.recurring_meeting_agenda_templates USING btree (recurring_meeting_id, "position");


--
-- Name: recurring_meeting_departments_workspace_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX recurring_meeting_departments_workspace_name_idx ON public.recurring_meeting_departments USING btree (workspace_id, lower(TRIM(BOTH FROM name)));


--
-- Name: recurring_meeting_departments_workspace_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_meeting_departments_workspace_position_idx ON public.recurring_meeting_departments USING btree (workspace_id, "position", name);


--
-- Name: recurring_meeting_occurrences_recurring_meeting_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_meeting_occurrences_recurring_meeting_due_idx ON public.recurring_meeting_occurrences USING btree (recurring_meeting_id, due_date);


--
-- Name: recurring_meeting_occurrences_workspace_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_meeting_occurrences_workspace_due_idx ON public.recurring_meeting_occurrences USING btree (workspace_id, due_date);


--
-- Name: recurring_meetings_archived_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_meetings_archived_at_idx ON public.recurring_meetings USING btree (workspace_id, archived_at);


--
-- Name: recurring_meetings_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_meetings_client_idx ON public.recurring_meetings USING btree (client_id);


--
-- Name: recurring_meetings_department_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_meetings_department_idx ON public.recurring_meetings USING btree (department_id, is_active);


--
-- Name: recurring_meetings_workspace_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recurring_meetings_workspace_active_idx ON public.recurring_meetings USING btree (workspace_id, is_active);


--
-- Name: service_request_activity_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_request_activity_request_idx ON public.service_request_activity USING btree (request_id, created_at);


--
-- Name: service_request_messages_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_request_messages_request_idx ON public.service_request_messages USING btree (request_id, created_at);


--
-- Name: service_requests_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_requests_updated_at_idx ON public.service_requests USING btree (updated_at DESC);


--
-- Name: subtasks_task_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subtasks_task_position_idx ON public.subtasks USING btree (task_id, "position");


--
-- Name: task_collaborators_collaborator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_collaborators_collaborator_idx ON public.task_collaborators USING btree (collaborator_id);


--
-- Name: task_conversation_followers_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_conversation_followers_user_idx ON public.task_conversation_followers USING btree (user_id, task_id);


--
-- Name: task_conversation_reads_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_conversation_reads_task_idx ON public.task_conversation_reads USING btree (task_id);


--
-- Name: task_interruptions_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_interruptions_task_id_idx ON public.task_interruptions USING btree (task_id);


--
-- Name: task_personal_pins_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_personal_pins_user_idx ON public.task_personal_pins USING btree (user_id) WHERE is_pinned;


--
-- Name: task_tag_links_tag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_tag_links_tag_idx ON public.task_tag_links USING btree (tag_id);


--
-- Name: task_tag_links_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX task_tag_links_task_idx ON public.task_tag_links USING btree (task_id);


--
-- Name: tasks_assignee_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_assignee_idx ON public.tasks USING btree (assignee_id);


--
-- Name: tasks_client_archived_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_client_archived_idx ON public.tasks USING btree (client_id, archived_at DESC) WHERE ((archived_at IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: tasks_column_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_column_idx ON public.tasks USING btree (column_id);


--
-- Name: tasks_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_deleted_at_idx ON public.tasks USING btree (deleted_at);


--
-- Name: tasks_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_due_idx ON public.tasks USING btree (due_date);


--
-- Name: tasks_objective_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_objective_id_idx ON public.tasks USING btree (objective_id);


--
-- Name: tasks_origin_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_origin_workspace_idx ON public.tasks USING btree (origin_workspace_id) WHERE (origin_workspace_id IS DISTINCT FROM workspace_id);


--
-- Name: tasks_position_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_position_created_idx ON public.tasks USING btree ("position", created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: tasks_recurring_meeting_agenda_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_recurring_meeting_agenda_item_idx ON public.tasks USING btree (recurring_meeting_agenda_item_id) WHERE (recurring_meeting_agenda_item_id IS NOT NULL);


--
-- Name: tasks_recurring_meeting_occurrence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_recurring_meeting_occurrence_idx ON public.tasks USING btree (recurring_meeting_occurrence_id) WHERE (recurring_meeting_occurrence_id IS NOT NULL);


--
-- Name: tasks_recurring_meeting_template_occurrence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tasks_recurring_meeting_template_occurrence_idx ON public.tasks USING btree (recurring_meeting_occurrence_id, recurring_meeting_agenda_template_id) WHERE ((recurring_meeting_occurrence_id IS NOT NULL) AND (recurring_meeting_agenda_template_id IS NOT NULL));


--
-- Name: tasks_status_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_status_id_idx ON public.tasks USING btree (status_id);


--
-- Name: tasks_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_workspace_idx ON public.tasks USING btree (workspace_id);


--
-- Name: user_task_order_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_task_order_user_idx ON public.user_task_order USING btree (user_id);


--
-- Name: board_preferences board_preferences_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER board_preferences_updated_at BEFORE UPDATE ON public.board_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: client_notes client_notes_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER client_notes_set_updated_at BEFORE UPDATE ON public.client_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: crm_opportunities crm_opportunities_client_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunities_client_workspace BEFORE INSERT OR UPDATE OF client_id, workspace_id ON public.crm_opportunities FOR EACH ROW EXECUTE FUNCTION public.crm_validate_client_workspace();


--
-- Name: crm_opportunities crm_opportunities_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_opportunities_updated_at BEFORE UPDATE ON public.crm_opportunities FOR EACH ROW EXECUTE FUNCTION public.crm_opportunities_touch_updated_at();


--
-- Name: crm_pipeline_stages crm_pipeline_stages_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_pipeline_stages_updated_at BEFORE UPDATE ON public.crm_pipeline_stages FOR EACH ROW EXECUTE FUNCTION public.crm_opportunities_touch_updated_at();


--
-- Name: kanban_columns kanban_columns_set_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER kanban_columns_set_owner BEFORE INSERT ON public.kanban_columns FOR EACH ROW EXECUTE FUNCTION public.set_created_by_owner();


--
-- Name: workspace_memberships magalhaes_consultoria_only_membership; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER magalhaes_consultoria_only_membership BEFORE INSERT OR UPDATE ON public.workspace_memberships FOR EACH ROW EXECUTE FUNCTION public.magalhaes_consultoria_only_membership();


--
-- Name: task_interruptions task_interruptions_count_aiud; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER task_interruptions_count_aiud AFTER INSERT OR DELETE OR UPDATE ON public.task_interruptions FOR EACH ROW EXECUTE FUNCTION public.sync_task_interruptions_count();


--
-- Name: task_interruptions task_interruptions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER task_interruptions_updated_at BEFORE UPDATE ON public.task_interruptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: task_statuses task_statuses_set_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER task_statuses_set_owner BEFORE INSERT ON public.task_statuses FOR EACH ROW EXECUTE FUNCTION public.set_created_by_owner();


--
-- Name: task_tags task_tags_set_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER task_tags_set_owner BEFORE INSERT ON public.task_tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by_owner();


--
-- Name: comment_mentions trg_add_mentioned_as_collaborator; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_add_mentioned_as_collaborator AFTER INSERT ON public.comment_mentions FOR EACH ROW EXECUTE FUNCTION public.add_mentioned_as_collaborator();


--
-- Name: clients trg_archive_inactive_client_operations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_archive_inactive_client_operations AFTER UPDATE OF is_active ON public.clients FOR EACH ROW EXECUTE FUNCTION public.archive_inactive_client_operations();


--
-- Name: board_preferences trg_assign_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_workspace BEFORE INSERT OR UPDATE OF workspace_id ON public.board_preferences FOR EACH ROW EXECUTE FUNCTION public.assign_current_workspace();


--
-- Name: clients trg_assign_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_workspace BEFORE INSERT OR UPDATE OF workspace_id ON public.clients FOR EACH ROW EXECUTE FUNCTION public.assign_current_workspace();


--
-- Name: kanban_columns trg_assign_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_workspace BEFORE INSERT OR UPDATE OF workspace_id ON public.kanban_columns FOR EACH ROW EXECUTE FUNCTION public.assign_current_workspace();


--
-- Name: mural_posts trg_assign_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_workspace BEFORE INSERT OR UPDATE OF workspace_id ON public.mural_posts FOR EACH ROW EXECUTE FUNCTION public.assign_current_workspace();


--
-- Name: service_requests trg_assign_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_workspace BEFORE INSERT OR UPDATE OF workspace_id ON public.service_requests FOR EACH ROW EXECUTE FUNCTION public.assign_current_workspace();


--
-- Name: task_statuses trg_assign_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_workspace BEFORE INSERT OR UPDATE OF workspace_id ON public.task_statuses FOR EACH ROW EXECUTE FUNCTION public.assign_current_workspace();


--
-- Name: task_tags trg_assign_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_workspace BEFORE INSERT OR UPDATE OF workspace_id ON public.task_tags FOR EACH ROW EXECUTE FUNCTION public.assign_current_workspace();


--
-- Name: tasks trg_assign_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_workspace BEFORE INSERT OR UPDATE OF workspace_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.assign_task_workspace();


--
-- Name: user_column_order trg_assign_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_workspace BEFORE INSERT OR UPDATE OF workspace_id ON public.user_column_order FOR EACH ROW EXECUTE FUNCTION public.assign_current_workspace();


--
-- Name: user_task_order trg_assign_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assign_workspace BEFORE INSERT OR UPDATE OF workspace_id ON public.user_task_order FOR EACH ROW EXECUTE FUNCTION public.assign_current_workspace();


--
-- Name: calendar_events trg_calendar_events_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_calendar_events_updated_at BEFORE UPDATE ON public.calendar_events FOR EACH ROW EXECUTE FUNCTION public.set_calendar_event_updated_at();


--
-- Name: calendar_google_connections trg_calendar_google_connections_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_calendar_google_connections_updated_at BEFORE UPDATE ON public.calendar_google_connections FOR EACH ROW EXECUTE FUNCTION public.set_calendar_google_connection_updated_at();


--
-- Name: calendar_source_preferences trg_calendar_source_preferences_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_calendar_source_preferences_updated_at BEFORE UPDATE ON public.calendar_source_preferences FOR EACH ROW EXECUTE FUNCTION public.set_calendar_source_updated_at();


--
-- Name: calendar_sources trg_calendar_sources_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_calendar_sources_updated_at BEFORE UPDATE ON public.calendar_sources FOR EACH ROW EXECUTE FUNCTION public.set_calendar_source_updated_at();


--
-- Name: client_branches trg_client_branches_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_client_branches_updated_at BEFORE UPDATE ON public.client_branches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: client_department_employee_notes trg_client_department_employee_notes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_client_department_employee_notes_updated_at BEFORE UPDATE ON public.client_department_employee_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: client_files trg_client_files_uploaded_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_client_files_uploaded_by BEFORE INSERT ON public.client_files FOR EACH ROW EXECUTE FUNCTION public.set_client_file_uploaded_by();


--
-- Name: client_invoices trg_client_invoices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_client_invoices_updated_at BEFORE UPDATE ON public.client_invoices FOR EACH ROW EXECUTE FUNCTION public.set_client_invoices_updated_at();


--
-- Name: client_notes trg_client_notes_created_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_client_notes_created_by BEFORE INSERT ON public.client_notes FOR EACH ROW EXECUTE FUNCTION public.set_client_note_created_by();


--
-- Name: client_system_accesses trg_client_system_accesses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_client_system_accesses_updated_at BEFORE UPDATE ON public.client_system_accesses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: client_user_links trg_client_user_links_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_client_user_links_updated_at BEFORE UPDATE ON public.client_user_links FOR EACH ROW EXECUTE FUNCTION public.set_client_user_links_updated_at();


--
-- Name: clients trg_clients_u; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clients_u BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: kanban_columns trg_cols_u; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cols_u BEFORE UPDATE ON public.kanban_columns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: recurring_meeting_agenda_items trg_complete_meeting_agenda_tasks; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_complete_meeting_agenda_tasks AFTER UPDATE OF result ON public.recurring_meeting_agenda_items FOR EACH ROW EXECUTE FUNCTION public.complete_meeting_agenda_tasks();


--
-- Name: tasks trg_delete_completed_task_conversation_attachments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_delete_completed_task_conversation_attachments AFTER UPDATE OF status, completed_at ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.delete_completed_task_conversation_attachments();


--
-- Name: comments trg_guard_comment_edit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_comment_edit BEFORE UPDATE ON public.comments FOR EACH ROW EXECUTE FUNCTION public.guard_comment_edit();


--
-- Name: tasks trg_guard_cross_workspace_task_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_cross_workspace_task_update BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.guard_cross_workspace_task_update();


--
-- Name: tasks trg_mark_recurring_meeting_agenda_item_with_task; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mark_recurring_meeting_agenda_item_with_task AFTER INSERT OR UPDATE OF recurring_meeting_agenda_item_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.mark_recurring_meeting_agenda_item_with_task();


--
-- Name: subtasks trg_marketing_subtask_deadline_conversation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_marketing_subtask_deadline_conversation BEFORE UPDATE OF due_date ON public.subtasks FOR EACH ROW WHEN ((old.due_date IS DISTINCT FROM new.due_date)) EXECUTE FUNCTION public.record_marketing_deadline_conversation();


--
-- Name: tasks trg_marketing_task_deadline_conversation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_marketing_task_deadline_conversation BEFORE UPDATE OF due_date ON public.tasks FOR EACH ROW WHEN ((old.due_date IS DISTINCT FROM new.due_date)) EXECUTE FUNCTION public.record_marketing_deadline_conversation();


--
-- Name: meeting_minutes trg_meeting_minutes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_meeting_minutes_updated_at BEFORE UPDATE ON public.meeting_minutes FOR EACH ROW EXECUTE FUNCTION public.set_meeting_minutes_updated_at();


--
-- Name: mural_posts trg_mural_posts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mural_posts_updated_at BEFORE UPDATE ON public.mural_posts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: comment_mentions trg_notify_comment_mention; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_comment_mention AFTER INSERT ON public.comment_mentions FOR EACH ROW EXECUTE FUNCTION public.notify_comment_mention();


--
-- Name: mural_posts trg_notify_mural_post_created; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_mural_post_created AFTER INSERT ON public.mural_posts FOR EACH ROW EXECUTE FUNCTION public.notify_mural_post_activity();


--
-- Name: mural_posts trg_notify_mural_post_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_mural_post_updated AFTER UPDATE OF title, content ON public.mural_posts FOR EACH ROW WHEN ((old.* IS DISTINCT FROM new.*)) EXECUTE FUNCTION public.notify_mural_post_activity();


--
-- Name: service_request_assignees trg_notify_service_request_assignee; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_service_request_assignee AFTER INSERT ON public.service_request_assignees FOR EACH ROW EXECUTE FUNCTION public.notify_service_request_member();


--
-- Name: service_request_participants trg_notify_service_request_participant; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_service_request_participant AFTER INSERT ON public.service_request_participants FOR EACH ROW EXECUTE FUNCTION public.notify_service_request_member();


--
-- Name: subtasks trg_notify_subtask_assignment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_subtask_assignment AFTER INSERT OR UPDATE OF assignee_id ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.notify_subtask_assignment();


--
-- Name: subtasks trg_notify_subtask_completion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_subtask_completion AFTER UPDATE OF done ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.notify_subtask_completion();


--
-- Name: tasks trg_notify_task_assignment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_task_assignment AFTER INSERT OR UPDATE OF assignee_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.notify_task_assignment();


--
-- Name: attachments trg_notify_task_attachment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_task_attachment AFTER INSERT ON public.attachments FOR EACH ROW EXECUTE FUNCTION public.notify_task_attachment();


--
-- Name: task_collaborators trg_notify_task_collaborator_added; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_task_collaborator_added AFTER INSERT ON public.task_collaborators FOR EACH ROW EXECUTE FUNCTION public.notify_task_collaborator_added();


--
-- Name: comments trg_notify_task_comment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_task_comment AFTER INSERT ON public.comments FOR EACH ROW EXECUTE FUNCTION public.notify_task_comment();


--
-- Name: tasks trg_notify_task_completion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_task_completion AFTER UPDATE OF status, completed_at ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.notify_task_completion();


--
-- Name: obligation_occurrences trg_obligation_occurrences_assign_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_obligation_occurrences_assign_workspace BEFORE INSERT OR UPDATE OF workspace_id ON public.obligation_occurrences FOR EACH ROW EXECUTE FUNCTION public.assign_current_workspace();


--
-- Name: obligation_occurrences trg_obligation_occurrences_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_obligation_occurrences_updated_at BEFORE UPDATE ON public.obligation_occurrences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: obligations trg_obligations_assign_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_obligations_assign_workspace BEFORE INSERT OR UPDATE OF workspace_id ON public.obligations FOR EACH ROW EXECUTE FUNCTION public.assign_current_workspace();


--
-- Name: obligations trg_obligations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_obligations_updated_at BEFORE UPDATE ON public.obligations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: obligations trg_prepare_obligation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prepare_obligation BEFORE INSERT OR UPDATE ON public.obligations FOR EACH ROW EXECUTE FUNCTION public.prepare_obligation();


--
-- Name: recurring_meetings trg_prepare_recurring_meeting; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prepare_recurring_meeting BEFORE INSERT OR UPDATE ON public.recurring_meetings FOR EACH ROW EXECUTE FUNCTION public.prepare_recurring_meeting();


--
-- Name: recurring_meeting_agenda_items trg_prepare_recurring_meeting_agenda_item; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prepare_recurring_meeting_agenda_item BEFORE INSERT OR UPDATE ON public.recurring_meeting_agenda_items FOR EACH ROW EXECUTE FUNCTION public.prepare_recurring_meeting_agenda_item();


--
-- Name: recurring_meeting_agenda_templates trg_prepare_recurring_meeting_agenda_template; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prepare_recurring_meeting_agenda_template BEFORE INSERT OR UPDATE ON public.recurring_meeting_agenda_templates FOR EACH ROW EXECUTE FUNCTION public.prepare_recurring_meeting_agenda_template();


--
-- Name: recurring_meeting_departments trg_prepare_recurring_meeting_department; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prepare_recurring_meeting_department BEFORE INSERT OR UPDATE ON public.recurring_meeting_departments FOR EACH ROW EXECUTE FUNCTION public.prepare_recurring_meeting_department();


--
-- Name: subtasks trg_prevent_assignee_subtask_deletion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_assignee_subtask_deletion BEFORE DELETE ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.prevent_assignee_subtask_deletion();


--
-- Name: tasks trg_prevent_assignee_task_cancellation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_assignee_task_cancellation BEFORE UPDATE OF deleted_at ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.prevent_assignee_task_cancellation();


--
-- Name: obligations trg_prevent_inactive_client_obligation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_inactive_client_obligation BEFORE INSERT OR UPDATE OF client_id, is_active ON public.obligations FOR EACH ROW EXECUTE FUNCTION public.prevent_inactive_client_obligation();


--
-- Name: service_requests trg_prevent_inactive_client_service_request; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_inactive_client_service_request BEFORE INSERT OR UPDATE OF client_id ON public.service_requests FOR EACH ROW EXECUTE FUNCTION public.prevent_inactive_client_service_request();


--
-- Name: profiles trg_profiles_active_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_active_workspace BEFORE UPDATE OF active_workspace_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.can_change_active_workspace();


--
-- Name: profiles trg_profiles_default_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_default_workspace AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.add_profile_to_consultoria();


--
-- Name: profiles trg_profiles_u; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_u BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: recurring_meeting_agenda_items trg_recurring_meeting_agenda_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recurring_meeting_agenda_items_updated_at BEFORE UPDATE ON public.recurring_meeting_agenda_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: recurring_meeting_agenda_templates trg_recurring_meeting_agenda_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recurring_meeting_agenda_templates_updated_at BEFORE UPDATE ON public.recurring_meeting_agenda_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: recurring_meeting_departments trg_recurring_meeting_departments_assign_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recurring_meeting_departments_assign_workspace BEFORE INSERT OR UPDATE OF workspace_id ON public.recurring_meeting_departments FOR EACH ROW EXECUTE FUNCTION public.assign_current_workspace();


--
-- Name: recurring_meeting_departments trg_recurring_meeting_departments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recurring_meeting_departments_updated_at BEFORE UPDATE ON public.recurring_meeting_departments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: recurring_meeting_occurrences trg_recurring_meeting_occurrences_assign_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recurring_meeting_occurrences_assign_workspace BEFORE INSERT OR UPDATE OF workspace_id ON public.recurring_meeting_occurrences FOR EACH ROW EXECUTE FUNCTION public.assign_current_workspace();


--
-- Name: recurring_meeting_occurrences trg_recurring_meeting_occurrences_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recurring_meeting_occurrences_updated_at BEFORE UPDATE ON public.recurring_meeting_occurrences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: recurring_meetings trg_recurring_meetings_assign_workspace; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recurring_meetings_assign_workspace BEFORE INSERT OR UPDATE OF workspace_id ON public.recurring_meetings FOR EACH ROW EXECUTE FUNCTION public.assign_current_workspace();


--
-- Name: recurring_meetings trg_recurring_meetings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recurring_meetings_updated_at BEFORE UPDATE ON public.recurring_meetings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: service_requests trg_service_requests_creator; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_service_requests_creator BEFORE INSERT ON public.service_requests FOR EACH ROW EXECUTE FUNCTION public.set_service_request_creator();


--
-- Name: service_requests trg_service_requests_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_service_requests_updated_at BEFORE UPDATE ON public.service_requests FOR EACH ROW EXECUTE FUNCTION public.touch_service_request();


--
-- Name: tasks trg_set_task_created_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_task_created_by BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_task_created_by();


--
-- Name: clients trg_sync_consultoria_client_to_marketing; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_consultoria_client_to_marketing AFTER INSERT OR UPDATE OF name, color, description, cnpj, legal_name, trade_name, state_registration, municipal_registration, address, phone, email, responsible, avatar_path, is_active ON public.clients FOR EACH ROW EXECUTE FUNCTION public.sync_consultoria_client_to_marketing();


--
-- Name: tasks trg_sync_meeting_agenda_from_task; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_meeting_agenda_from_task AFTER INSERT OR UPDATE OF status, status_id, completed_at, deleted_at, archived_at, recurring_meeting_agenda_item_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.sync_meeting_agenda_from_task();


--
-- Name: recurring_meeting_occurrences trg_sync_meeting_calendar_event_on_occurrence; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_meeting_calendar_event_on_occurrence AFTER INSERT OR DELETE OR UPDATE OF due_date, due_time, status ON public.recurring_meeting_occurrences FOR EACH ROW EXECUTE FUNCTION public.sync_meeting_calendar_event_on_occurrence();


--
-- Name: tasks trg_sync_obligation_occurrence_from_task; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_obligation_occurrence_from_task AFTER INSERT OR UPDATE OF status, status_id, completed_at ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.sync_obligation_occurrence_from_task();


--
-- Name: tasks trg_sync_recurring_meeting_from_task; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_recurring_meeting_from_task AFTER INSERT OR UPDATE OF status, status_id, completed_at, deleted_at, archived_at, recurring_meeting_occurrence_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.sync_recurring_meeting_from_task();


--
-- Name: tasks trg_sync_recurring_meeting_occurrence_from_task; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_recurring_meeting_occurrence_from_task AFTER INSERT OR UPDATE OF status, status_id, completed_at ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.sync_recurring_meeting_occurrence_from_task();


--
-- Name: recurring_meetings trg_sync_single_meeting_occurrence; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_single_meeting_occurrence AFTER INSERT OR UPDATE ON public.recurring_meetings FOR EACH ROW EXECUTE FUNCTION public.sync_single_meeting_occurrence();


--
-- Name: subtasks trg_sync_subtask_completed_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_subtask_completed_at BEFORE INSERT OR UPDATE OF done ON public.subtasks FOR EACH ROW EXECUTE FUNCTION public.sync_subtask_completed_at();


--
-- Name: task_tags trg_tags_u; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tags_u BEFORE UPDATE ON public.task_tags FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: task_statuses trg_task_statuses_u; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_task_statuses_u BEFORE UPDATE ON public.task_statuses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tasks trg_tasks_default_created_by; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tasks_default_created_by BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_task_created_by();


--
-- Name: tasks trg_tasks_u; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tasks_u BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tasks trg_track_task_assignment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_track_task_assignment BEFORE INSERT OR UPDATE OF assignee_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.track_task_assignment();


--
-- Name: user_permissions trg_user_permissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_permissions_updated_at BEFORE UPDATE ON public.user_permissions FOR EACH ROW EXECUTE FUNCTION public.set_user_permissions_updated_at();


--
-- Name: recurring_meetings trg_validate_recurring_meeting_department; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_recurring_meeting_department BEFORE INSERT OR UPDATE OF department_id, workspace_id ON public.recurring_meetings FOR EACH ROW EXECUTE FUNCTION public.validate_recurring_meeting_department();


--
-- Name: recurring_meeting_department_members trg_validate_recurring_meeting_department_member; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_recurring_meeting_department_member BEFORE INSERT OR UPDATE ON public.recurring_meeting_department_members FOR EACH ROW EXECUTE FUNCTION public.validate_recurring_meeting_department_member();


--
-- Name: recurring_meeting_participants trg_validate_recurring_meeting_participant; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_recurring_meeting_participant BEFORE INSERT OR UPDATE ON public.recurring_meeting_participants FOR EACH ROW EXECUTE FUNCTION public.validate_recurring_meeting_participant();


--
-- Name: recurring_meeting_agenda_items trg_z_auto_complete_meeting_from_agenda; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_z_auto_complete_meeting_from_agenda AFTER DELETE OR UPDATE OF result, occurrence_id ON public.recurring_meeting_agenda_items FOR EACH ROW EXECUTE FUNCTION public.auto_complete_meeting_from_agenda();


--
-- Name: tasks trg_z_auto_complete_meeting_from_task; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_z_auto_complete_meeting_from_task AFTER INSERT OR UPDATE OF status, status_id, completed_at, deleted_at, archived_at, recurring_meeting_agenda_item_id, recurring_meeting_occurrence_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.auto_complete_meeting_from_task();


--
-- Name: tasks trg_zz_prevent_inactive_client_task_assignment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_zz_prevent_inactive_client_task_assignment BEFORE INSERT OR UPDATE OF client_id, archived_at ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.prevent_inactive_client_task_assignment();


--
-- Name: access_invitations access_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_invitations
    ADD CONSTRAINT access_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: attachments attachments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: attachments attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: board_preferences board_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_preferences
    ADD CONSTRAINT board_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: board_preferences board_preferences_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_preferences
    ADD CONSTRAINT board_preferences_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: calendar_events calendar_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: calendar_events calendar_events_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: calendar_events calendar_events_recurring_meeting_occurrence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_recurring_meeting_occurrence_id_fkey FOREIGN KEY (recurring_meeting_occurrence_id) REFERENCES public.recurring_meeting_occurrences(id) ON DELETE SET NULL;


--
-- Name: calendar_events calendar_events_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: calendar_events calendar_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: calendar_google_connections calendar_google_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_google_connections
    ADD CONSTRAINT calendar_google_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: calendar_google_oauth_states calendar_google_oauth_states_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_google_oauth_states
    ADD CONSTRAINT calendar_google_oauth_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: calendar_source_preferences calendar_source_preferences_google_calendar_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_source_preferences
    ADD CONSTRAINT calendar_source_preferences_google_calendar_id_fkey FOREIGN KEY (google_calendar_id) REFERENCES public.calendar_sources(google_calendar_id) ON DELETE CASCADE;


--
-- Name: calendar_source_preferences calendar_source_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_source_preferences
    ADD CONSTRAINT calendar_source_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: client_branches client_branches_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_branches
    ADD CONSTRAINT client_branches_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_department_employee_attachments client_department_employee_attachments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_department_employee_attachments
    ADD CONSTRAINT client_department_employee_attachments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.client_department_employees(id) ON DELETE CASCADE;


--
-- Name: client_department_employee_attachments client_department_employee_attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_department_employee_attachments
    ADD CONSTRAINT client_department_employee_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: client_department_employee_notes client_department_employee_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_department_employee_notes
    ADD CONSTRAINT client_department_employee_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: client_department_employee_notes client_department_employee_notes_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_department_employee_notes
    ADD CONSTRAINT client_department_employee_notes_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.client_department_employees(id) ON DELETE CASCADE;


--
-- Name: client_department_employees client_department_employees_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_department_employees
    ADD CONSTRAINT client_department_employees_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.client_departments(id) ON DELETE CASCADE;


--
-- Name: client_departments client_departments_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_departments
    ADD CONSTRAINT client_departments_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_files client_files_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_files
    ADD CONSTRAINT client_files_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_files client_files_source_attachment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_files
    ADD CONSTRAINT client_files_source_attachment_id_fkey FOREIGN KEY (source_attachment_id) REFERENCES public.attachments(id) ON DELETE CASCADE;


--
-- Name: client_files client_files_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_files
    ADD CONSTRAINT client_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: client_important_dates client_important_dates_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_important_dates
    ADD CONSTRAINT client_important_dates_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_invoices client_invoices_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_invoices
    ADD CONSTRAINT client_invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_note_attachments client_note_attachments_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_note_attachments
    ADD CONSTRAINT client_note_attachments_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.client_notes(id) ON DELETE CASCADE;


--
-- Name: client_note_attachments client_note_attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_note_attachments
    ADD CONSTRAINT client_note_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);


--
-- Name: client_notes client_notes_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_notes client_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: client_notes client_notes_meet_transcript_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_meet_transcript_id_fkey FOREIGN KEY (meet_transcript_id) REFERENCES public.meeting_transcripts(id) ON DELETE SET NULL;


--
-- Name: client_notes client_notes_recurring_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_recurring_meeting_id_fkey FOREIGN KEY (recurring_meeting_id) REFERENCES public.recurring_meetings(id) ON DELETE SET NULL;


--
-- Name: client_notes client_notes_recurring_meeting_occurrence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_recurring_meeting_occurrence_id_fkey FOREIGN KEY (recurring_meeting_occurrence_id) REFERENCES public.recurring_meeting_occurrences(id) ON DELETE SET NULL;


--
-- Name: client_notes client_notes_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notes
    ADD CONSTRAINT client_notes_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: client_reference_topics client_reference_topics_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_reference_topics
    ADD CONSTRAINT client_reference_topics_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_references client_references_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_references
    ADD CONSTRAINT client_references_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_references client_references_topic_id_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_references
    ADD CONSTRAINT client_references_topic_id_client_id_fkey FOREIGN KEY (topic_id, client_id) REFERENCES public.client_reference_topics(id, client_id);


--
-- Name: client_social_account_stats client_social_account_stats_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_account_stats
    ADD CONSTRAINT client_social_account_stats_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.client_social_accounts(id) ON DELETE CASCADE;


--
-- Name: client_social_accounts client_social_accounts_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_accounts
    ADD CONSTRAINT client_social_accounts_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_social_accounts client_social_accounts_connected_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_accounts
    ADD CONSTRAINT client_social_accounts_connected_by_fkey FOREIGN KEY (connected_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: client_social_posts client_social_posts_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_posts
    ADD CONSTRAINT client_social_posts_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.client_social_accounts(id) ON DELETE CASCADE;


--
-- Name: client_system_accesses client_system_accesses_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_system_accesses
    ADD CONSTRAINT client_system_accesses_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_user_links client_user_links_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_user_links
    ADD CONSTRAINT client_user_links_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_user_links client_user_links_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_user_links
    ADD CONSTRAINT client_user_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: clients clients_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: clients clients_source_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_source_client_id_fkey FOREIGN KEY (source_client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: clients clients_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: comment_attachments comment_attachments_comment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_attachments
    ADD CONSTRAINT comment_attachments_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.comments(id) ON DELETE CASCADE;


--
-- Name: comment_attachments comment_attachments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_attachments
    ADD CONSTRAINT comment_attachments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: comment_attachments comment_attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_attachments
    ADD CONSTRAINT comment_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: comment_mentions comment_mentions_comment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_mentions
    ADD CONSTRAINT comment_mentions_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.comments(id) ON DELETE CASCADE;


--
-- Name: comment_mentions comment_mentions_mentioned_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comment_mentions
    ADD CONSTRAINT comment_mentions_mentioned_user_id_fkey FOREIGN KEY (mentioned_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: comments comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: comments comments_reply_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_reply_to_id_fkey FOREIGN KEY (reply_to_id) REFERENCES public.comments(id) ON DELETE SET NULL;


--
-- Name: comments comments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: crm_opportunities crm_opportunities_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: crm_opportunities crm_opportunities_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: crm_opportunities crm_opportunities_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_pipeline_stages crm_pipeline_stages_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_pipeline_stages
    ADD CONSTRAINT crm_pipeline_stages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: instagram_oauth_states instagram_oauth_states_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instagram_oauth_states
    ADD CONSTRAINT instagram_oauth_states_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: instagram_oauth_states instagram_oauth_states_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instagram_oauth_states
    ADD CONSTRAINT instagram_oauth_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: kanban_columns kanban_columns_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_columns
    ADD CONSTRAINT kanban_columns_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: kanban_columns kanban_columns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_columns
    ADD CONSTRAINT kanban_columns_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: kanban_columns kanban_columns_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_columns
    ADD CONSTRAINT kanban_columns_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: meeting_ata_imports meeting_ata_imports_client_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_ata_imports
    ADD CONSTRAINT meeting_ata_imports_client_note_id_fkey FOREIGN KEY (client_note_id) REFERENCES public.client_notes(id) ON DELETE SET NULL;


--
-- Name: meeting_ata_imports meeting_ata_imports_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_ata_imports
    ADD CONSTRAINT meeting_ata_imports_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: meeting_ata_imports meeting_ata_imports_occurrence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_ata_imports
    ADD CONSTRAINT meeting_ata_imports_occurrence_id_fkey FOREIGN KEY (occurrence_id) REFERENCES public.recurring_meeting_occurrences(id) ON DELETE CASCADE;


--
-- Name: meeting_ata_imports meeting_ata_imports_recurring_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_ata_imports
    ADD CONSTRAINT meeting_ata_imports_recurring_meeting_id_fkey FOREIGN KEY (recurring_meeting_id) REFERENCES public.recurring_meetings(id) ON DELETE CASCADE;


--
-- Name: meeting_minutes meeting_minutes_calendar_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_minutes
    ADD CONSTRAINT meeting_minutes_calendar_event_id_fkey FOREIGN KEY (calendar_event_id) REFERENCES public.calendar_events(id) ON DELETE CASCADE;


--
-- Name: meeting_transcripts meeting_transcripts_calendar_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_transcripts
    ADD CONSTRAINT meeting_transcripts_calendar_event_id_fkey FOREIGN KEY (calendar_event_id) REFERENCES public.calendar_events(id) ON DELETE CASCADE;


--
-- Name: mural_post_attachments mural_post_attachments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_post_attachments
    ADD CONSTRAINT mural_post_attachments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.mural_posts(id) ON DELETE CASCADE;


--
-- Name: mural_post_attachments mural_post_attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_post_attachments
    ADD CONSTRAINT mural_post_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: mural_post_orders mural_post_orders_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_post_orders
    ADD CONSTRAINT mural_post_orders_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.mural_posts(id) ON DELETE CASCADE;


--
-- Name: mural_post_orders mural_post_orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_post_orders
    ADD CONSTRAINT mural_post_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: mural_post_reactions mural_post_reactions_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_post_reactions
    ADD CONSTRAINT mural_post_reactions_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.mural_posts(id) ON DELETE CASCADE;


--
-- Name: mural_post_reactions mural_post_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_post_reactions
    ADD CONSTRAINT mural_post_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: mural_post_reads mural_post_reads_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_post_reads
    ADD CONSTRAINT mural_post_reads_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.mural_posts(id) ON DELETE CASCADE;


--
-- Name: mural_post_reads mural_post_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_post_reads
    ADD CONSTRAINT mural_post_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: mural_posts mural_posts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_posts
    ADD CONSTRAINT mural_posts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: mural_posts mural_posts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mural_posts
    ADD CONSTRAINT mural_posts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: notifications notifications_recurring_meeting_occurrence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_recurring_meeting_occurrence_id_fkey FOREIGN KEY (recurring_meeting_occurrence_id) REFERENCES public.recurring_meeting_occurrences(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: obligation_occurrences obligation_occurrences_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligation_occurrences
    ADD CONSTRAINT obligation_occurrences_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: obligation_occurrences obligation_occurrences_obligation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligation_occurrences
    ADD CONSTRAINT obligation_occurrences_obligation_id_fkey FOREIGN KEY (obligation_id) REFERENCES public.obligations(id) ON DELETE CASCADE;


--
-- Name: obligation_occurrences obligation_occurrences_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligation_occurrences
    ADD CONSTRAINT obligation_occurrences_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: obligation_occurrences obligation_occurrences_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligation_occurrences
    ADD CONSTRAINT obligation_occurrences_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: obligations obligations_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligations
    ADD CONSTRAINT obligations_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: obligations obligations_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligations
    ADD CONSTRAINT obligations_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: obligations obligations_column_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligations
    ADD CONSTRAINT obligations_column_id_fkey FOREIGN KEY (column_id) REFERENCES public.kanban_columns(id) ON DELETE SET NULL;


--
-- Name: obligations obligations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligations
    ADD CONSTRAINT obligations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: obligations obligations_status_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligations
    ADD CONSTRAINT obligations_status_id_fkey FOREIGN KEY (status_id) REFERENCES public.task_statuses(id) ON DELETE SET NULL;


--
-- Name: obligations obligations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.obligations
    ADD CONSTRAINT obligations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_active_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_active_workspace_id_fkey FOREIGN KEY (active_workspace_id) REFERENCES public.workspaces(id);


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: recurring_meeting_agenda_items recurring_meeting_agenda_items_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_agenda_items
    ADD CONSTRAINT recurring_meeting_agenda_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: recurring_meeting_agenda_items recurring_meeting_agenda_items_occurrence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_agenda_items
    ADD CONSTRAINT recurring_meeting_agenda_items_occurrence_id_fkey FOREIGN KEY (occurrence_id) REFERENCES public.recurring_meeting_occurrences(id) ON DELETE CASCADE;


--
-- Name: recurring_meeting_agenda_items recurring_meeting_agenda_items_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_agenda_items
    ADD CONSTRAINT recurring_meeting_agenda_items_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: recurring_meeting_agenda_items recurring_meeting_agenda_items_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_agenda_items
    ADD CONSTRAINT recurring_meeting_agenda_items_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.recurring_meeting_agenda_templates(id) ON DELETE SET NULL;


--
-- Name: recurring_meeting_agenda_templates recurring_meeting_agenda_templates_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_agenda_templates
    ADD CONSTRAINT recurring_meeting_agenda_templates_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: recurring_meeting_agenda_templates recurring_meeting_agenda_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_agenda_templates
    ADD CONSTRAINT recurring_meeting_agenda_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: recurring_meeting_agenda_templates recurring_meeting_agenda_templates_recurring_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_agenda_templates
    ADD CONSTRAINT recurring_meeting_agenda_templates_recurring_meeting_id_fkey FOREIGN KEY (recurring_meeting_id) REFERENCES public.recurring_meetings(id) ON DELETE CASCADE;


--
-- Name: recurring_meeting_department_members recurring_meeting_department_members_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_department_members
    ADD CONSTRAINT recurring_meeting_department_members_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.recurring_meeting_departments(id) ON DELETE CASCADE;


--
-- Name: recurring_meeting_department_members recurring_meeting_department_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_department_members
    ADD CONSTRAINT recurring_meeting_department_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: recurring_meeting_departments recurring_meeting_departments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_departments
    ADD CONSTRAINT recurring_meeting_departments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: recurring_meeting_departments recurring_meeting_departments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_departments
    ADD CONSTRAINT recurring_meeting_departments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: recurring_meeting_occurrences recurring_meeting_occurrences_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_occurrences
    ADD CONSTRAINT recurring_meeting_occurrences_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: recurring_meeting_occurrences recurring_meeting_occurrences_recurring_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_occurrences
    ADD CONSTRAINT recurring_meeting_occurrences_recurring_meeting_id_fkey FOREIGN KEY (recurring_meeting_id) REFERENCES public.recurring_meetings(id) ON DELETE CASCADE;


--
-- Name: recurring_meeting_occurrences recurring_meeting_occurrences_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_occurrences
    ADD CONSTRAINT recurring_meeting_occurrences_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: recurring_meeting_occurrences recurring_meeting_occurrences_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_occurrences
    ADD CONSTRAINT recurring_meeting_occurrences_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: recurring_meeting_participants recurring_meeting_participants_recurring_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_participants
    ADD CONSTRAINT recurring_meeting_participants_recurring_meeting_id_fkey FOREIGN KEY (recurring_meeting_id) REFERENCES public.recurring_meetings(id) ON DELETE CASCADE;


--
-- Name: recurring_meeting_participants recurring_meeting_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meeting_participants
    ADD CONSTRAINT recurring_meeting_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: recurring_meetings recurring_meetings_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meetings
    ADD CONSTRAINT recurring_meetings_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: recurring_meetings recurring_meetings_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meetings
    ADD CONSTRAINT recurring_meetings_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: recurring_meetings recurring_meetings_column_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meetings
    ADD CONSTRAINT recurring_meetings_column_id_fkey FOREIGN KEY (column_id) REFERENCES public.kanban_columns(id) ON DELETE SET NULL;


--
-- Name: recurring_meetings recurring_meetings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meetings
    ADD CONSTRAINT recurring_meetings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: recurring_meetings recurring_meetings_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meetings
    ADD CONSTRAINT recurring_meetings_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.recurring_meeting_departments(id) ON DELETE SET NULL;


--
-- Name: recurring_meetings recurring_meetings_status_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meetings
    ADD CONSTRAINT recurring_meetings_status_id_fkey FOREIGN KEY (status_id) REFERENCES public.task_statuses(id) ON DELETE SET NULL;


--
-- Name: recurring_meetings recurring_meetings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_meetings
    ADD CONSTRAINT recurring_meetings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: service_request_activity service_request_activity_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_activity
    ADD CONSTRAINT service_request_activity_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: service_request_activity service_request_activity_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_activity
    ADD CONSTRAINT service_request_activity_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.service_requests(id) ON DELETE CASCADE;


--
-- Name: service_request_assignees service_request_assignees_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_assignees
    ADD CONSTRAINT service_request_assignees_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: service_request_assignees service_request_assignees_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_assignees
    ADD CONSTRAINT service_request_assignees_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.service_requests(id) ON DELETE CASCADE;


--
-- Name: service_request_assignees service_request_assignees_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_assignees
    ADD CONSTRAINT service_request_assignees_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: service_request_attachments service_request_attachments_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_attachments
    ADD CONSTRAINT service_request_attachments_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.service_requests(id) ON DELETE CASCADE;


--
-- Name: service_request_attachments service_request_attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_attachments
    ADD CONSTRAINT service_request_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: service_request_messages service_request_messages_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_messages
    ADD CONSTRAINT service_request_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: service_request_messages service_request_messages_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_messages
    ADD CONSTRAINT service_request_messages_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.service_requests(id) ON DELETE CASCADE;


--
-- Name: service_request_participants service_request_participants_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_participants
    ADD CONSTRAINT service_request_participants_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: service_request_participants service_request_participants_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_participants
    ADD CONSTRAINT service_request_participants_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.service_requests(id) ON DELETE CASCADE;


--
-- Name: service_request_participants service_request_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_request_participants
    ADD CONSTRAINT service_request_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: service_requests service_requests_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_requests
    ADD CONSTRAINT service_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: service_requests service_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_requests
    ADD CONSTRAINT service_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: service_requests service_requests_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_requests
    ADD CONSTRAINT service_requests_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: subtask_attachments subtask_attachments_subtask_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtask_attachments
    ADD CONSTRAINT subtask_attachments_subtask_id_fkey FOREIGN KEY (subtask_id) REFERENCES public.subtasks(id) ON DELETE CASCADE;


--
-- Name: subtask_attachments subtask_attachments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtask_attachments
    ADD CONSTRAINT subtask_attachments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: subtask_attachments subtask_attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtask_attachments
    ADD CONSTRAINT subtask_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: subtask_due_date_changes subtask_due_date_changes_subtask_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtask_due_date_changes
    ADD CONSTRAINT subtask_due_date_changes_subtask_id_fkey FOREIGN KEY (subtask_id) REFERENCES public.subtasks(id) ON DELETE CASCADE;


--
-- Name: subtasks subtasks_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtasks
    ADD CONSTRAINT subtasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: subtasks subtasks_comment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtasks
    ADD CONSTRAINT subtasks_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.comments(id) ON DELETE CASCADE;


--
-- Name: subtasks subtasks_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtasks
    ADD CONSTRAINT subtasks_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_card_opens task_card_opens_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_card_opens
    ADD CONSTRAINT task_card_opens_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_card_opens task_card_opens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_card_opens
    ADD CONSTRAINT task_card_opens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: task_collaborators task_collaborators_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_collaborators
    ADD CONSTRAINT task_collaborators_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: task_collaborators task_collaborators_collaborator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_collaborators
    ADD CONSTRAINT task_collaborators_collaborator_id_fkey FOREIGN KEY (collaborator_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: task_collaborators task_collaborators_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_collaborators
    ADD CONSTRAINT task_collaborators_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_conversation_followers task_conversation_followers_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_conversation_followers
    ADD CONSTRAINT task_conversation_followers_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_conversation_followers task_conversation_followers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_conversation_followers
    ADD CONSTRAINT task_conversation_followers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: task_conversation_reads task_conversation_reads_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_conversation_reads
    ADD CONSTRAINT task_conversation_reads_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_conversation_reads task_conversation_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_conversation_reads
    ADD CONSTRAINT task_conversation_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: task_due_date_changes task_due_date_changes_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_due_date_changes
    ADD CONSTRAINT task_due_date_changes_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_due_date_changes task_due_date_changes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_due_date_changes
    ADD CONSTRAINT task_due_date_changes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: task_history task_history_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_history
    ADD CONSTRAINT task_history_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_history task_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_history
    ADD CONSTRAINT task_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: task_interruptions task_interruptions_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_interruptions
    ADD CONSTRAINT task_interruptions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_interruptions task_interruptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_interruptions
    ADD CONSTRAINT task_interruptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: task_objectives task_objectives_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_objectives
    ADD CONSTRAINT task_objectives_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: task_objectives task_objectives_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_objectives
    ADD CONSTRAINT task_objectives_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: task_personal_pins task_personal_pins_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_personal_pins
    ADD CONSTRAINT task_personal_pins_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_personal_pins task_personal_pins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_personal_pins
    ADD CONSTRAINT task_personal_pins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: task_statuses task_statuses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_statuses
    ADD CONSTRAINT task_statuses_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: task_statuses task_statuses_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_statuses
    ADD CONSTRAINT task_statuses_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: task_tag_links task_tag_links_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tag_links
    ADD CONSTRAINT task_tag_links_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.task_tags(id) ON DELETE CASCADE;


--
-- Name: task_tag_links task_tag_links_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tag_links
    ADD CONSTRAINT task_tag_links_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_tags task_tags_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tags
    ADD CONSTRAINT task_tags_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: task_tags task_tags_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tags
    ADD CONSTRAINT task_tags_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: tasks tasks_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_column_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_column_id_fkey FOREIGN KEY (column_id) REFERENCES public.kanban_columns(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_objective_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_objective_id_fkey FOREIGN KEY (objective_id) REFERENCES public.task_objectives(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_origin_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_origin_workspace_id_fkey FOREIGN KEY (origin_workspace_id) REFERENCES public.workspaces(id);


--
-- Name: tasks tasks_recurring_meeting_agenda_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_recurring_meeting_agenda_item_id_fkey FOREIGN KEY (recurring_meeting_agenda_item_id) REFERENCES public.recurring_meeting_agenda_items(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_recurring_meeting_agenda_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_recurring_meeting_agenda_template_id_fkey FOREIGN KEY (recurring_meeting_agenda_template_id) REFERENCES public.recurring_meeting_agenda_templates(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_recurring_meeting_occurrence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_recurring_meeting_occurrence_id_fkey FOREIGN KEY (recurring_meeting_occurrence_id) REFERENCES public.recurring_meeting_occurrences(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_status_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_status_id_fkey FOREIGN KEY (status_id) REFERENCES public.task_statuses(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.task_tags(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: user_column_order user_column_order_column_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_column_order
    ADD CONSTRAINT user_column_order_column_id_fkey FOREIGN KEY (column_id) REFERENCES public.kanban_columns(id) ON DELETE CASCADE;


--
-- Name: user_column_order user_column_order_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_column_order
    ADD CONSTRAINT user_column_order_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: user_permissions user_permissions_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: user_permissions user_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_task_order user_task_order_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_task_order
    ADD CONSTRAINT user_task_order_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: user_task_order user_task_order_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_task_order
    ADD CONSTRAINT user_task_order_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: workspace_access_settings workspace_access_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_access_settings
    ADD CONSTRAINT workspace_access_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: workspace_access_settings workspace_access_settings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_access_settings
    ADD CONSTRAINT workspace_access_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_memberships workspace_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: workspace_memberships workspace_memberships_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: access_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.access_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: board_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.board_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_events calendar_events_hide_duplicate_copies; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_events_hide_duplicate_copies ON public.calendar_events AS RESTRICTIVE FOR SELECT TO authenticated USING ((hidden_at IS NULL));


--
-- Name: calendar_events calendar_events_team_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_events_team_insert ON public.calendar_events FOR INSERT TO authenticated WITH CHECK (((public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role) OR public.has_role(( SELECT auth.uid() AS uid), 'collaborator'::public.app_role)) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((updated_by IS NULL) OR (updated_by = ( SELECT auth.uid() AS uid)))));


--
-- Name: calendar_events calendar_events_team_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_events_team_select ON public.calendar_events FOR SELECT TO authenticated USING ((public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role) OR public.has_role(( SELECT auth.uid() AS uid), 'collaborator'::public.app_role)));


--
-- Name: calendar_events calendar_events_team_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_events_team_update ON public.calendar_events FOR UPDATE TO authenticated USING ((public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role) OR public.has_role(( SELECT auth.uid() AS uid), 'collaborator'::public.app_role))) WITH CHECK ((public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role) OR public.has_role(( SELECT auth.uid() AS uid), 'collaborator'::public.app_role)));


--
-- Name: calendar_google_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_google_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_google_connections calendar_google_connections_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_google_connections_select_own ON public.calendar_google_connections FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: calendar_google_oauth_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_google_oauth_states ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_source_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_source_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_source_preferences calendar_source_preferences_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_source_preferences_own ON public.calendar_source_preferences TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: calendar_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_sources calendar_sources_team_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calendar_sources_team_select ON public.calendar_sources FOR SELECT TO authenticated USING ((public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role) OR public.has_role(( SELECT auth.uid() AS uid), 'collaborator'::public.app_role)));


--
-- Name: client_branches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_branches ENABLE ROW LEVEL SECURITY;

--
-- Name: client_department_employee_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_department_employee_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: client_department_employee_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_department_employee_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: client_department_employees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_department_employees ENABLE ROW LEVEL SECURITY;

--
-- Name: client_departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_departments ENABLE ROW LEVEL SECURITY;

--
-- Name: client_files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_files ENABLE ROW LEVEL SECURITY;

--
-- Name: client_important_dates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_important_dates ENABLE ROW LEVEL SECURITY;

--
-- Name: client_important_dates client_important_dates_workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_important_dates_workspace ON public.client_important_dates TO authenticated USING (public.can_access_workspace_client(client_id)) WITH CHECK (public.can_access_workspace_client(client_id));


--
-- Name: client_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: client_note_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_note_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: client_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: client_notes client_notes_invited_meeting_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_notes_invited_meeting_select ON public.client_notes FOR SELECT TO authenticated USING (((recurring_meeting_id IS NOT NULL) AND public.can_view_invited_meeting(recurring_meeting_id)));


--
-- Name: client_reference_topics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_reference_topics ENABLE ROW LEVEL SECURITY;

--
-- Name: client_reference_topics client_reference_topics_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_reference_topics_read ON public.client_reference_topics FOR SELECT TO authenticated USING (public.can_access_workspace_client(client_id));


--
-- Name: client_reference_topics client_reference_topics_staff_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_reference_topics_staff_write ON public.client_reference_topics TO authenticated USING ((public.can_access_workspace_client(client_id) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'collaborator'::public.app_role)))) WITH CHECK ((public.can_access_workspace_client(client_id) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'collaborator'::public.app_role))));


--
-- Name: client_references; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_references ENABLE ROW LEVEL SECURITY;

--
-- Name: client_references client_references_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_references_read ON public.client_references FOR SELECT TO authenticated USING (public.can_access_workspace_client(client_id));


--
-- Name: client_references client_references_staff_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_references_staff_write ON public.client_references TO authenticated USING ((public.can_access_workspace_client(client_id) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'collaborator'::public.app_role)))) WITH CHECK ((public.can_access_workspace_client(client_id) AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'collaborator'::public.app_role))));


--
-- Name: client_social_account_stats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_social_account_stats ENABLE ROW LEVEL SECURITY;

--
-- Name: client_social_account_stats client_social_account_stats_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_social_account_stats_select ON public.client_social_account_stats FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.client_social_accounts a
  WHERE ((a.id = client_social_account_stats.account_id) AND public.can_access_workspace_client(a.client_id)))));


--
-- Name: client_social_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_social_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: client_social_accounts client_social_accounts_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_social_accounts_delete ON public.client_social_accounts FOR DELETE TO authenticated USING (public.can_access_workspace_client(client_id));


--
-- Name: client_social_accounts client_social_accounts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_social_accounts_select ON public.client_social_accounts FOR SELECT TO authenticated USING (public.can_access_workspace_client(client_id));


--
-- Name: client_social_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_social_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: client_social_posts client_social_posts_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_social_posts_select ON public.client_social_posts FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.client_social_accounts a
  WHERE ((a.id = client_social_posts.account_id) AND public.can_access_workspace_client(a.client_id)))));


--
-- Name: client_system_accesses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_system_accesses ENABLE ROW LEVEL SECURITY;

--
-- Name: client_user_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_user_links ENABLE ROW LEVEL SECURITY;

--
-- Name: client_user_links client_user_links_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_user_links_select ON public.client_user_links FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role)));


--
-- Name: client_user_links client_user_links_workspace_admin_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_user_links_workspace_admin_manage ON public.client_user_links TO authenticated USING (public.can_manage_workspace_user(user_id)) WITH CHECK (public.can_manage_workspace_user(user_id));


--
-- Name: clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

--
-- Name: comment_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comment_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: comment_attachments comment_attachments_admin_oversight_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comment_attachments_admin_oversight_select ON public.comment_attachments FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.comments c
  WHERE ((c.id = comment_attachments.comment_id) AND (public.can_access_task_conversation(c.task_id) OR public.can_oversee_task_conversation(c.task_id))))));


--
-- Name: comment_mentions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comment_mentions ENABLE ROW LEVEL SECURITY;

--
-- Name: comment_mentions comment_mentions_admin_oversight_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comment_mentions_admin_oversight_select ON public.comment_mentions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.comments c
  WHERE ((c.id = comment_mentions.comment_id) AND (public.can_access_task_conversation(c.task_id) OR public.can_oversee_task_conversation(c.task_id))))));


--
-- Name: comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

--
-- Name: comments comments_admin_oversight_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comments_admin_oversight_select ON public.comments FOR SELECT TO authenticated USING ((public.can_access_task_conversation(task_id) OR public.can_oversee_task_conversation(task_id)));


--
-- Name: crm_opportunities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_opportunities ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_opportunities crm_opportunities_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_opportunities_delete ON public.crm_opportunities FOR DELETE TO authenticated USING (public.can_access_crm(workspace_id));


--
-- Name: crm_opportunities crm_opportunities_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_opportunities_insert ON public.crm_opportunities FOR INSERT TO authenticated WITH CHECK (public.can_access_crm(workspace_id));


--
-- Name: crm_opportunities crm_opportunities_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_opportunities_select ON public.crm_opportunities FOR SELECT TO authenticated USING (public.can_access_crm(workspace_id));


--
-- Name: crm_opportunities crm_opportunities_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_opportunities_update ON public.crm_opportunities FOR UPDATE TO authenticated USING (public.can_access_crm(workspace_id)) WITH CHECK (public.can_access_crm(workspace_id));


--
-- Name: crm_pipeline_stages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_pipeline_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_pipeline_stages crm_pipeline_stages_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_pipeline_stages_insert ON public.crm_pipeline_stages FOR INSERT TO authenticated WITH CHECK (public.can_access_crm(workspace_id));


--
-- Name: crm_pipeline_stages crm_pipeline_stages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_pipeline_stages_select ON public.crm_pipeline_stages FOR SELECT TO authenticated USING (public.can_access_crm(workspace_id));


--
-- Name: crm_pipeline_stages crm_pipeline_stages_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_pipeline_stages_update ON public.crm_pipeline_stages FOR UPDATE TO authenticated USING (public.can_access_crm(workspace_id)) WITH CHECK (public.can_access_crm(workspace_id));


--
-- Name: instagram_oauth_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.instagram_oauth_states ENABLE ROW LEVEL SECURITY;

--
-- Name: kanban_columns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kanban_columns ENABLE ROW LEVEL SECURITY;

--
-- Name: meeting_ata_imports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meeting_ata_imports ENABLE ROW LEVEL SECURITY;

--
-- Name: meeting_ata_imports meeting_ata_imports_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meeting_ata_imports_select ON public.meeting_ata_imports FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.recurring_meetings meeting
  WHERE ((meeting.id = meeting_ata_imports.recurring_meeting_id) AND public.has_workspace_access(meeting.workspace_id)))));


--
-- Name: meeting_minutes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meeting_minutes ENABLE ROW LEVEL SECURITY;

--
-- Name: meeting_minutes meeting_minutes_team_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meeting_minutes_team_select ON public.meeting_minutes FOR SELECT TO authenticated USING ((public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role) OR public.has_role(( SELECT auth.uid() AS uid), 'collaborator'::public.app_role)));


--
-- Name: meeting_transcripts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meeting_transcripts ENABLE ROW LEVEL SECURITY;

--
-- Name: meeting_transcripts meeting_transcripts_team_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meeting_transcripts_team_select ON public.meeting_transcripts FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'collaborator'::public.app_role)));


--
-- Name: workspace_memberships memberships_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY memberships_select_own_or_admin ON public.workspace_memberships FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role)));


--
-- Name: workspace_memberships memberships_workspace_admin_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY memberships_workspace_admin_manage ON public.workspace_memberships TO authenticated USING (public.can_manage_workspace_user(user_id)) WITH CHECK (public.can_manage_workspace_user(user_id));


--
-- Name: mural_post_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mural_post_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: mural_post_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mural_post_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: mural_post_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mural_post_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: mural_post_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mural_post_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: mural_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mural_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: obligation_occurrences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.obligation_occurrences ENABLE ROW LEVEL SECURITY;

--
-- Name: obligation_occurrences obligation_occurrences_workspace_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obligation_occurrences_workspace_access ON public.obligation_occurrences TO authenticated USING (public.has_workspace_access(workspace_id)) WITH CHECK (public.has_workspace_access(workspace_id));


--
-- Name: obligations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.obligations ENABLE ROW LEVEL SECURITY;

--
-- Name: obligations obligations_workspace_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY obligations_workspace_access ON public.obligations TO authenticated USING (public.has_workspace_access(workspace_id)) WITH CHECK (public.has_workspace_access(workspace_id));


--
-- Name: notifications own_notifs_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY own_notifs_delete ON public.notifications FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: notifications own_notifs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY own_notifs_select ON public.notifications FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: notifications own_notifs_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY own_notifs_update ON public.notifications FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = id));


--
-- Name: profiles profiles_select_all_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_all_auth ON public.profiles FOR SELECT TO authenticated USING (true);


--
-- Name: profiles profiles_update_own_or_workspace_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_own_or_workspace_admin ON public.profiles FOR UPDATE TO authenticated USING (((( SELECT auth.uid() AS uid) = id) OR public.can_manage_workspace_user(id))) WITH CHECK (((( SELECT auth.uid() AS uid) = id) OR public.can_manage_workspace_user(id)));


--
-- Name: recurring_meeting_agenda_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recurring_meeting_agenda_items ENABLE ROW LEVEL SECURITY;

--
-- Name: recurring_meeting_agenda_items recurring_meeting_agenda_items_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_meeting_agenda_items_access ON public.recurring_meeting_agenda_items TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.recurring_meeting_occurrences occurrence
  WHERE ((occurrence.id = recurring_meeting_agenda_items.occurrence_id) AND public.has_workspace_access(occurrence.workspace_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.recurring_meeting_occurrences occurrence
  WHERE ((occurrence.id = recurring_meeting_agenda_items.occurrence_id) AND public.has_workspace_access(occurrence.workspace_id)))));


--
-- Name: recurring_meeting_agenda_items recurring_meeting_agenda_items_invited_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_meeting_agenda_items_invited_select ON public.recurring_meeting_agenda_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.recurring_meeting_occurrences occurrence
  WHERE ((occurrence.id = recurring_meeting_agenda_items.occurrence_id) AND public.can_view_invited_meeting(occurrence.recurring_meeting_id)))));


--
-- Name: recurring_meeting_agenda_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recurring_meeting_agenda_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: recurring_meeting_agenda_templates recurring_meeting_agenda_templates_invited_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_meeting_agenda_templates_invited_select ON public.recurring_meeting_agenda_templates FOR SELECT TO authenticated USING (public.can_view_invited_meeting(recurring_meeting_id));


--
-- Name: recurring_meeting_agenda_templates recurring_meeting_agenda_templates_workspace_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_meeting_agenda_templates_workspace_access ON public.recurring_meeting_agenda_templates TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.recurring_meetings recurring_meeting
  WHERE ((recurring_meeting.id = recurring_meeting_agenda_templates.recurring_meeting_id) AND public.has_workspace_access(recurring_meeting.workspace_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.recurring_meetings recurring_meeting
  WHERE ((recurring_meeting.id = recurring_meeting_agenda_templates.recurring_meeting_id) AND public.has_workspace_access(recurring_meeting.workspace_id)))));


--
-- Name: recurring_meeting_department_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recurring_meeting_department_members ENABLE ROW LEVEL SECURITY;

--
-- Name: recurring_meeting_department_members recurring_meeting_department_members_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_meeting_department_members_access ON public.recurring_meeting_department_members TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.recurring_meeting_departments department
  WHERE ((department.id = recurring_meeting_department_members.department_id) AND public.has_workspace_access(department.workspace_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.recurring_meeting_departments department
  WHERE ((department.id = recurring_meeting_department_members.department_id) AND public.has_workspace_access(department.workspace_id)))));


--
-- Name: recurring_meeting_departments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recurring_meeting_departments ENABLE ROW LEVEL SECURITY;

--
-- Name: recurring_meeting_departments recurring_meeting_departments_workspace_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_meeting_departments_workspace_access ON public.recurring_meeting_departments TO authenticated USING (public.has_workspace_access(workspace_id)) WITH CHECK (public.has_workspace_access(workspace_id));


--
-- Name: recurring_meeting_occurrences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recurring_meeting_occurrences ENABLE ROW LEVEL SECURITY;

--
-- Name: recurring_meeting_occurrences recurring_meeting_occurrences_invited_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_meeting_occurrences_invited_select ON public.recurring_meeting_occurrences FOR SELECT TO authenticated USING (public.can_view_invited_meeting(recurring_meeting_id));


--
-- Name: recurring_meeting_occurrences recurring_meeting_occurrences_workspace_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_meeting_occurrences_workspace_access ON public.recurring_meeting_occurrences TO authenticated USING (public.has_workspace_access(workspace_id)) WITH CHECK (public.has_workspace_access(workspace_id));


--
-- Name: recurring_meeting_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recurring_meeting_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: recurring_meeting_participants recurring_meeting_participants_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_meeting_participants_access ON public.recurring_meeting_participants TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.recurring_meetings recurring_meeting
  WHERE ((recurring_meeting.id = recurring_meeting_participants.recurring_meeting_id) AND public.has_workspace_access(recurring_meeting.workspace_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.recurring_meetings recurring_meeting
  WHERE ((recurring_meeting.id = recurring_meeting_participants.recurring_meeting_id) AND public.has_workspace_access(recurring_meeting.workspace_id)))));


--
-- Name: recurring_meeting_participants recurring_meeting_participants_invited_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_meeting_participants_invited_select ON public.recurring_meeting_participants FOR SELECT TO authenticated USING (public.can_view_invited_meeting(recurring_meeting_id));


--
-- Name: recurring_meetings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recurring_meetings ENABLE ROW LEVEL SECURITY;

--
-- Name: recurring_meetings recurring_meetings_invited_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_meetings_invited_select ON public.recurring_meetings FOR SELECT TO authenticated USING (public.can_view_invited_meeting(id));


--
-- Name: recurring_meetings recurring_meetings_workspace_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_meetings_workspace_access ON public.recurring_meetings TO authenticated USING (public.has_workspace_access(workspace_id)) WITH CHECK (public.has_workspace_access(workspace_id));


--
-- Name: user_roles roles_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_select_own ON public.user_roles FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role)));


--
-- Name: user_roles roles_workspace_admin_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_workspace_admin_manage ON public.user_roles TO authenticated USING (public.can_manage_workspace_user(user_id)) WITH CHECK (public.can_manage_workspace_user(user_id));


--
-- Name: service_request_activity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_request_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: service_request_assignees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_request_assignees ENABLE ROW LEVEL SECURITY;

--
-- Name: service_request_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_request_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: service_request_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_request_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: service_request_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_request_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: service_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: subtask_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subtask_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: subtask_due_date_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subtask_due_date_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: subtasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;

--
-- Name: task_card_opens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_card_opens ENABLE ROW LEVEL SECURITY;

--
-- Name: task_card_opens task_card_opens_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_card_opens_select ON public.task_card_opens FOR SELECT TO authenticated USING (((NOT public.has_role(auth.uid(), 'client'::public.app_role)) AND public.can_access_workspace_task(task_id)));


--
-- Name: task_collaborators; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_collaborators ENABLE ROW LEVEL SECURITY;

--
-- Name: task_conversation_followers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_conversation_followers ENABLE ROW LEVEL SECURITY;

--
-- Name: task_conversation_followers task_conversation_followers_own_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_conversation_followers_own_select ON public.task_conversation_followers FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.can_access_task_conversation(task_id)));


--
-- Name: task_conversation_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_conversation_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: task_conversation_reads task_conversation_reads_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_conversation_reads_delete ON public.task_conversation_reads FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: task_conversation_reads task_conversation_reads_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_conversation_reads_select ON public.task_conversation_reads FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.can_access_task_conversation(task_id) OR public.can_oversee_task_conversation(task_id)));


--
-- Name: task_conversation_reads task_conversation_reads_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_conversation_reads_update ON public.task_conversation_reads FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: task_conversation_reads task_conversation_reads_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_conversation_reads_write ON public.task_conversation_reads FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: task_due_date_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_due_date_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: task_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_history ENABLE ROW LEVEL SECURITY;

--
-- Name: task_interruptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_interruptions ENABLE ROW LEVEL SECURITY;

--
-- Name: task_interruptions task_interruptions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_interruptions_delete ON public.task_interruptions FOR DELETE TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) OR public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role)));


--
-- Name: task_interruptions task_interruptions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_interruptions_select ON public.task_interruptions FOR SELECT TO authenticated USING (public.can_view_task(task_id));


--
-- Name: task_interruptions task_interruptions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_interruptions_update ON public.task_interruptions FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: task_interruptions task_interruptions_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_interruptions_write ON public.task_interruptions FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND public.can_view_task(task_id)));


--
-- Name: task_objectives; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_objectives ENABLE ROW LEVEL SECURITY;

--
-- Name: task_objectives task_objectives_workspace_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_objectives_workspace_access ON public.task_objectives TO authenticated USING (public.has_workspace_access(workspace_id)) WITH CHECK (public.has_workspace_access(workspace_id));


--
-- Name: task_personal_pins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_personal_pins ENABLE ROW LEVEL SECURITY;

--
-- Name: task_personal_pins task_personal_pins_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_personal_pins_select ON public.task_personal_pins FOR SELECT TO authenticated USING (((user_id = auth.uid()) AND (NOT public.has_role(auth.uid(), 'client'::public.app_role)) AND public.can_access_workspace_task(task_id)));


--
-- Name: task_statuses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_statuses ENABLE ROW LEVEL SECURITY;

--
-- Name: task_tag_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_tag_links ENABLE ROW LEVEL SECURITY;

--
-- Name: task_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: user_column_order; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_column_order ENABLE ROW LEVEL SECURITY;

--
-- Name: user_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_permissions user_permissions_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_permissions_select_own_or_admin ON public.user_permissions FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role)));


--
-- Name: user_permissions user_permissions_workspace_admin_manage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_permissions_workspace_admin_manage ON public.user_permissions TO authenticated USING (public.can_manage_workspace_user(user_id)) WITH CHECK (public.can_manage_workspace_user(user_id));


--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_task_order; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_task_order ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_access_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_access_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_access_settings workspace_access_settings_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_access_settings_admin_read ON public.workspace_access_settings FOR SELECT TO authenticated USING (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role));


--
-- Name: attachments workspace_attachments_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_attachments_parent ON public.attachments TO authenticated USING (public.can_access_workspace_task(task_id)) WITH CHECK (public.can_access_workspace_task(task_id));


--
-- Name: board_preferences workspace_board_preferences_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_board_preferences_own ON public.board_preferences TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND public.has_workspace_access(workspace_id))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND public.has_workspace_access(workspace_id)));


--
-- Name: client_branches workspace_client_branches_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_client_branches_parent ON public.client_branches TO authenticated USING (public.can_access_workspace_client(client_id)) WITH CHECK (public.can_access_workspace_client(client_id));


--
-- Name: client_department_employee_attachments workspace_client_department_employee_attachments_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_client_department_employee_attachments_parent ON public.client_department_employee_attachments TO authenticated USING (public.can_access_workspace_employee(employee_id)) WITH CHECK (public.can_access_workspace_employee(employee_id));


--
-- Name: client_department_employee_notes workspace_client_department_employee_notes_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_client_department_employee_notes_parent ON public.client_department_employee_notes TO authenticated USING (public.can_access_workspace_employee(employee_id)) WITH CHECK (public.can_access_workspace_employee(employee_id));


--
-- Name: client_department_employees workspace_client_department_employees_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_client_department_employees_parent ON public.client_department_employees TO authenticated USING (public.can_access_workspace_department(department_id)) WITH CHECK (public.can_access_workspace_department(department_id));


--
-- Name: client_departments workspace_client_departments_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_client_departments_parent ON public.client_departments TO authenticated USING (public.can_access_workspace_client(client_id)) WITH CHECK (public.can_access_workspace_client(client_id));


--
-- Name: client_files workspace_client_files_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_client_files_parent ON public.client_files TO authenticated USING (public.can_sync_client_file_from_task(client_id)) WITH CHECK (public.can_sync_client_file_from_task(client_id));


--
-- Name: client_invoices workspace_client_invoices_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_client_invoices_parent ON public.client_invoices TO authenticated USING (public.can_access_workspace_client(client_id)) WITH CHECK (public.can_access_workspace_client(client_id));


--
-- Name: client_note_attachments workspace_client_note_attachments_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_client_note_attachments_parent ON public.client_note_attachments TO authenticated USING (public.can_access_workspace_note(note_id)) WITH CHECK (public.can_access_workspace_note(note_id));


--
-- Name: client_notes workspace_client_notes_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_client_notes_parent ON public.client_notes TO authenticated USING (public.can_access_workspace_client(client_id)) WITH CHECK (public.can_access_workspace_client(client_id));


--
-- Name: client_system_accesses workspace_client_system_accesses_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_client_system_accesses_parent ON public.client_system_accesses TO authenticated USING (public.can_access_workspace_client(client_id)) WITH CHECK (public.can_access_workspace_client(client_id));


--
-- Name: clients workspace_clients_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_clients_access ON public.clients TO authenticated USING (public.has_workspace_access(workspace_id)) WITH CHECK (public.has_workspace_access(workspace_id));


--
-- Name: comment_attachments workspace_comment_attachments_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_comment_attachments_parent ON public.comment_attachments TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.comments c
  WHERE ((c.id = comment_attachments.comment_id) AND public.can_access_task_conversation(c.task_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.comments c
  WHERE ((c.id = comment_attachments.comment_id) AND public.can_access_task_conversation(c.task_id)))));


--
-- Name: comment_mentions workspace_comment_mentions_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_comment_mentions_parent ON public.comment_mentions TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.comments c
  WHERE ((c.id = comment_mentions.comment_id) AND public.can_access_task_conversation(c.task_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.comments c
  WHERE ((c.id = comment_mentions.comment_id) AND public.can_access_task_conversation(c.task_id)))));


--
-- Name: comments workspace_comments_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_comments_parent ON public.comments TO authenticated USING (public.can_access_task_conversation(task_id)) WITH CHECK (public.can_access_task_conversation(task_id));


--
-- Name: kanban_columns workspace_kanban_columns_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_kanban_columns_access ON public.kanban_columns TO authenticated USING (public.has_workspace_access(workspace_id)) WITH CHECK (public.has_workspace_access(workspace_id));


--
-- Name: workspace_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: mural_post_attachments workspace_mural_post_attachments_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_mural_post_attachments_parent ON public.mural_post_attachments TO authenticated USING (public.can_access_workspace_mural_post(post_id)) WITH CHECK (public.can_access_workspace_mural_post(post_id));


--
-- Name: mural_post_orders workspace_mural_post_orders_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_mural_post_orders_parent ON public.mural_post_orders TO authenticated USING (public.can_access_workspace_mural_post(post_id)) WITH CHECK (public.can_access_workspace_mural_post(post_id));


--
-- Name: mural_post_reactions workspace_mural_post_reactions_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_mural_post_reactions_parent ON public.mural_post_reactions TO authenticated USING (public.can_access_workspace_mural_post(post_id)) WITH CHECK (public.can_access_workspace_mural_post(post_id));


--
-- Name: mural_post_reads workspace_mural_post_reads_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_mural_post_reads_parent ON public.mural_post_reads TO authenticated USING (public.can_access_workspace_mural_post(post_id)) WITH CHECK (public.can_access_workspace_mural_post(post_id));


--
-- Name: mural_posts workspace_mural_posts_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_mural_posts_access ON public.mural_posts TO authenticated USING (public.has_workspace_access(workspace_id)) WITH CHECK (public.has_workspace_access(workspace_id));


--
-- Name: service_request_activity workspace_service_request_activity_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_service_request_activity_parent ON public.service_request_activity TO authenticated USING (public.can_access_workspace_request(request_id)) WITH CHECK (public.can_access_workspace_request(request_id));


--
-- Name: service_request_assignees workspace_service_request_assignees_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_service_request_assignees_parent ON public.service_request_assignees TO authenticated USING (public.can_access_workspace_request(request_id)) WITH CHECK (public.can_access_workspace_request(request_id));


--
-- Name: service_request_attachments workspace_service_request_attachments_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_service_request_attachments_parent ON public.service_request_attachments TO authenticated USING (public.can_access_workspace_request(request_id)) WITH CHECK (public.can_access_workspace_request(request_id));


--
-- Name: service_request_messages workspace_service_request_messages_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_service_request_messages_parent ON public.service_request_messages TO authenticated USING (public.can_access_workspace_request(request_id)) WITH CHECK (public.can_access_workspace_request(request_id));


--
-- Name: service_request_participants workspace_service_request_participants_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_service_request_participants_parent ON public.service_request_participants TO authenticated USING (public.can_access_workspace_request(request_id)) WITH CHECK (public.can_access_workspace_request(request_id));


--
-- Name: service_requests workspace_service_requests_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_service_requests_access ON public.service_requests TO authenticated USING (public.has_workspace_access(workspace_id)) WITH CHECK (public.has_workspace_access(workspace_id));


--
-- Name: subtask_attachments workspace_subtask_attachments_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_subtask_attachments_parent ON public.subtask_attachments TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.subtasks s
  WHERE ((s.id = subtask_attachments.subtask_id) AND public.can_access_workspace_task(s.task_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.subtasks s
  WHERE ((s.id = subtask_attachments.subtask_id) AND public.can_access_workspace_task(s.task_id)))));


--
-- Name: subtask_due_date_changes workspace_subtask_due_date_changes_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_subtask_due_date_changes_parent ON public.subtask_due_date_changes TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.subtasks s
  WHERE ((s.id = subtask_due_date_changes.subtask_id) AND public.can_access_workspace_task(s.task_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.subtasks s
  WHERE ((s.id = subtask_due_date_changes.subtask_id) AND public.can_access_workspace_task(s.task_id)))));


--
-- Name: subtasks workspace_subtasks_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_subtasks_parent ON public.subtasks TO authenticated USING (public.can_access_workspace_task(task_id)) WITH CHECK (public.can_access_workspace_task(task_id));


--
-- Name: task_collaborators workspace_task_collaborators_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_task_collaborators_parent ON public.task_collaborators TO authenticated USING (public.can_access_workspace_task(task_id)) WITH CHECK (public.can_access_workspace_task(task_id));


--
-- Name: task_due_date_changes workspace_task_due_date_changes_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_task_due_date_changes_parent ON public.task_due_date_changes TO authenticated USING (public.can_access_workspace_task(task_id)) WITH CHECK (public.can_access_workspace_task(task_id));


--
-- Name: task_history workspace_task_history_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_task_history_parent ON public.task_history TO authenticated USING (public.can_access_workspace_task(task_id)) WITH CHECK (public.can_access_workspace_task(task_id));


--
-- Name: task_statuses workspace_task_statuses_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_task_statuses_access ON public.task_statuses TO authenticated USING (public.has_workspace_access(workspace_id)) WITH CHECK (public.has_workspace_access(workspace_id));


--
-- Name: task_tag_links workspace_task_tag_links_parent; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_task_tag_links_parent ON public.task_tag_links TO authenticated USING (public.can_access_workspace_task(task_id)) WITH CHECK (public.can_access_workspace_task(task_id));


--
-- Name: task_tags workspace_task_tags_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_task_tags_delete ON public.task_tags FOR DELETE TO authenticated USING ((public.has_workspace_access(workspace_id) AND ((NOT (EXISTS ( SELECT 1
   FROM public.workspaces
  WHERE ((workspaces.id = task_tags.workspace_id) AND (workspaces.slug = 'marketing'::text))))) OR public.has_role(auth.uid(), 'admin'::public.app_role))));


--
-- Name: task_tags workspace_task_tags_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_task_tags_insert ON public.task_tags FOR INSERT TO authenticated WITH CHECK ((public.has_workspace_access(workspace_id) AND ((NOT (EXISTS ( SELECT 1
   FROM public.workspaces
  WHERE ((workspaces.id = task_tags.workspace_id) AND (workspaces.slug = 'marketing'::text))))) OR public.has_role(auth.uid(), 'admin'::public.app_role))));


--
-- Name: task_tags workspace_task_tags_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_task_tags_select ON public.task_tags FOR SELECT TO authenticated USING (public.has_workspace_access(workspace_id));


--
-- Name: task_tags workspace_task_tags_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_task_tags_update ON public.task_tags FOR UPDATE TO authenticated USING ((public.has_workspace_access(workspace_id) AND ((NOT (EXISTS ( SELECT 1
   FROM public.workspaces
  WHERE ((workspaces.id = task_tags.workspace_id) AND (workspaces.slug = 'marketing'::text))))) OR public.has_role(auth.uid(), 'admin'::public.app_role)))) WITH CHECK ((public.has_workspace_access(workspace_id) AND ((NOT (EXISTS ( SELECT 1
   FROM public.workspaces
  WHERE ((workspaces.id = task_tags.workspace_id) AND (workspaces.slug = 'marketing'::text))))) OR public.has_role(auth.uid(), 'admin'::public.app_role))));


--
-- Name: tasks workspace_tasks_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_tasks_delete ON public.tasks FOR DELETE TO authenticated USING ((public.has_workspace_access(workspace_id) OR public.can_create_in_workspace(workspace_id)));


--
-- Name: tasks workspace_tasks_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_tasks_insert ON public.tasks FOR INSERT TO authenticated WITH CHECK (public.can_create_in_workspace(workspace_id));


--
-- Name: tasks workspace_tasks_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_tasks_select ON public.tasks FOR SELECT TO authenticated USING ((public.has_workspace_access(workspace_id) OR public.participates_in_task(id) OR ((origin_workspace_id IS DISTINCT FROM workspace_id) AND (created_by = ( SELECT auth.uid() AS uid)) AND public.has_workspace_access(origin_workspace_id))));


--
-- Name: tasks workspace_tasks_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_tasks_update ON public.tasks FOR UPDATE TO authenticated USING ((public.has_workspace_access(workspace_id) OR public.can_create_in_workspace(workspace_id) OR public.participates_in_task(id))) WITH CHECK ((public.has_workspace_access(workspace_id) OR public.can_create_in_workspace(workspace_id) OR public.participates_in_task(id)));


--
-- Name: user_column_order workspace_user_column_order_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_user_column_order_own ON public.user_column_order TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND public.has_workspace_access(workspace_id))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND public.has_workspace_access(workspace_id)));


--
-- Name: user_task_order workspace_user_task_order_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_user_task_order_own ON public.user_task_order TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) AND public.has_workspace_access(workspace_id))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND public.has_workspace_access(workspace_id)));


--
-- Name: workspaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces workspaces_select_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspaces_select_member ON public.workspaces FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.workspace_memberships m
  WHERE ((m.workspace_id = workspaces.id) AND (m.user_id = ( SELECT auth.uid() AS uid))))));


--
-- PostgreSQL database dump complete
--

\unrestrict EBT8UmETBGEMYCfWB41YTMXzzev1M6wa4xLHJ6ZwdjyKQ31923NtqABTaVaP0ow
