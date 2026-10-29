import { describe, expect, it } from "vitest";
import { asUser, connectorDrift, type PoolLike } from "./db.ts";

const USER = "6f1c2d3e-0000-4000-8000-000000000001";

function fakePool(fail?: RegExp) {
  const statements: { text: string; params?: unknown[] }[] = [];
  let released = false;
  const pool: PoolLike = {
    async connect() {
      return {
        async query(text: string, params?: unknown[]) {
          statements.push({ text, params });
          if (fail?.test(text)) throw new Error("falhou");
          return { rows: [{ ok: 1 }] };
        },
        release() {
          released = true;
        },
      };
    },
    async query() {
      return { rows: [{ missing: 2 }] };
    },
  };
  return { pool, statements, released: () => released };
}

describe("asUser", () => {
  it("runs inside a transaction as the connector role with the caller's identity", async () => {
    const { pool, statements, released } = fakePool();
    const rows = await asUser(pool, USER, (query) => query("select 1"));
    expect(rows).toEqual([{ ok: 1 }]);
    expect(statements.map((s) => s.text)).toEqual([
      "begin",
      "set local statement_timeout = '15s'",
      "set local role taskflow_mcp_user",
      "select set_config('request.jwt.claims', $1, true)",
      "select 1",
      "commit",
    ]);
    expect(JSON.parse(statements[3].params![0] as string)).toEqual({
      sub: USER,
      role: "authenticated",
    });
    expect(released()).toBe(true);
  });

  it("opens read-only transactions for reads", async () => {
    const { pool, statements } = fakePool();
    await asUser(pool, USER, (query) => query("select 1"), { readOnly: true });
    expect(statements[0].text).toBe("begin read only");
  });

  it("rolls back and releases the connection when a query fails", async () => {
    const { pool, statements, released } = fakePool(/select 1/);
    await expect(asUser(pool, USER, (query) => query("select 1"))).rejects.toThrow("falhou");
    expect(statements.at(-1)!.text).toBe("rollback");
    expect(released()).toBe(true);
  });

  it("never opens a connection without a valid user id", async () => {
    const { pool, statements } = fakePool();
    await expect(asUser(pool, "' or 1=1 --", (query) => query("select 1"))).rejects.toThrow(
      /usuário/,
    );
    expect(statements).toHaveLength(0);
  });
});

describe("connectorDrift", () => {
  it("reports every privilege or policy difference from authenticated", async () => {
    expect(await connectorDrift(fakePool().pool)).toBe(2);
  });
});
