import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const cli = "./node_modules/.bin/supabase";
const projectId = "magalhaes-advocacia";
const adminEmail = "admin@magalhaes.local";
const accessFile = "ACESSO-LOCAL.local";
const envFile = ".env.development.local";
if (!readFileSync("supabase/config.toml", "utf8").includes(`project_id = "${projectId}"`))
  throw new Error("O projeto local não é o da Magalhães. Nenhuma alteração foi feita.");
const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
  encoding: "utf8",
});
if (docker.status !== 0)
  throw new Error("Abra o Docker Desktop, aguarde iniciar e execute npm run local novamente.");
console.log("Iniciando o banco exclusivo da Magalhães (dados persistem entre sessões)...");
const start = spawnSync(cli, ["start", "-x", "imgproxy,logflare,vector,supavisor"], {
  encoding: "utf8",
  maxBuffer: 24 * 1024 * 1024,
});
if (start.status !== 0) {
  console.error(start.stderr);
  throw new Error("Não foi possível iniciar o banco local. Os dados existentes foram preservados.");
}
const result = spawnSync(cli, ["status", "-o", "json"], { encoding: "utf8" });
if (result.status !== 0) throw new Error("Não foi possível ler a configuração local.");
const settings = JSON.parse(result.stdout);
const apiUrl = settings.API_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):55441$/.test(apiUrl))
  throw new Error(
    "Endereço inesperado. A configuração precisa apontar somente para o banco local da Magalhães.",
  );
const publicKey = settings.ANON_KEY || settings.PUBLISHABLE_KEY;
const secretKey = settings.SERVICE_ROLE_KEY || settings.SECRET_KEY;
const admin = createClient(apiUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: users, error: usersError } = await admin.auth.admin.listUsers();
if (usersError) throw usersError;
let user = users.users.find((user) => user.email === adminEmail);
if (!user) {
  const { error: invitationError } = await admin
    .from("access_invitations")
    .upsert({ email: adminEmail, expires_at: new Date(Date.now() + 3600000).toISOString() });
  if (invitationError) throw invitationError;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(adminEmail, {
    data: { full_name: "Administrador local Magalhães" },
  });
  if (error) throw error;
  user = data.user;
  const password = `Magalhaes-${randomBytes(12).toString("base64url")}!`;
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
  });
  if (updateError) throw updateError;
  writeFileSync(
    accessFile,
    `ACESSO EXCLUSIVO DE TESTES LOCAIS — MAGALHÃES ADVOCACIA\n\nEndereço: http://localhost:5180/magalhaes-advocacia/\nE-mail: ${adminEmail}\nSenha: ${password}\n\nEstes dados não são usados no site público nem no banco da consultoria.\nBanco e arquivos são mantidos nos volumes Docker deste projeto.\nNão execute db reset nem stop --no-backup para reiniciar: esses comandos apagam dados.\n`,
    { mode: 0o600 },
  );
  chmodSync(accessFile, 0o600);
  console.log(
    "Administrador local criado. Credenciais no arquivo ACESSO-LOCAL.local (não enviado ao GitHub).",
  );
} else if (!existsSync(accessFile)) {
  console.log(
    "O administrador local já existe. Use a senha definida anteriormente; ela não foi alterada.",
  );
}
const { data: roles, error: roleError } = await admin
  .from("user_roles")
  .select("role")
  .eq("user_id", user.id);
if (roleError) throw roleError;
if (!roles.some((role) => role.role === "admin")) {
  const sql = readFileSync("supabase/bootstrap-admin.sql", "utf8").replace(
    "admin_email text := 'SUBSTITUA_PELO_EMAIL_DO_ADMINISTRADOR'",
    `admin_email text := '${adminEmail}'`,
  );
  const bootstrap = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      `supabase_db_${projectId}`,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: sql, encoding: "utf8" },
  );
  if (bootstrap.status !== 0) throw new Error(bootstrap.stderr);
}
// Esta configuração só entra em desenvolvimento. Builds públicos não recebem o endereço local.
writeFileSync(
  envFile,
  `# Banco exclusivo neste Mac; nunca usar em publicação.\nVITE_SUPABASE_URL=${apiUrl}\nVITE_SUPABASE_PUBLISHABLE_KEY=${publicKey}\n`,
);
if (!existsSync(".env.functions.local"))
  writeFileSync(
    ".env.functions.local",
    `INVITE_REDIRECT_URL=http://localhost:5180/magalhaes-advocacia/auth?invite=1\nTASKFLOW_APP_URL=http://localhost:5180/magalhaes-advocacia/\n`,
    { mode: 0o600 },
  );
console.log(
  "Banco pronto: http://127.0.0.1:55441 | Painel: http://127.0.0.1:55443 | Convites de teste: http://127.0.0.1:55444",
);
