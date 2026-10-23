import { describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { createNeonSessionBridge } from "./neon-session";
const session = (sub = "igor", exp = Date.now() / 1000 + 900) => ({
  user: { id: sub, email: "igor@example.invalid" },
  access_token: `header.${btoa(JSON.stringify({ sub, exp }))}.signature`,
} as Session);
const credentials = { email: "igor@example.invalid", password: "fixture-only" };
function fixture() {
  const verified = session();
  const original = {
    getSession: vi.fn(async (_options?: { forceFetch?: boolean }) => ({ data: { session: verified as Session | null }, error: null as any })),
    signInWithPassword: vi.fn(async (_credentials: { email: string; password: string }) => ({ data: { session: { ...verified, access_token: "opaque-cookie-token" } }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  return { original, verified, bridge: createNeonSessionBridge(original) };
}
describe("verified Neon session used by every data module", () => {
  it("replaces the login cache token with the server JWT for both session and database", async () => {
    const { original, verified, bridge } = fixture();
    const login = await bridge.auth.signInWithPassword(credentials);
    expect(login.data.session?.access_token).toBe(verified.access_token);
    expect(original.getSession).toHaveBeenCalledWith({ forceFetch: true });
    expect(await bridge.getToken()).toBe(verified.access_token);
    expect(original.getSession).toHaveBeenCalledTimes(1);
  });
  it("invalidates private file caches on same-tab account changes", async () => {
    const { original } = fixture(); const clear = vi.fn();
    const bridge = createNeonSessionBridge(original, clear);
    await bridge.auth.signInWithPassword(credentials);
    expect(clear).toHaveBeenCalled(); clear.mockClear();
    await bridge.auth.signOut(); expect(clear).toHaveBeenCalled();
  });
  it("never sends an opaque, expired or wrong-identity token to the API", async () => {
    for (const invalid of [ { ...session(), access_token: "opaque" }, session("igor", 1), { ...session("another"), user: { id: "igor" } } ]) {
      const { original, bridge } = fixture(); original.getSession.mockResolvedValue({ data: { session: invalid as Session }, error: null });
      expect(await bridge.getToken()).toBeNull();
    }
  });
  it("shares parallel refreshes and renews near-expiry JWTs", async () => {
    const { original, bridge } = fixture();
    await Promise.all([bridge.getToken(), bridge.getToken(), bridge.auth.getSession()]);
    expect(original.getSession).toHaveBeenCalledTimes(1);
    await bridge.auth.getSession({ forceFetch: true });
    expect(original.getSession).toHaveBeenCalledTimes(2);
  });
  it("clears the same-tab session on logout without relying on an event", async () => {
    const { original, bridge } = fixture(); await bridge.auth.signInWithPassword(credentials);
    await bridge.auth.signOut();
    expect(await bridge.getToken()).toBeNull();
    expect((await bridge.auth.getSession()).data.session).toBeNull();
    expect(original.signOut).toHaveBeenCalledOnce();
    await bridge.auth.signInWithPassword(credentials);
    expect(await bridge.getToken()).not.toBeNull();
  });
  it("does not resurrect a pending session after logout", async () => {
    const { original, bridge } = fixture();
    let finish!: (value: any) => void;
    original.getSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = bridge.getToken(); await bridge.auth.signOut();
    finish({ data: { session: session() }, error: null });
    expect(await pending).toBeNull(); expect(await bridge.getToken()).toBeNull();
  });
  it("does not convert a failed password check into a cached success", async () => {
    const { original, bridge } = fixture();
    original.signInWithPassword.mockResolvedValue({ data: { session: null as any }, error: { message: "invalid" } as any });
    expect((await bridge.auth.signInWithPassword(credentials)).error).toBeTruthy();
    expect(original.getSession).not.toHaveBeenCalled();
  });
});

describe("account switching and delayed auth events", () => {
  function accounts(onInvalidate = () => {}) {
    let notify!: (event: string, session: Session | null) => void;
    let current: Session | null = null;
    const original = {
      onAuthStateChange: (callback: typeof notify) => { notify = callback; },
      getSession: vi.fn(async () => ({ data: { session: current }, error: null })),
      signInWithPassword: vi.fn(async ({ email }: { email: string; password: string }) => {
        current = { ...session(email), user: { id: email, email } } as Session;
        // A queued logout broadcast arrives while a new login is completing.
        notify("SIGNED_OUT", null);
        return { data: { session: current }, error: null };
      }),
      signOut: vi.fn(async () => { current = null; notify("SIGNED_OUT", null); return { error: null }; }),
    };
    return { bridge: createNeonSessionBridge(original, onInvalidate), original, notify: (event: string, s: Session | null) => notify(event, s) };
  }
  it("preserves private downloads when a broadcast only renews the same identity", async () => {
    const clear = vi.fn();
    const { bridge, notify } = accounts(clear);
    await bridge.auth.signInWithPassword(credentials);
    clear.mockClear();
    notify("TOKEN_REFRESHED", session());
    await bridge.auth.getSession(); await Promise.resolve();
    expect(clear).not.toHaveBeenCalled();
  });
  it("switches owner -> logout -> Igor -> logout -> owner despite delayed logout events", async () => {
    const { bridge } = accounts(); const changes = vi.fn();
    bridge.auth.onAuthStateChange(changes);
    for (const email of ["owner@example.invalid", "igor@example.invalid", "owner@example.invalid"]) {
      const login = await bridge.auth.signInWithPassword({ email, password: "fixture" });
      expect(login.data.session.user.email).toBe(email);
      expect(await bridge.getToken()).toBe(login.data.session.access_token);
      await bridge.auth.signOut();
      expect(await bridge.getToken()).toBeNull();
    }
    expect(changes.mock.calls.map(([event]) => event)).toEqual(["SIGNED_IN", "SIGNED_OUT", "SIGNED_IN", "SIGNED_OUT", "SIGNED_IN", "SIGNED_OUT"]);
  });
  it("validates stale cross-tab logout and sign-in against the server, ignoring their payload", async () => {
    const { bridge, notify } = accounts(); const changes = vi.fn();
    bridge.auth.onAuthStateChange(changes);
    await bridge.auth.signInWithPassword(credentials);
    notify("SIGNED_OUT", null);
    await bridge.auth.getSession(); await Promise.resolve();
    expect(changes.mock.lastCall?.[1]?.user.email).toBe(credentials.email);
    await bridge.auth.signOut();
    notify("SIGNED_IN", session("old-user"));
    await bridge.auth.getSession(); await Promise.resolve();
    expect(changes.mock.lastCall).toEqual(["SIGNED_OUT", null]);
    expect(await bridge.getToken()).toBeNull();
  });
});
