import { connectNeon } from "./neon-db.mjs";
const db = await connectNeon();
try {
  console.log(
    "Application tables without RLS:",
    (
      await db.query(
        "select tablename from pg_tables where schemaname='public' and not rowsecurity",
      )
    ).rows,
  );
  console.log(
    "Identity and business counts:",
    (
      await db.query(
        'select (select count(*) from neon_auth."user") users,(select count(*) from public.clients) clients,(select count(*) from public.tasks) tasks',
      )
    ).rows,
  );
} finally {
  await db.end();
}
