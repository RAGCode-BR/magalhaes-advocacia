/**
 * Database access as one verified user. The login `taskflow_mcp` can only become
 * `taskflow_mcp_user` (see neon/mcp-role.sql), which shares every RLS policy with the app's
 * `authenticated` role; neon_uid() reads the caller from request.jwt.claims, as in the app.
 */
export type Query = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

type ClientLike = {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
};
export type PoolLike = {
  connect(): Promise<ClientLike>;
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function asUser<T>(
  pool: PoolLike,
  userId: string,
  work: (query: Query) => Promise<T>,
  { readOnly = false } = {},
): Promise<T> {
  if (!UUID.test(userId)) throw new Error("Token sem usuário identificado.");
  const client = await pool.connect();
  try {
    // Reads cannot write even through a volatile function, and never hold the pool for long.
    await client.query(readOnly ? "begin read only" : "begin");
    await client.query("set local statement_timeout = '15s'");
    await client.query("set local role taskflow_mcp_user");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const query: Query = async <R>(text: string, params?: unknown[]) =>
      (await client.query(text, params)).rows as R[];
    const result = await work(query);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Policies or grants added after neon/mcp-role.sql ran hide data from the connector (fail closed)
 * until it runs again; this counts every difference from `authenticated`.
 */
export async function connectorDrift(pool: PoolLike) {
  const { rows } = await pool.query(DRIFT_SQL);
  return Number(rows[0].missing);
}

const DRIFT_SQL = `
select (
  (select count(*) from pg_policies
    where 'authenticated' = any(roles) and not 'taskflow_mcp_user' = any(roles))
  + (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace,
       unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
     where n.nspname in ('public','storage') and c.relkind in ('r','p','v')
       and has_table_privilege('authenticated', c.oid, p)
        <> has_table_privilege('taskflow_mcp_user', c.oid, p))
  + (select count(*) from pg_attribute a join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace, unnest(array['SELECT','INSERT','UPDATE']) p
     where n.nspname in ('public','storage') and c.relkind in ('r','p','v')
       and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('authenticated', c.oid, a.attnum, p)
        <> has_column_privilege('taskflow_mcp_user', c.oid, a.attnum, p))
  + (select count(*) from pg_proc f join pg_namespace n on n.oid = f.pronamespace
     where n.nspname in ('public','storage')
       and has_function_privilege('authenticated', f.oid, 'EXECUTE')
        <> has_function_privilege('taskflow_mcp_user', f.oid, 'EXECUTE'))
)::int as missing`;
