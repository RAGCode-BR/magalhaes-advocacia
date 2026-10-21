import { build } from "esbuild";
import { readFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { connectNeon } from "./neon-db.mjs";
const outfile = "scripts/client-regression-runtime.local.mjs";
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
    "import.meta.env.VITE_SUPABASE_URL": "undefined",
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": "undefined",
  },
});
const { createAuthenticatedDataClient } = await import(
  pathToFileURL(process.cwd() + "/" + outfile)
);
const access = readFileSync("ACESSO-ONLINE.local", "utf8");
const auth =
  "https://ep-weathered-hat-b4vy9dtp.neonauth.c-6.us-east-2.aws.neon.tech/magalhaes/auth";
const login = await fetch(auth + "/sign-in/email", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://ragcode-br.github.io" },
  body: JSON.stringify({
    email: access.match(/^E-mail: (.+)$/m)[1],
    password: access.match(/^Senha temporária: (.+)$/m)[1],
  }),
});
if (!login.ok) throw Error("Falha no login de validação");
const cookies = login.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
const session = await fetch(auth + "/get-session", {
  headers: { Cookie: cookies, Origin: "https://ragcode-br.github.io" },
});
const token = session.headers.get("set-auth-jwt");
if (!token) throw Error("JWT ausente");
const client = createAuthenticatedDataClient(token),
  id = randomUUID(),
  name = `Validação cliente único ${randomUUID()}`;
const db = await connectNeon();
const ok = (r, label) => {
  if (r.error) throw Error(label + ": " + r.error.message);
  return r.data;
};
try {
  const uid = ok(await client.rpc("neon_uid"), "identidade");
  const saved = ok(
    await client
      .from("clients")
      .insert({ id, name, trade_name: name, created_by: uid })
      .select("*")
      .single(),
    "criar cliente",
  );
  if (saved.id !== id) throw Error("Identificador divergente");
  const rows = ok(await client.from("clients").select("id").eq("name", name), "reler cadastro");
  if (rows.length !== 1 || rows[0].id !== id) throw Error("Cadastro duplicado pelo banco");
  ok(
    await client.from("clients").update({ description: "Cliente editado" }).eq("id", id),
    "editar cliente",
  );
  const count = (
    await db.query("select count(*) n from public.clients where id=$1 or source_client_id=$1", [id])
  ).rows[0].n;
  if (count !== "1") throw Error("Edição voltou a criar espelho");
  ok(await client.from("clients").update({ is_active: false }).eq("id", id), "arquivar cliente");
  ok(await client.from("clients").update({ is_active: true }).eq("id", id), "restaurar cliente");
  const restored = ok(
    await client.from("clients").select("id,is_active").eq("name", name),
    "reler cliente restaurado",
  );
  if (restored.length !== 1 || !restored[0].is_active)
    throw Error("Cliente não restaurado de forma única");
  console.log(
    "PASS: criação via cliente real do app grava exatamente uma linha; editar, arquivar e restaurar não geram cópias.",
  );
} finally {
  await db.query("delete from public.clients where id=$1 or source_client_id=$1", [id]);
  await db.end();
  unlinkSync(outfile);
  console.log("Cadastro descartável removido.");
}
