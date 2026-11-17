import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./worker";
const env = {
  APP_ORIGIN: "https://ragcode-br.github.io",
  NEON_DATA_URL: "https://data.example.test/rest/v1",
} as any;
afterEach(() => vi.unstubAllGlobals());
describe("bank endpoint access", () => {
  it("refuses anonymous calls and requests from other sites", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (await worker.fetch(new Request("https://bank.test/sync", { method: "POST" }), env)).status,
    ).toBe(401);
    expect(
      (
        await worker.fetch(
          new Request("https://bank.test/sync", {
            method: "POST",
            headers: { Origin: "https://other.test" },
          }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires the authenticated admin RPC, not a decoded JWT claim", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(false));
    vi.stubGlobal("fetch", fetch);
    const response = await worker.fetch(
      new Request("https://bank.test/sync", {
        method: "POST",
        headers: { Authorization: "Bearer fake-token" },
        body: '{"month":"2026-11"}',
      }),
      env,
    );
    expect(response.status).toBe(403);
    expect(fetch.mock.calls[0][0]).toBe(
      "https://data.example.test/rest/v1/rpc/office_bank_sync_authorize",
    );
    expect(fetch.mock.calls[0][1].redirect).toBe("manual");
  });
  it("rejects invalid periods before accessing the banking credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(true)));
    const response = await worker.fetch(
      new Request("https://bank.test/sync", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
        body: '{"month":"2026-13"}',
      }),
      env,
    );
    expect(response.status).toBe(400);
  });
});
