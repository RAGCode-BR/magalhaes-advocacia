import { build } from "esbuild";
import { readFileSync, unlinkSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { connectNeon } from "./neon-db.mjs";

// Exercise the actual browser task client, not a hand-written REST substitute.
const outfile = "scripts/task-client-runtime.local.mjs";
await build({
  entryPoints: ["src/integrations/authenticated-client.ts"],
  outfile,
  bundle: true,
  packages: "external",
  format: "esm",
  platform: "node",
  define: {
    "import.meta.env.VITE_NEON_URL": JSON.stringify(
      "https://ep-weathered-hat-b4vy9dtp.c-6.us-east-2.aws.neon.tech/magalhaes",
    ),
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("http://127.0.0.1:55441"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("legacy-local-key"),
  },
});
const { createAuthenticatedDataClient } = await import(
  pathToFileURL(process.cwd() + "/" + outfile)
);
const auth =
  "https://ep-weathered-hat-b4vy9dtp.neonauth.c-6.us-east-2.aws.neon.tech/magalhaes/auth";
async function login(email, password) {
  const response = await fetch(auth + "/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://ragcode-br.github.io" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw Error("Login de validação falhou: " + response.status);
  const cookies = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const session = await fetch(auth + "/get-session", {
    headers: { Cookie: cookies, Origin: "https://ragcode-br.github.io" },
  });
  const token = session.headers.get("set-auth-jwt");
  if (!token) throw Error("JWT não recebido");
  return createAuthenticatedDataClient(token);
}
function ok(result, label) {
  if (result.error) throw Error(label + ": " + result.error.message);
  return result.data;
}
const access = readFileSync("ACESSO-ONLINE.local", "utf8");
const admin = await login(
  access.match(/^E-mail: (.+)$/m)[1],
  access.match(/^Senha temporária: (.+)$/m)[1],
);
const email = `task-validation-${randomUUID()}@example.invalid`,
  password = randomBytes(20).toString("base64url"),
  taskId = randomUUID(),
  filePath = `validation/${randomUUID()}.txt`;
const db = await connectNeon();
let userId;
try {
  const created = ok(
    await admin.functions.invoke("admin-user-access", {
      body: {
        action: "create",
        data: {
          fullName: "Responsável descartável",
          email,
          password,
          role: "collaborator",
          permissions: ["tasks", "clients", "mural"],
        },
      },
    }),
    "criar responsável",
  );
  userId = created.userId;
  const collaborator = await login(email, password);
  const workspace = ok(await admin.rpc("current_workspace_id"), "ambiente");
  const columns = ok(
    await admin
      .from("kanban_columns")
      .select("id")
      .eq("workspace_id", workspace)
      .order("position")
      .limit(1),
    "colunas",
  );
  const statuses = ok(
    await admin
      .from("task_statuses")
      .select("id")
      .eq("workspace_id", workspace)
      .eq("is_completed", false)
      .order("position")
      .limit(1),
    "status",
  );
  const {
    data: { user },
  } = await (async () => {
    const row = await db.query('select id from neon_auth."user" where email=$1', [
      access.match(/^E-mail: (.+)$/m)[1],
    ]);
    return { data: { user: row.rows[0] } };
  })();
  ok(
    await admin
      .from("tasks")
      .insert({
        id: taskId,
        title: "Validação de tarefa atribuída",
        assignee_id: userId,
        created_by: user.id,
        workspace_id: workspace,
        column_id: columns[0].id,
        status_id: statuses[0].id,
        status: "todo",
        is_draft: true,
        due_date: "2026-10-22T15:00:00.000Z",
      }),
    "rascunho",
  );
  ok(await admin.from("tasks").update({ is_draft: false }).eq("id", taskId), "publicar tarefa");
  const visible = ok(
    await collaborator.from("tasks").select("id,assignee_id").eq("id", taskId).single(),
    "responsável lê tarefa",
  );
  if (visible.assignee_id !== userId) throw Error("Responsável não persistido");
  const subtask = ok(
    await collaborator
      .from("subtasks")
      .insert({ task_id: taskId, title: "Etapa de validação", assignee_id: userId })
      .select("id")
      .single(),
    "subtarefa",
  );
  ok(
    await collaborator.from("subtasks").update({ done: true }).eq("id", subtask.id),
    "concluir subtarefa",
  );
  ok(
    await collaborator
      .from("comments")
      .insert({ task_id: taskId, author_id: userId, body: "Comentário de validação" }),
    "comentário",
  );
  ok(
    await admin.rpc("neon_file_upload", {
      bucket: "task-attachments",
      path: filePath,
      content: Buffer.from("Arquivo privado de validação").toString("base64"),
      mime: "text/plain",
      overwrite: false,
    }),
    "upload privado",
  );
  ok(
    await admin
      .from("attachments")
      .insert({
        task_id: taskId,
        file_name: "validacao.txt",
        storage_path: filePath,
        uploaded_by: user.id,
      }),
    "vincular anexo",
  );
  const file = ok(
    await collaborator.storage.from("task-attachments").download(filePath),
    "responsável baixa anexo",
  );
  if ((await file.text()) !== "Arquivo privado de validação") throw Error("Arquivo divergiu");
  const edited = ok(
    await collaborator
      .from("tasks")
      .update({ description: "Atualização do responsável" })
      .eq("id", taskId)
      .select("id,description")
      .single(),
    "editar tarefa",
  );
  if (edited.description !== "Atualização do responsável") throw Error("Edição não persistiu");
  console.log(
    "PASS: cliente real do app com Neon (mesmo com configuração Supabase presente); rascunho, atribuição, leitura pelo responsável, subtarefa, comentário, anexo privado e edição.",
  );
} finally {
  await db.query("BEGIN");
  await db.query("delete from public.tasks where id=$1", [taskId]);
  await db.query("delete from storage.objects where bucket_id='task-attachments' and name=$1", [
    filePath,
  ]);
  if (userId)
    await db.query('delete from neon_auth."user" where id=$1 and email=$2', [userId, email]);
  await db.query("COMMIT");
  await db.end();
  unlinkSync(outfile);
  console.log("Registros descartáveis removidos.");
}
