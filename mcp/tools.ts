import type { Query } from "./db.ts";

export type Ambiente = "marketing" | "consultoria";

type Workspace = { id: string; slug: Ambiente; name: string };
type Card = {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  due_date: Date | null;
  cliente: string | null;
};

const STATUS: Record<string, string> = {
  todo: "A fazer",
  in_progress: "Em andamento",
  review: "Revisão",
  done: "Concluído",
};
const PRIORIDADE: Record<string, string> = {
  low: "baixa",
  medium: "média",
  high: "alta",
  urgent: "urgente",
};

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(
    date,
  );

/** RLS returns only the environments the caller belongs to. */
export async function listWorkspaces(query: Query) {
  const workspaces = await query<Workspace>(
    "select id, slug, name from public.workspaces order by name",
  );
  if (!workspaces.length) return "Você ainda não participa de nenhum ambiente do TaskFlow.";
  return `Ambientes disponíveis:\n${workspaces.map((w) => `- ${w.name} (${w.slug})`).join("\n")}`;
}

export async function listCards(
  query: Query,
  {
    ambiente,
    limite = 20,
    incluir_concluidos = false,
  }: { ambiente: Ambiente; limite?: number; incluir_concluidos?: boolean },
) {
  const [workspace] = await query<Workspace>(
    "select id, slug, name from public.workspaces where slug = $1",
    [ambiente],
  );
  if (!workspace) return `Você não tem acesso ao ambiente ${ambiente}.`;

  const cards = await query<Card>(
    `select t.id, t.title, t.status, t.priority, t.due_date, c.name as cliente
       from public.tasks t
       left join public.clients c on c.id = t.client_id
      where t.workspace_id = $1
        and t.deleted_at is null
        and t.archived_at is null
        and not t.is_draft
        and ($2 or t.status is distinct from 'done')
      order by t.due_date asc nulls last, t.created_at desc
      limit $3`,
    [workspace.id, incluir_concluidos, limite],
  );
  if (!cards.length) return `Nenhum card encontrado em ${workspace.name}.`;

  const lines = cards.map((card) =>
    [
      `- ${card.title}`,
      card.cliente ? `cliente: ${card.cliente}` : null,
      card.status ? (STATUS[card.status] ?? card.status) : null,
      card.priority ? `prioridade ${PRIORIDADE[card.priority] ?? card.priority}` : null,
      card.due_date ? `prazo ${formatDate(card.due_date)}` : null,
      `id ${card.id}`,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  return `${cards.length} card(s) em ${workspace.name}:\n${lines.join("\n")}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const short = (text: string | null | undefined, max = 280) =>
  !text ? "" : text.length > max ? `${text.slice(0, max)}…` : text;
const cardLine = (card: Card) =>
  [
    `- ${card.title}`,
    card.status ? (STATUS[card.status] ?? card.status) : null,
    card.priority ? `prioridade ${PRIORIDADE[card.priority] ?? card.priority}` : null,
    card.due_date ? `prazo ${formatDate(card.due_date)}` : null,
    `id ${card.id}`,
  ]
    .filter(Boolean)
    .join(" · ");

/** Finds clients and cards by name or title, so later tools can work with exact ids. */
export async function search(query: Query, { termo }: { termo: string }) {
  const pattern = `%${termo.trim()}%`;
  const clients = await query<{ id: string; name: string }>(
    `select id, name from public.clients
      where name ilike $1 or trade_name ilike $1 or legal_name ilike $1 or cnpj ilike $1
      order by name limit 10`,
    [pattern],
  );
  const cards = await query<Card>(
    `select t.id, t.title, t.status, t.priority, t.due_date, c.name as cliente
       from public.tasks t left join public.clients c on c.id = t.client_id
      where t.deleted_at is null and (t.title ilike $1 or t.description ilike $1)
      order by t.updated_at desc limit 15`,
    [pattern],
  );
  if (!clients.length && !cards.length) return `Nada encontrado para "${termo}".`;
  return [
    clients.length ? `Clientes:\n${clients.map((c) => `- ${c.name} · id ${c.id}`).join("\n")}` : "",
    cards.length ? `Cards:\n${cards.map(cardLine).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function resolveClient(query: Query, cliente: string) {
  const matches = await query<{ id: string; name: string }>(
    UUID.test(cliente)
      ? "select id, name from public.clients where id = $1"
      : "select id, name from public.clients where name ilike $1 or trade_name ilike $1 order by name limit 6",
    [UUID.test(cliente) ? cliente : `%${cliente.trim()}%`],
  );
  return matches;
}

/** Everything a person would open to answer "how is this client doing?". */
export async function clientSummary(query: Query, { cliente }: { cliente: string }) {
  const matches = await resolveClient(query, cliente);
  if (!matches.length) return `Cliente "${cliente}" não encontrado ou sem acesso.`;
  if (matches.length > 1)
    return `Mais de um cliente corresponde a "${cliente}". Escolha pelo id:\n${matches
      .map((c) => `- ${c.name} · id ${c.id}`)
      .join("\n")}`;
  const [client] = matches;
  const [info] = await query<Record<string, string | boolean | null>>(
    `select name, legal_name, cnpj, responsible, email, phone, is_active, description
       from public.clients where id = $1`,
    [client.id],
  );
  const cards = await query<Card>(
    `select t.id, t.title, t.status, t.priority, t.due_date, null as cliente
       from public.tasks t
      where t.client_id = $1 and t.deleted_at is null and t.archived_at is null and not t.is_draft
      order by (t.status = 'done'), t.due_date asc nulls last limit 40`,
    [client.id],
  );
  const comments = await query<{ title: string; body: string; author: string; created_at: Date }>(
    `select t.title, cm.body, p.full_name as author, cm.created_at
       from public.comments cm
       join public.tasks t on t.id = cm.task_id
       left join public.profiles p on p.id = cm.author_id
      where t.client_id = $1 and t.deleted_at is null
      order by cm.created_at desc limit 15`,
    [client.id],
  );
  const notes = await query<{ title: string; content: string; note_date: Date }>(
    `select title, content, note_date from public.client_notes
      where client_id = $1 order by note_date desc, created_at desc limit 8`,
    [client.id],
  );
  const files = await query<{ id: string; file_name: string; title: string }>(
    `select a.id, a.file_name, t.title from public.attachments a
       join public.tasks t on t.id = a.task_id
      where t.client_id = $1 and t.deleted_at is null
      order by a.created_at desc limit 20`,
    [client.id],
  );
  const open = cards.filter((c) => c.status !== "done");
  const overdue = open.filter((c) => c.due_date && c.due_date.getTime() < Date.now());
  return [
    `# ${info.name}${info.is_active === false ? " (inativo)" : ""}`,
    [
      info.legal_name && `Razão social: ${info.legal_name}`,
      info.cnpj && `CNPJ: ${info.cnpj}`,
      info.responsible && `Responsável: ${info.responsible}`,
      info.email && `E-mail: ${info.email}`,
      info.phone && `Telefone: ${info.phone}`,
      info.description && `Observações: ${short(String(info.description))}`,
    ]
      .filter(Boolean)
      .join("\n"),
    `## Cards: ${open.length} abertos, ${overdue.length} atrasados, ${cards.length - open.length} concluídos (amostra de até 40)`,
    cards.map(cardLine).join("\n") || "Nenhum card.",
    `## Comentários recentes`,
    comments
      .map(
        (c) =>
          `- ${formatDate(c.created_at)} · ${c.author ?? "?"} em "${c.title}": ${short(c.body)}`,
      )
      .join("\n") || "Nenhum comentário.",
    `## Anotações do cliente`,
    notes
      .map((n) => `- ${formatDate(n.note_date)} · ${n.title || "Sem título"}: ${short(n.content)}`)
      .join("\n") || "Nenhuma anotação.",
    `## Arquivos anexados (use ler_anexo com o id)`,
    files.map((f) => `- ${f.file_name} (card "${f.title}") · id ${f.id}`).join("\n") ||
      "Nenhum arquivo.",
    `Cliente id ${client.id}`,
  ].join("\n\n");
}

/** One card with its subtasks, conversation, files and history. */
export async function cardDetails(query: Query, { card_id }: { card_id: string }) {
  if (!UUID.test(card_id)) return "Informe o id do card (use buscar para encontrá-lo).";
  const [card] = await query<
    Card & { description: string | null; responsavel: string | null; created_at: Date }
  >(
    `select t.id, t.title, t.status, t.priority, t.due_date, t.description, t.created_at,
            c.name as cliente, p.full_name as responsavel
       from public.tasks t
       left join public.clients c on c.id = t.client_id
       left join public.profiles p on p.id = t.assignee_id
      where t.id = $1 and t.deleted_at is null`,
    [card_id],
  );
  if (!card) return "Card não encontrado ou sem acesso.";
  const subtasks = await query<{ id: string; title: string; done: boolean; due_date: Date | null }>(
    "select id, title, done, due_date from public.subtasks where task_id = $1 order by position",
    [card_id],
  );
  const comments = await query<{ body: string; author: string; created_at: Date }>(
    `select cm.body, p.full_name as author, cm.created_at
       from public.comments cm left join public.profiles p on p.id = cm.author_id
      where cm.task_id = $1 order by cm.created_at`,
    [card_id],
  );
  const files = await query<{ id: string; file_name: string; mime_type: string | null }>(
    "select id, file_name, mime_type from public.attachments where task_id = $1 order by created_at",
    [card_id],
  );
  const history = await query<{ action: string; who: string; created_at: Date }>(
    `select h.action, p.full_name as who, h.created_at
       from public.task_history h left join public.profiles p on p.id = h.user_id
      where h.task_id = $1 order by h.created_at desc limit 10`,
    [card_id],
  );
  return [
    `# ${card.title}`,
    [
      card.cliente && `Cliente: ${card.cliente}`,
      card.responsavel && `Responsável: ${card.responsavel}`,
      card.status && `Status: ${STATUS[card.status] ?? card.status}`,
      card.priority && `Prioridade: ${PRIORIDADE[card.priority] ?? card.priority}`,
      card.due_date && `Prazo: ${formatDate(card.due_date)}`,
      `Criado em ${formatDate(card.created_at)} · id ${card.id}`,
    ]
      .filter(Boolean)
      .join("\n"),
    card.description ? `## Descrição\n${card.description}` : "",
    `## Subtarefas`,
    subtasks
      .map(
        (s) =>
          `- [${s.done ? "x" : " "}] ${s.title}${s.due_date ? ` · prazo ${formatDate(s.due_date)}` : ""} · id ${s.id}`,
      )
      .join("\n") || "Nenhuma.",
    `## Conversa`,
    comments
      .map((c) => `- ${formatDate(c.created_at)} · ${c.author ?? "?"}: ${c.body}`)
      .join("\n") || "Nenhum comentário.",
    `## Arquivos (use ler_anexo com o id)`,
    files.map((f) => `- ${f.file_name} · id ${f.id}`).join("\n") || "Nenhum.",
    `## Histórico recente`,
    history
      .map((h) => `- ${formatDate(h.created_at)} · ${h.who ?? "?"} · ${h.action}`)
      .join("\n") || "Sem registros.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const ATTACHMENT_LIMIT = 8 * 1024 * 1024;
const TEXT_TYPES = /^(text\/|application\/(json|xml|csv))/;

type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; mimeType: string; blob: string } };

/** Returns an attachment in a form Claude can read: text, image or PDF. */
export async function readAttachment(
  query: Query,
  { anexo_id }: { anexo_id: string },
): Promise<ToolContent[]> {
  const text = (value: string): ToolContent[] => [{ type: "text", text: value }];
  if (!UUID.test(anexo_id)) return text("Informe o id do anexo.");
  const [file] = await query<{
    file_name: string;
    mime_type: string | null;
    size: number | null;
    payload: Buffer | null;
  }>(
    `select a.file_name, coalesce(a.mime_type, o.metadata->>'mimetype') as mime_type,
            octet_length(o.payload) as size,
            case when octet_length(o.payload) <= $2 then o.payload end as payload
       from public.attachments a
       join storage.objects o on o.bucket_id = 'task-attachments' and o.name = a.storage_path
      where a.id = $1`,
    [anexo_id, ATTACHMENT_LIMIT],
  );
  if (!file) return text("Anexo não encontrado ou sem acesso.");
  if (!file.payload)
    return text(
      `"${file.file_name}" tem ${Math.round((file.size ?? 0) / 1048576)} MB, acima do limite de 8 MB.`,
    );
  const mime = file.mime_type ?? "application/octet-stream";
  if (TEXT_TYPES.test(mime) || /\.(txt|md|csv|json)$/i.test(file.file_name))
    return text(`Conteúdo de "${file.file_name}":\n\n${file.payload.toString("utf8")}`);
  if (mime.startsWith("image/"))
    return [
      { type: "text", text: `Imagem "${file.file_name}":` },
      { type: "image", data: file.payload.toString("base64"), mimeType: mime },
    ];
  if (mime === "application/pdf" || /\.pdf$/i.test(file.file_name))
    return [
      { type: "text", text: `PDF "${file.file_name}":` },
      {
        type: "resource",
        resource: {
          uri: `taskflow://anexos/${anexo_id}`,
          mimeType: "application/pdf",
          blob: file.payload.toString("base64"),
        },
      },
    ];
  return text(
    `"${file.file_name}" (${mime}) não pode ser lido pelo conector. Formatos aceitos: texto, imagens e PDF.`,
  );
}

const MAX_ROWS = 200;

/**
 * Free read-only query for questions no tool anticipated. It runs inside a READ ONLY
 * transaction as the caller (RLS applies), as a subquery so only one SELECT is possible.
 */
export async function freeQuery(query: Query, { sql }: { sql: string }) {
  const statement = sql.trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(statement)) return "Use apenas consultas SELECT.";
  const rows = await query(`select * from (${statement}) as consulta limit ${MAX_ROWS + 1}`, []);
  const json = JSON.stringify(rows.slice(0, MAX_ROWS), null, 1);
  return [
    `${Math.min(rows.length, MAX_ROWS)} linha(s)${rows.length > MAX_ROWS ? ` (limitado a ${MAX_ROWS})` : ""}:`,
    json.length > 60000 ? `${json.slice(0, 60000)}\n… (resultado cortado)` : json,
  ].join("\n");
}

/** Tables and columns the caller can read, for writing freeQuery statements. */
export async function systemStructure(query: Query) {
  const columns = await query<{ table_name: string; columns: string }>(
    `select c.relname as table_name,
            string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum) as columns
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
        and has_column_privilege(c.oid, a.attnum, 'SELECT')
      group by c.relname order by c.relname`,
  );
  return [
    "Tabelas do TaskFlow (schema public). Datas em UTC; o escritório usa America/Sao_Paulo.",
    "Principais: tasks (cards), clients, comments, subtasks, attachments, task_history, client_notes, obligations, calendar_events, profiles (pessoas), workspaces (ambientes), task_statuses, kanban_columns.",
    ...columns.map((c) => `- ${c.table_name}: ${c.columns}`),
  ].join("\n");
}
