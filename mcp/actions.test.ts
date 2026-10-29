import { describe, expect, it } from "vitest";
import { commentCard, createCard, deadline, setSubtaskDone, updateCard } from "./actions.ts";
import type { Query } from "./db.ts";
import { freeQuery, readAttachment } from "./tools.ts";

const USER = "6f1c2d3e-0000-4000-8000-000000000001";
const CARD = "6f1c2d3e-0000-4000-8000-0000000000aa";

/** Returns rows by the first table touched; records every statement. */
function fakeQuery(rows: Record<string, unknown[]> = {}) {
  const calls: { text: string; params: unknown[] }[] = [];
  const query = (async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    const table = text.match(/(?:from|into|update) public\.(\w+)/i)?.[1] ?? "";
    return rows[table] ?? [];
  }) as Query;
  return { query, calls };
}

describe("createCard", () => {
  it("creates as the caller, without RETURNING, and records the history", async () => {
    const { query, calls } = fakeQuery({
      workspaces: [{ id: "w1", slug: "consultoria", name: "Consultoria" }],
      task_statuses: [{ id: "s1" }],
    });
    const result = await createCard(query, USER, { titulo: " Revisar ", prazo: "2026-10-31" });
    const insert = calls.find((c) => c.text.includes("insert into public.tasks"))!;
    expect(insert.text).not.toMatch(/returning/i);
    expect(insert.params).toContain(USER);
    expect(insert.params).toContain(deadline("2026-10-31"));
    expect(insert.params[0]).toBe("Revisar");
    expect(calls.at(-1)!.text).toMatch(/task_history.*'created'/s);
    expect(result).toMatch(/criado em Consultoria/);
  });

  it("asks for the environment when the person belongs to several", async () => {
    const { query, calls } = fakeQuery({
      workspaces: [
        { id: "w1", slug: "consultoria", name: "Consultoria" },
        { id: "w2", slug: "marketing", name: "Marketing" },
      ],
    });
    expect(await createCard(query, USER, { titulo: "Revisar", prazo: "2026-10-31" })).toMatch(
      /Informe o ambiente/,
    );
    expect(calls.some((c) => c.text.includes("insert"))).toBe(false);
  });

  it("rejects malformed dates and ids before touching the database", async () => {
    const { query, calls } = fakeQuery();
    expect(await createCard(query, USER, { titulo: "Revisar", prazo: "31/10/2026" })).toMatch(
      /AAAA-MM-DD/,
    );
    expect(
      await createCard(query, USER, { titulo: "Revisar", prazo: "2026-10-31", cliente_id: "x" }),
    ).toMatch(/cliente_id inválido/);
    expect(calls).toHaveLength(0);
  });
});

describe("updateCard", () => {
  it("updates only the given fields with parameters and maps done to a completed status", async () => {
    const { query, calls } = fakeQuery({
      tasks: [{ workspace_id: "w1", title: "Revisar", id: CARD }],
      task_statuses: [{ id: "done-status" }],
    });
    await updateCard(query, USER, { card_id: CARD, status: "done" });
    const update = calls.find((c) => c.text.startsWith("update public.tasks"))!;
    expect(update.text).toMatch(/status = \$2, status_id = \$3, completed_at = \$4/);
    expect(update.params.slice(0, 3)).toEqual([CARD, "done", "done-status"]);
    expect(calls.at(-1)!.text).toMatch(/'updated'/);
  });

  it("reports a card the caller cannot see", async () => {
    const { query } = fakeQuery();
    expect(await updateCard(query, USER, { card_id: CARD, prioridade: "high" })).toMatch(
      /não encontrado/,
    );
  });
});

describe("comment and subtask", () => {
  it("comments as the caller at the next position", async () => {
    const { query, calls } = fakeQuery({ comments: [{ next: 3 }] });
    await commentCard(query, USER, { card_id: CARD, texto: " Oi " });
    expect(calls.at(-1)!.params).toEqual([CARD, USER, "Oi", 3]);
  });

  it("says when a subtask is missing or not allowed", async () => {
    const { query } = fakeQuery();
    expect(await setSubtaskDone(query, { subtarefa_id: CARD })).toMatch(/não encontrada/);
  });
});

describe("freeQuery", () => {
  it("only accepts SELECT or WITH and wraps it as a bounded subquery", async () => {
    const { query, calls } = fakeQuery();
    expect(await freeQuery(query, { sql: "delete from public.tasks" })).toMatch(/apenas/);
    await freeQuery(query, { sql: "select 1;" });
    expect(calls[0].text).toBe("select * from (select 1) as consulta limit 201");
  });
});

describe("readAttachment", () => {
  const file = (mime: string, name: string) =>
    fakeQuery({
      attachments: [{ file_name: name, mime_type: mime, size: 3, payload: Buffer.from("abc") }],
    }).query;

  it("returns text or image content, extracts documents and refuses other formats", async () => {
    const id = { anexo_id: CARD };
    expect((await readAttachment(file("text/plain", "a.txt"), id))[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("abc"),
    });
    expect((await readAttachment(file("image/png", "a.png"), id))[1]).toMatchObject({
      type: "image",
      mimeType: "image/png",
    });
    // Documents always go as text; a broken file is reported instead of failing the call.
    const pdf = await readAttachment(file("application/pdf", "a.pdf"), id);
    expect(pdf.every((part) => part.type === "text")).toBe(true);
    expect(pdf[0]).toMatchObject({ text: expect.stringContaining("danificado ou protegido") });
    expect((await readAttachment(file("", "foto.JPG"), id))[1]).toMatchObject({
      type: "image",
      mimeType: "image/jpeg",
    });
    expect((await readAttachment(file("application/zip", "a.zip"), id))[0]).toMatchObject({
      text: expect.stringContaining("não pode ser lido"),
    });
  });
});
