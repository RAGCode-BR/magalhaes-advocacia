import { describe, expect, it, vi } from "vitest";
// Exercita os handlers gerados usados no Supabase, sem chamar um provedor real.
// @ts-expect-error arquivo gerado pelo build:edge
import {
  createTasksFromAta,
  formatAtaWithGemini,
  generateClientReport,
} from "../../supabase/functions/taskflow-ai/handlers.js";

const task = {
  title: "Revisar contrato",
  description: null,
  status: "todo",
  status_id: null,
  column_id: null,
  priority: "medium",
  due_date: "2026-10-22T12:00:00.000Z",
  assignee_id: null,
  client_id: null,
  tag_id: null,
};
describe("operações de servidor preparadas para Pages", () => {
  it("rejeita a criação sem sessão antes de escrever", async () => {
    await expect(createTasksFromAta({ data: { tasks: [task] }, context: {} })).rejects.toThrow(
      "Sessão expirada",
    );
  });
  it("valida a entrada antes de chamar a IA", () => {
    expect(() => formatAtaWithGemini({ data: {}, context: {} })).toThrow("Envie um PDF");
    expect(() => generateClientReport({ data: { clientId: "" }, context: {} })).toThrow(
      "clientId requerido",
    );
  });
  it("grava tarefas com o cliente do usuário e preserva a recusa RLS", async () => {
    const select = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "row-level security policy" } });
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    await expect(
      createTasksFromAta({
        data: { tasks: [task] },
        context: { userId: "usuario-autenticado", supabase: { from } },
      }),
    ).rejects.toThrow("row-level security policy");
    expect(from).toHaveBeenCalledWith("tasks");
    expect(insert.mock.calls[0][0][0].created_by).toBe("usuario-autenticado");
  });
});
