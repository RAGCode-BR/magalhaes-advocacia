import { readFileSync } from "node:fs";
import pg from "pg";
export async function connectNeon() {
  const connectionString = readFileSync(".env.neon.local", "utf8").match(
    /^NEON_DATABASE_URL=(.+)$/m,
  )?.[1];
  const url = new URL(connectionString);
  if (
    url.hostname !== "ep-weathered-hat-b4vy9dtp-pooler.c-6.us-east-2.aws.neon.tech" ||
    url.pathname !== "/magalhaes"
  )
    throw Error("Destino Neon não autorizado");
  url.searchParams.set("sslmode", "verify-full");
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  await db.query("SET row_security = on");
  return db;
}
