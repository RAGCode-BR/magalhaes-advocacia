import { describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { signInAndHydrate } from "./sign-in-session";
const session = { access_token: "test-token", user: { id: "igor", email: "igor@example.invalid" } } as Session;
const credentials = { email: "igor@example.invalid", password: "test-only-password" };
describe("same-tab sign-in session", () => {
  it("loads the authenticated profile without depending on any auth event", async () => {
    const hydrate = vi.fn(async () => {});
    const auth = { signInWithPassword: vi.fn(async () => ({ data: { session }, error: null })) };
    await signInAndHydrate(auth, credentials, hydrate);
    expect(hydrate).toHaveBeenCalledWith(session);
  });
  it("waits for access loading before reporting successful sign-in", async () => {
    let finish!: () => void;
    let completed = false;
    const hydrate = () => new Promise<void>(resolve => { finish = resolve; });
    const job = signInAndHydrate({ signInWithPassword: async () => ({ data: { session }, error: null }) }, credentials, hydrate).then(() => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false); finish(); await job;
    expect(completed).toBe(true);
  });
  it("does not welcome a failed password or an absent session", async () => {
    const hydrate = vi.fn();
    await expect(signInAndHydrate({ signInWithPassword: async () => ({ data: { session: null }, error: { message: "Senha inválida" } }) }, credentials, hydrate)).rejects.toThrow("Senha inválida");
    await expect(signInAndHydrate({ signInWithPassword: async () => ({ data: { session: null }, error: null }) }, credentials, hydrate)).rejects.toThrow("iniciar a sessão");
    expect(hydrate).not.toHaveBeenCalled();
  });
  it("rejects a stale session belonging to another login", async () => {
    const hydrate = vi.fn();
    await expect(signInAndHydrate({ signInWithPassword: async () => ({ data: { session }, error: null }) }, { ...credentials, email: "another@example.invalid" }, hydrate)).rejects.toThrow("não corresponde");
    expect(hydrate).not.toHaveBeenCalled();
  });
});
