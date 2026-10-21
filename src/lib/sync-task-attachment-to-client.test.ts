import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { syncTaskAttachmentToClient } from "./sync-task-attachment-to-client";

describe("task attachment visibility in client files", () => {
  function setup(existing: any = null, insertError: any = null) {
    const insert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: insertError ? null : { id: "client-file" }, error: insertError }) }) }));
    const files = { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }), single: async () => ({ data: { id: "race-winner" }, error: null }) }) }), insert };
    const client = { from: (table: string) => table === "tasks" ? { select: () => ({ eq: () => ({ single: async () => ({ data: { client_id: "customer" }, error: null }) }) }) } : files };
    return { client, insert };
  }
  const args = { file: new File(["document"], "one.pdf", { type: "application/pdf" }), taskId: "task", sourceAttachmentId: "source", sourceStoragePath: "private/one.pdf", uploadedBy: "uploader" };
  it("links the same storage object to the task's actual client", async () => {
    const { client, insert } = setup();
    await syncTaskAttachmentToClient({ ...args, client: client as any });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ client_id: "customer", source_attachment_id: "source", storage_path: "private/one.pdf" }));
  });
  it("does not duplicate an existing imported or retried attachment", async () => {
    const { client, insert } = setup({ id: "already-saved" });
    expect(await syncTaskAttachmentToClient({ ...args, client: client as any })).toEqual({ id: "already-saved", storagePath: "private/one.pdf" });
    expect(insert).not.toHaveBeenCalled();
  });
  it("accepts a concurrent successful link instead of failing the upload", async () => {
    const { client } = setup(null, { code: "23505" });
    expect((await syncTaskAttachmentToClient({ ...args, client: client as any }))?.id).toBe("race-winner");
  });
});
