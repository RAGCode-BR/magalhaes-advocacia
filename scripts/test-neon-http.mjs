import { connectNeon } from "./neon-db.mjs";
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
  await db.query(
    "insert into public.access_invitations(email,expires_at) values($1,now()+interval '10 minutes')",
    [email],
  );
  const signup = await request(auth + "/sign-up/email", {
    email,
    password,
    name: "Validação descartável",
  });
  userId = signup.user?.id;
  if (!userId) throw Error("Signup não retornou identidade");
  // Only the disposable test identity is confirmed here. Real users must enter their email OTP.
  await db.query('update neon_auth."user" set "emailVerified"=true where id=$1 and email=$2', [
    userId,
    email,
  ]);
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
  console.log(
    "PASS HTTP: Neon Auth, token, ambiente, cadastro e leitura de cliente e tarefa pelo mesmo endpoint do site.",
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
