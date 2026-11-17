// Refresh metadata after a migration without changing schemas or permissions.
// First authenticate/refresh the CLI session with: npx neonctl me
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
const values = Object.fromEntries(
  (await readFile(".env.neon.local", "utf8"))
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
if (
  values.NEON_PROJECT_ID !== "dawn-term-03972586" ||
  !/^br-[a-z0-9-]+$/.test(values.NEON_BRANCH_ID)
)
  throw new Error("Projeto Neon da Magalhães não confirmado.");
const credentials = JSON.parse(
  await readFile(join(homedir(), ".config/neon/credentials.json"), "utf8"),
);
const url = `https://console.neon.tech/api/v2/projects/${values.NEON_PROJECT_ID}/branches/${values.NEON_BRANCH_ID}/data-api/magalhaes`;
const headers = {
  Authorization: `Bearer ${credentials.access_token}`,
  "Content-Type": "application/json",
};
const before = await fetch(url, { headers });
if (!before.ok)
  throw new Error(`Neon HTTP ${before.status}. Atualize a sessão com npx neonctl me.`);
const response = await fetch(url, { method: "PATCH", headers, body: "{}" });
if (!response.ok) throw new Error(`Não foi possível atualizar o cache: HTTP ${response.status}.`);
console.log("Cache da Data API Magalhães atualizado; nenhuma configuração de acesso alterada.");
