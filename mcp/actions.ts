import { randomUUID } from "node:crypto";
import type { Query } from "./db.ts";
import type { Ambiente } from "./tools.ts";

/**
 * Write tools. Each one changes a single, specific thing as the caller: database triggers fill
 * workspace, author and notifications exactly as for the app, and RLS decides what is allowed.
 * There is deliberately no delete. Claude apps ask the person before running any of these.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export type Status = "todo" | "in_progress" | "review" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";

/** Same convention as duplicate-task.ts: a date-only deadline is noon in São Paulo. */
export const deadline = (date: string) => `${date}T12:00:00-03:00`;

function invalid(fields: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (name.endsWith("_id") && !UUID.test(value)) return `${name} inválido.`;
    if (name === "prazo" && !DATE.test(value)) return "Use o prazo no formato AAAA-MM-DD.";
  }
  return null;
}

async function workspaceFor(query: Query, ambiente: Ambiente | undefined) {
  const workspaces = await query<{ id: string; slug: string; name: string }>(
    "select id, slug, name from public.workspaces order by name",
  );
  if (ambiente) return workspaces.find((w) => w.slug === ambiente) ?? null;
  return workspaces.length === 1 ? workspaces[0] : null;
}

async function statusIdFor(query: Query, workspaceId: string | null, done: boolean) {
  const [row] = await query<{ id: string }>(
    `select id from public.task_statuses
      where is_completed = $2 and (workspace_id = $1 or workspace_id is null)
      order by (workspace_id is null), position limit 1`,
    [workspaceId, done],
  );
  return row?.id ?? null;
}

export async function createCard(
  query: Query,
  userId: string,
  args: {
    titulo: string;
    prazo: string;
    descricao?: string;
    cliente_id?: string;
    responsavel_id?: string;
    prioridade?: Priority;
    ambiente?: Ambiente;
  },
) {
  const error = invalid({
    prazo: args.prazo,
    cliente_id: args.cliente_id,
    responsavel_id: args.responsavel_id,
  });
  if (error) return error;
  const workspace = await workspaceFor(query, args.ambiente);
  if (!workspace)
    return "Informe o ambiente (marketing ou consultoria) em que o card deve ser criado.";
  // No RETURNING: the tasks SELECT policy cannot see a row inside its own INSERT (see TaskDialog).
  const id = randomUUID();
  await query(
    `insert into public.tasks
       (id, title, description, due_date, client_id, assignee_id, priority, status, status_id,
        workspace_id, created_by, is_draft, position)
     values ($10, $1, $2, $3, $4, $5, $6, 'todo', $7, $8, $9, false, 9999)`,
    [
      args.titulo.trim(),
      args.descricao?.trim() || null,
      deadline(args.prazo),
      args.cliente_id ?? null,
      args.responsavel_id ?? null,
      args.prioridade ?? "medium",
      await statusIdFor(query, workspace.id, false),
      workspace.id,
      userId,
      id,
    ],
  );
  await query(
    "insert into public.task_history (task_id, user_id, action) values ($1, $2, 'created')",
    [id, userId],
  );
  return `Card "${args.titulo.trim()}" criado em ${workspace.name} · id ${id}`;
}

export async function updateCard(
  query: Query,
  userId: string,
  args: {
    card_id: string;
    titulo?: string;
    descricao?: string;
    prazo?: string;
    prioridade?: Priority;
    status?: Status;
    responsavel_id?: string;
    cliente_id?: string;
  },
) {
  const error = invalid({
    card_id: args.card_id,
    prazo: args.prazo,
    responsavel_id: args.responsavel_id,
    cliente_id: args.cliente_id,
  });
  if (error) return error;
  const [card] = await query<{ workspace_id: string | null; title: string }>(
    "select workspace_id, title from public.tasks where id = $1 and deleted_at is null",
    [args.card_id],
  );
  if (!card) return "Card não encontrado ou sem acesso.";

  const changes: Record<string, unknown> = {};
  if (args.titulo !== undefined) changes.title = args.titulo.trim();
  if (args.descricao !== undefined) changes.description = args.descricao.trim() || null;
  if (args.prazo !== undefined) changes.due_date = deadline(args.prazo);
  if (args.prioridade !== undefined) changes.priority = args.prioridade;
  if (args.responsavel_id !== undefined) changes.assignee_id = args.responsavel_id;
  if (args.cliente_id !== undefined) changes.client_id = args.cliente_id;
  if (args.status !== undefined) {
    const done = args.status === "done";
    changes.status = args.status;
    changes.status_id = await statusIdFor(query, card.workspace_id, done);
    changes.completed_at = done ? new Date().toISOString() : null;
  }
  const columns = Object.keys(changes);
  if (!columns.length) return "Nada para alterar.";

  const updated = await query(
    `update public.tasks set ${columns.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now()
      where id = $1 returning id`,
    [args.card_id, ...Object.values(changes)],
  );
  if (!updated.length) return "Você não tem permissão para alterar este card.";
  await query(
    "insert into public.task_history (task_id, user_id, action, details) values ($1, $2, 'updated', $3)",
    [args.card_id, userId, JSON.stringify({ via: "claude", fields: columns })],
  );
  return `Card "${changes.title ?? card.title}" atualizado (${columns.join(", ")}).`;
}

export async function commentCard(
  query: Query,
  userId: string,
  { card_id, texto }: { card_id: string; texto: string },
) {
  if (!UUID.test(card_id)) return "card_id inválido.";
  const [position] = await query<{ next: number }>(
    "select coalesce(max(position), -1) + 1 as next from public.comments where task_id = $1",
    [card_id],
  );
  await query(
    "insert into public.comments (task_id, author_id, body, position) values ($1, $2, $3, $4)",
    [card_id, userId, texto.trim(), position.next],
  );
  return "Comentário publicado no card.";
}

export async function addSubtask(
  query: Query,
  {
    card_id,
    titulo,
    prazo,
    responsavel_id,
  }: { card_id: string; titulo: string; prazo?: string; responsavel_id?: string },
) {
  const error = invalid({ card_id, prazo, responsavel_id });
  if (error) return error;
  const [position] = await query<{ next: number }>(
    "select count(*)::int as next from public.subtasks where task_id = $1",
    [card_id],
  );
  const [created] = await query<{ id: string }>(
    `insert into public.subtasks (task_id, title, position, due_date, assignee_id)
     values ($1, $2, $3, $4, $5) returning id`,
    [card_id, titulo.trim(), position.next, prazo ? deadline(prazo) : null, responsavel_id ?? null],
  );
  return `Subtarefa "${titulo.trim()}" criada · id ${created.id}`;
}

export async function setSubtaskDone(
  query: Query,
  { subtarefa_id, concluida = true }: { subtarefa_id: string; concluida?: boolean },
) {
  if (!UUID.test(subtarefa_id)) return "subtarefa_id inválido.";
  const updated = await query<{ title: string }>(
    `update public.subtasks set done = $2, completed_at = case when $2 then now() end
      where id = $1 returning title`,
    [subtarefa_id, concluida],
  );
  if (!updated.length) return "Subtarefa não encontrada ou sem permissão.";
  return `Subtarefa "${updated[0].title}" ${concluida ? "concluída" : "reaberta"}.`;
}
