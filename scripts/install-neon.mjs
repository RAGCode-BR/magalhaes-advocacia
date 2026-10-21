import { readFileSync } from "node:fs";
import { connectNeon } from "./neon-db.mjs";
const db = await connectNeon();
try {
  await db.query("BEGIN");
  const exists = await db.query("select to_regclass('public.profiles') present");
  if (exists.rows[0].present) throw Error("Banco já instalado; use uma migração incremental.");
  let schema = readFileSync("neon/schema.sql", "utf8")
    .replace(/^\\(?:un)?restrict.*$/gm, "")
    .replace("CREATE SCHEMA public;", "CREATE SCHEMA IF NOT EXISTS public;")
    .replaceAll("auth.users", 'neon_auth."user"');
  await db.query(schema);
  for (const file of [
    "access",
    "files",
    "file-download-chunks",
    "users",
    "identity",
    "hardening",
    "defaults",
    "password-login",
    "direct-users",
    "additional-admins",
    "no-client-mirror",
  ])
    await db.query(readFileSync(`neon/${file}.sql`, "utf8"));
  const email = readFileSync(".env.neon.local", "utf8").match(
    /^NEON_BOOTSTRAP_ADMIN_EMAIL=(.+)$/m,
  )?.[1];
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw Error("Configure NEON_BOOTSTRAP_ADMIN_EMAIL no arquivo privado.");
  await db.query("INSERT INTO magalhaes_private.bootstrap_admin(email) VALUES($1)", [
    email.toLowerCase(),
  ]);
  await db.query("SET row_security = on");
  await db.query("COMMIT");
  console.log("Estrutura independente e acesso restrito instalados no Neon Magalhães.");
} catch (error) {
  await db.query("ROLLBACK");
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
