import { describe, expect, it } from "vitest";
import type { Query } from "./db.ts";
import { neonServiceUrls } from "./neon-data.ts";
import { listCards, listWorkspaces } from "./tools.ts";

const NEON_URL = "https://ep-test-123.c-6.us-east-2.aws.neon.tech/magalhaes";

/** Answers by the first table named after FROM; records every statement. */
function fakeQuery(rows: Record<string, unknown[]>) {
  const calls: { text: string; params: unknown[] }[] = [];
  const query = (async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    const table = text.match(/from public\.(\w+)/i)?.[1] ?? "";
    return rows[table] ?? [];
  }) as Query;
  return { query, calls };
}

describe("neonServiceUrls", () => {
  it("derives the auth issuer like the browser client", () => {
    expect(neonServiceUrls(NEON_URL).auth).toBe(
      "https://ep-test-123.neonauth.c-6.us-east-2.aws.neon.tech/magalhaes/auth",
    );
  });
});

describe("listWorkspaces", () => {
  it("lists only the environments RLS returns for this user", async () => {
    const { query } = fakeQuery({
      workspaces: [{ id: "w1", slug: "consultoria", name: "Consultoria" }],
    });
    const text = await listWorkspaces(query);
    expect(text).toContain("Consultoria");
    expect(text).not.toContain("Marketing");
  });

  it("explains when the user belongs to no environment", async () => {
    expect(await listWorkspaces(fakeQuery({}).query)).toMatch(/nenhum ambiente/);
  });
});

describe("listCards", () => {
  it("refuses an environment the user cannot see", async () => {
    const { query, calls } = fakeQuery({});
    const text = await listCards(query, { ambiente: "marketing" });
    expect(text).toMatch(/não tem acesso/);
    expect(calls).toHaveLength(1);
  });

  it("lists open cards of the chosen environment with parameters, not string concatenation", async () => {
    const { query, calls } = fakeQuery({
      workspaces: [{ id: "w1", slug: "consultoria", name: "Consultoria" }],
      tasks: [
        {
          id: "t1",
          title: "Revisar contrato",
          status: "todo",
          priority: "high",
          due_date: new Date("2026-10-30T15:00:00Z"),
          cliente: "Cliente Exemplo",
        },
      ],
    });
    const text = await listCards(query, { ambiente: "consultoria", limite: 5 });
    expect(calls[0].params).toEqual(["consultoria"]);
    expect(calls[1].params).toEqual(["w1", false, 5]);
    expect(calls[1].text).toMatch(/deleted_at is null/i);
    expect(calls[1].text).toMatch(/archived_at is null/i);
    expect(text).toContain("Revisar contrato");
    expect(text).toContain("cliente: Cliente Exemplo");
    expect(text).toContain("prioridade alta");
    expect(text).toContain("prazo 30/10/2026");
  });

  it("includes completed cards only when asked", async () => {
    const { query, calls } = fakeQuery({
      workspaces: [{ id: "w1", slug: "consultoria", name: "Consultoria" }],
    });
    const text = await listCards(query, { ambiente: "consultoria", incluir_concluidos: true });
    expect(calls[1].params).toEqual(["w1", true, 20]);
    expect(text).toMatch(/Nenhum card/);
  });
});
