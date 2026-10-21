import { connectNeon } from "./neon-db.mjs";
import { hashPassword } from "@better-auth/utils/password";
import { readFileSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
const auth =
  "https://ep-weathered-hat-b4vy9dtp.neonauth.c-6.us-east-2.aws.neon.tech/magalhaes/auth";
const api =
  "https://ep-weathered-hat-b4vy9dtp.apirest.c-6.us-east-2.aws.neon.tech/magalhaes/rest/v1";
const db = await connectNeon(),
  email = `validation-${randomUUID()}@example.invalid`,
  password = randomBytes(24).toString("base64url");
let userId,
  clientId,
  taskId,
  cookies = "";
async function request(url, body, token) {
  const r = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://ragcode-br.github.io",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (url.startsWith(auth) && r.headers.getSetCookie().length)
    cookies = r.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw Error(`HTTP ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}
try {
  const access = readFileSync("ACESSO-ONLINE.local", "utf8");
  const adminSignin = await request(auth + "/sign-in/email", {
    email: access.match(/^E-mail: (.+)$/m)[1],
    password: access.match(/^Senha temporária: (.+)$/m)[1],
  });
  const adminSession = await fetch(auth + "/get-session", {
    headers: { Cookie: cookies, Origin: "https://ragcode-br.github.io" },
  });
  const adminToken = adminSession.headers.get("set-auth-jwt");
  if (!adminToken) throw Error("Administrador sem sessão");
  const created = await request(
    api + "/rpc/neon_admin_access",
    {
      action: "create",
      data: {
        fullName: "Validação descartável",
        email,
        role: "collaborator",
        permissions: ["tasks", "clients"],
        passwordHash: await hashPassword(password),
      },
    },
    adminToken,
  );
  userId = created.userId;
  if (!userId) throw Error("Conta não criada pelo administrador");
  const signin = await request(auth + "/sign-in/email", { email, password });
  if (!signin.token) throw Error("Login não retornou token");
  const tokenResponse = await fetch(auth + "/token", {
    headers: { Cookie: cookies, Origin: "https://ragcode-br.github.io" },
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenBody.token)
    throw Error("Emissão de JWT falhou: " + tokenResponse.status);
  const sessionResponse = await fetch(auth + "/get-session", {
    headers: { Cookie: cookies, Origin: "https://ragcode-br.github.io" },
  });
  if (!sessionResponse.ok || !sessionResponse.headers.get("set-auth-jwt"))
    throw Error("Neon não forneceu o JWT de sessão esperado pelo SDK do navegador");
  const token = sessionResponse.headers.get("set-auth-jwt");
  const identityChecks = await Promise.all(
    Array.from({ length: 16 }, async () => {
      const rows = await request(api + "/user_roles?select=user_id,role", null, token);
      if (rows.length !== 1 || rows[0].user_id !== userId || rows[0].role !== "collaborator")
        throw Error("Identidade incorreta ou acesso a papéis de outro usuário");
    }),
  );
  const memberships = await request(
    api + "/workspace_memberships?select=workspace_id",
    null,
    token,
  );
  if (!memberships.length) throw Error("Usuário sem ambiente");
  const client = await request(
    api + "/clients",
    {
      name: "Validação HTTP descartável",
      created_by: userId,
      workspace_id: memberships[0].workspace_id,
    },
    token,
  );
  const clients = await request(
    api + "/clients?select=id&name=eq.Valida%C3%A7%C3%A3o%20HTTP%20descart%C3%A1vel",
    null,
    token,
  );
  clientId = clients[0]?.id;
  if (!clientId) throw Error("Cliente não persistiu");
  await request(
    api + "/tasks",
    {
      title: "Validação HTTP descartável",
      client_id: clientId,
      created_by: userId,
      workspace_id: memberships[0].workspace_id,
    },
    token,
  );
  const tasks = await request(api + "/tasks?select=id&client_id=eq." + clientId, null, token);
  taskId = tasks[0]?.id;
  if (!taskId) throw Error("Tarefa não persistiu");
  const beforeChangeCookies = cookies;
  const invalidChange = await fetch(auth + "/change-password", {
    method: "POST",
    headers: {
      Cookie: cookies,
      Origin: "https://ragcode-br.github.io",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      currentPassword: "Wrong-current-password!",
      newPassword: "Should-not-be-applied!",
      revokeOtherSessions: true,
    }),
  });
  if (invalidChange.ok) throw Error("Troca de senha sem comprovar a senha atual");
  const newPassword = randomBytes(24).toString("base64url");
  const change = await fetch(auth + "/change-password", {
    method: "POST",
    headers: {
      Cookie: beforeChangeCookies,
      Origin: "https://ragcode-br.github.io",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ currentPassword: password, newPassword, revokeOtherSessions: true }),
  });
  if (!change.ok)
    throw Error(
      "Troca da própria senha falhou: " + change.status + " " + (await change.text()).slice(0, 200),
    );
  const oldLogin = await fetch(auth + "/sign-in/email", {
    method: "POST",
    headers: { Origin: "https://ragcode-br.github.io", "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (oldLogin.ok) throw Error("Senha antiga continuou sendo aceita");
  await request(auth + "/sign-in/email", { email, password: newPassword });
  const unauthorized = await fetch(api + "/rpc/neon_admin_access", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", data: { email: "denied@example.invalid" } }),
  });
  if (unauthorized.ok) throw Error("Colaborador criou acessos");
  const duplicate = await fetch(api + "/rpc/neon_admin_access", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "create",
      data: {
        fullName: "Duplicado",
        email,
        role: "collaborator",
        passwordHash: await hashPassword(password),
      },
    }),
  });
  if (duplicate.ok) throw Error("E-mail duplicado aceito");
  const pending = await db.query(
    "select settings ? 'password' or settings ? 'passwordHash' leaked from magalhaes_private.pending_access where email=$1",
    [email],
  );
  if (pending.rowCount) throw Error("Criação deixou convite pendente");
  console.log(
    "PASS HTTP: administrador criou login e senha; usuário entrou, acessou CRUD, mudou a própria senha e entrou com a nova. Senha antiga, e-mail duplicado e criação por colaborador foram rejeitados.",
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  if (!userId)
    userId = (await db.query('select id from neon_auth."user" where email=$1', [email])).rows[0]
      ?.id;
  await db.query("BEGIN");
  if (userId) {
    await db.query("delete from public.tasks where created_by=$1", [userId]);
    await db.query("delete from public.clients where created_by=$1", [userId]);
    await db.query('delete from neon_auth."user" where id=$1 and email=$2', [userId, email]);
  }
  await db.query("delete from public.access_invitations where email=$1", [email]);
  await db.query("COMMIT");
  await db.end();
  console.log("Identidade e registros descartáveis removidos.");
}
