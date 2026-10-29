// The TaskFlow tools, shared by the local Node server (server.ts) and the
// Cloudflare Worker (worker.ts) so both expose exactly the same connector.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addSubtask, commentCard, createCard, setSubtaskDone, updateCard } from "./actions.ts";
import { asUser, type PoolLike, type Query } from "./db.ts";
import {
  cardDetails,
  clientSummary,
  freeQuery,
  listCards,
  listWorkspaces,
  readAttachment,
  search,
  systemStructure,
} from "./tools.ts";

const INSTRUCTIONS = `TaskFlow é o sistema de gestão de processos do escritório Magalhães Advocacia.
Tudo roda como a pessoa conectada: você vê e altera apenas o que ela pode no TaskFlow, e as alterações ficam no nome dela.
Para encontrar clientes ou cards use buscar; depois resumo_cliente ou detalhes_card. Para perguntas sem ferramenta própria, consulte estrutura_do_sistema e use consultar (somente leitura).
Antes de criar ou alterar algo, confirme com a pessoa o que será feito. Não existe ferramenta de exclusão.
Datas de prazo são AAAA-MM-DD no fuso America/Sao_Paulo. Responda em português.`;

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "AAAA-MM-DD");
const read = { readOnlyHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

/** One server per request: every tool call runs as the verified caller, under the app's RLS. */
export function newServer(pool: PoolLike) {
  const server = new McpServer(
    { name: "taskflow", version: "0.2.0" },
    { instructions: INSTRUCTIONS },
  );
  type Extra = { authInfo?: { extra?: Record<string, unknown> } };
  const caller = (extra: Extra) => {
    const userId = (extra.authInfo?.extra?.claims as { sub?: string } | undefined)?.sub;
    if (!userId) throw new Error("Sessão ausente. Conecte o TaskFlow novamente.");
    return userId;
  };
  const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
  const reading = (extra: Extra, work: (query: Query) => Promise<string>) =>
    asUser(pool, caller(extra), work, { readOnly: true }).then(text);
  const writing = (extra: Extra, work: (query: Query, userId: string) => Promise<string>) => {
    const userId = caller(extra);
    return asUser(pool, userId, (query) => work(query, userId)).then(text);
  };

  server.registerTool(
    "meus_ambientes",
    {
      title: "Meus ambientes",
      description: "Lista os ambientes do TaskFlow que a pessoa conectada pode acessar.",
      annotations: read,
    },
    async (extra) => reading(extra, listWorkspaces),
  );

  server.registerTool(
    "listar_cards",
    {
      title: "Listar cards",
      description: "Lista cards abertos de um ambiente, ordenados por prazo.",
      inputSchema: {
        ambiente: z.enum(["marketing", "consultoria"]),
        limite: z.number().int().min(1).max(50).optional(),
        incluir_concluidos: z.boolean().optional(),
      },
      annotations: read,
    },
    async (args, extra) => reading(extra, (query) => listCards(query, args)),
  );

  server.registerTool(
    "buscar",
    {
      title: "Buscar",
      description:
        "Procura clientes (nome, razão social, CNPJ) e cards (título, descrição) e devolve os ids.",
      inputSchema: { termo: z.string().min(2) },
      annotations: read,
    },
    async (args, extra) => reading(extra, (query) => search(query, args)),
  );

  server.registerTool(
    "resumo_cliente",
    {
      title: "Resumo do cliente",
      description:
        "Dados do cliente, cards (abertos, atrasados, concluídos), comentários recentes, anotações e arquivos. Aceita nome ou id.",
      inputSchema: { cliente: z.string().min(2) },
      annotations: read,
    },
    async (args, extra) => reading(extra, (query) => clientSummary(query, args)),
  );

  server.registerTool(
    "detalhes_card",
    {
      title: "Detalhes do card",
      description: "Um card completo: descrição, subtarefas, conversa, arquivos e histórico.",
      inputSchema: { card_id: uuid },
      annotations: read,
    },
    async (args, extra) => reading(extra, (query) => cardDetails(query, args)),
  );

  server.registerTool(
    "ler_anexo",
    {
      title: "Ler anexo",
      description:
        "Abre um arquivo anexado a um card e devolve o conteúdo: PDF, Word, Excel, PowerPoint, OpenDocument, mapas KMZ/KML (pontos, vértices e área em hectares), RTF, HTML, e-mail, texto e imagens JPG/PNG/GIF/WebP (até 8 MB). Use os ids de anexo de detalhes_card ou resumo_cliente.",
      inputSchema: { anexo_id: uuid },
      annotations: read,
    },
    async (args, extra) => ({
      content: await asUser(pool, caller(extra), (query) => readAttachment(query, args), {
        readOnly: true,
      }),
    }),
  );

  server.registerTool(
    "estrutura_do_sistema",
    {
      title: "Estrutura do sistema",
      description: "Tabelas e colunas que a pessoa pode ler, para escrever consultas.",
      annotations: read,
    },
    async (extra) => reading(extra, systemStructure),
  );

  server.registerTool(
    "consultar",
    {
      title: "Consultar dados",
      description:
        "Executa um único SELECT somente leitura sobre o TaskFlow (até 200 linhas), com as permissões da pessoa. Use para perguntas que as outras ferramentas não cobrem.",
      inputSchema: { sql: z.string().min(8) },
      annotations: read,
    },
    async (args, extra) => reading(extra, (query) => freeQuery(query, args)),
  );

  server.registerTool(
    "criar_card",
    {
      title: "Criar card",
      description:
        "Cria um card em nome da pessoa. Confirme título, prazo, cliente e responsável antes.",
      inputSchema: {
        titulo: z.string().min(2),
        prazo: date,
        descricao: z.string().optional(),
        cliente_id: uuid.optional(),
        responsavel_id: uuid.optional(),
        prioridade: z.enum(["low", "medium", "high", "urgent"]).optional(),
        ambiente: z.enum(["marketing", "consultoria"]).optional(),
      },
      annotations: write,
    },
    async (args, extra) => writing(extra, (query, userId) => createCard(query, userId, args)),
  );

  server.registerTool(
    "atualizar_card",
    {
      title: "Atualizar card",
      description:
        "Altera título, descrição, prazo, prioridade, status, responsável ou cliente de um card. Mostre o que vai mudar antes.",
      inputSchema: {
        card_id: uuid,
        titulo: z.string().min(2).optional(),
        descricao: z.string().optional(),
        prazo: date.optional(),
        prioridade: z.enum(["low", "medium", "high", "urgent"]).optional(),
        status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
        responsavel_id: uuid.optional(),
        cliente_id: uuid.optional(),
      },
      annotations: { ...write, destructiveHint: true },
    },
    async (args, extra) => writing(extra, (query, userId) => updateCard(query, userId, args)),
  );

  server.registerTool(
    "comentar_card",
    {
      title: "Comentar no card",
      description: "Publica um comentário na conversa do card, em nome da pessoa.",
      inputSchema: { card_id: uuid, texto: z.string().min(1) },
      annotations: write,
    },
    async (args, extra) => writing(extra, (query, userId) => commentCard(query, userId, args)),
  );

  server.registerTool(
    "criar_subtarefa",
    {
      title: "Criar subtarefa",
      description: "Adiciona uma subtarefa a um card.",
      inputSchema: {
        card_id: uuid,
        titulo: z.string().min(2),
        prazo: date.optional(),
        responsavel_id: uuid.optional(),
      },
      annotations: write,
    },
    async (args, extra) => writing(extra, (query) => addSubtask(query, args)),
  );

  server.registerTool(
    "concluir_subtarefa",
    {
      title: "Concluir subtarefa",
      description: "Marca uma subtarefa como concluída, ou reabre com concluida=false.",
      inputSchema: { subtarefa_id: uuid, concluida: z.boolean().optional() },
      annotations: write,
    },
    async (args, extra) => writing(extra, (query) => setSubtaskDone(query, args)),
  );

  return server;
}

