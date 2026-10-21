import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthenticatedDataClient } from "./authenticated-client";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("authenticated database routing", () => {
  it.each([false, true])(
    "creates tasks in Neon without requiring Supabase (legacy config: %s)",
    async (legacy) => {
      vi.stubEnv("VITE_NEON_URL", "https://ep-test.c-6.us-east-2.aws.neon.tech/magalhaes");
      vi.stubEnv("VITE_SUPABASE_URL", legacy ? "https://other.supabase.co" : "");
      vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", legacy ? "other-key" : "");
      const fetch = vi.fn(async () => new Response(null, { status: 201 }));
      vi.stubGlobal("fetch", fetch);
      const client = createAuthenticatedDataClient("verified-neon-jwt");
      const { error } = await client
        .from("tasks")
        .insert({ title: "Tarefa atribuída", assignee_id: "test-profile" });
      expect(error).toBeNull();
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(String(url)).toBe(
        "https://ep-test.apirest.c-6.us-east-2.aws.neon.tech/magalhaes/rest/v1/tasks",
      );
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer verified-neon-jwt");
      expect(JSON.parse(init.body as string)).toMatchObject({
        title: "Tarefa atribuída",
        assignee_id: "test-profile",
      });
    },
  );

  it("keeps the local Supabase backend authenticated when Neon is not selected", async () => {
    vi.stubEnv("VITE_NEON_URL", "");
    vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:55441");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "local-key");
    const fetch = vi.fn(
      async () =>
        new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetch);
    await createAuthenticatedDataClient("local-jwt").from("tasks").select("id");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("http://127.0.0.1:55441/rest/v1/tasks");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer local-jwt");
  });

  it("rejects task writes without a verified session", () => {
    expect(() => createAuthenticatedDataClient("")).toThrow("Sua sessão expirou");
  });
});
