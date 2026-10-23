import type { Session } from "@supabase/supabase-js";

type SessionResult = { data: { session: Session | null }; error: any };
type AuthApi = {
  getSession(options?: { forceFetch?: boolean }): Promise<SessionResult>;
  signInWithPassword(credentials: { email: string; password: string }): Promise<any>;
  signOut(): Promise<{ error: any }>;
  onAuthStateChange?(callback: (event: string, session: Session | null) => void): any;
};

function usableToken(session: Session | null) {
  try {
    const token = session?.access_token;
    if (!token || token.split(".").length !== 3) return false;
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
    // This is a freshness/identity check only. The Data API validates the signature.
    return claims.sub === session.user.id && Number(claims.exp) > Date.now() / 1000 + 30;
  } catch { return false; }
}

/** Use a server-fetched JWT, never the opaque Better Auth cookie/session token. */
export function createNeonSessionBridge<T extends AuthApi>(original: T, onInvalidate = () => {}) {
  let cached: Session | null = null;
  let fetchedAt = 0;
  let pending: Promise<SessionResult> | null = null;
  let generation = 0;
  let signedOut = false;
  let mutating = false;
  const listeners = new Set<(event: string, session: Session | null) => void>();
  const emit = (event: string, session: Session | null) => {
    for (const callback of listeners) callback(event, session);
  };
  const invalidate = (clearFiles = true) => {
    generation++; cached = null; pending = null; fetchedAt = 0;
    if (clearFiles) onInvalidate();
  };
  const getSession = async (options?: { forceFetch?: boolean }): Promise<SessionResult> => {
    if (signedOut) return { data: { session: null }, error: null };
    if (!options?.forceFetch && cached && usableToken(cached) && Date.now() - fetchedAt < 60_000)
      return { data: { session: cached }, error: null };
    if (pending) return pending;
    const started = generation;
    const job = (async (): Promise<SessionResult> => {
      try {
        const result = await original.getSession({ forceFetch: true });
        if (started !== generation) return { data: { session: null }, error: null };
        if (result.error) return { data: { session: null }, error: result.error };
        if (!result.data.session) { cached = null; return result; }
        if (!usableToken(result.data.session)) return {
          data: { session: null }, error: new Error("Não foi possível validar sua sessão de acesso. Entre novamente."),
        };
        cached = result.data.session; fetchedAt = Date.now();
        return { data: { session: cached }, error: null };
      } catch (error) { return { data: { session: null }, error }; }
    })();
    pending = job;
    try { return await job; }
    finally { if (started === generation) pending = null; }
  };
  original.onAuthStateChange?.((event) => {
    if (event === "INITIAL_SESSION" || mutating) return;
    // Token refresh broadcasts are only cache hints. Fetching immediately in
    // response would make two tabs repeatedly refresh one another's JWTs.
    if (event === "TOKEN_REFRESHED") { cached = null; fetchedAt = 0; return; }
    if (!["SIGNED_OUT", "SIGNED_IN", "USER_UPDATED"].includes(event)) return;
    // Broadcasts can be delayed and carry another tab's stale/opaque session.
    // Reconcile against the server cookie instead of trusting their payload.
    const previousIdentity = cached?.user.id ?? null;
    signedOut = false;
    invalidate(false);
    const started = generation;
    void getSession({ forceFetch: true }).then(({ data, error }) => {
      if (mutating || started !== generation || error) return;
      signedOut = !data.session;
      const sameIdentity = !!data.session && previousIdentity === data.session.user.id;
      if (!sameIdentity) onInvalidate();
      emit(data.session ? (sameIdentity ? "TOKEN_REFRESHED" : "SIGNED_IN") : "SIGNED_OUT", data.session);
    });
  });
  const auth = new Proxy(original, {
    get(target, key) {
      if (key === "getSession") return getSession;
      if (key === "onAuthStateChange") return (callback: (event: string, session: Session | null) => void) => {
        listeners.add(callback);
        return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
      };
      if (key === "getUser") return async () => {
        const result = await getSession();
        return { data: { user: result.data.session?.user ?? null }, error: result.error };
      };
      if (key === "signInWithPassword") return async (credentials: { email: string; password: string }) => {
        mutating = true;
        invalidate(); signedOut = false;
        try {
          const result = await target.signInWithPassword(credentials);
          if (result.error) { signedOut = true; return result; }
          // Discard even requests started by the adapter during password login.
          invalidate();
          const verified = await getSession({ forceFetch: true });
          if (!verified.error && verified.data.session) emit("SIGNED_IN", verified.data.session);
          return { data: { user: verified.data.session?.user ?? null, session: verified.data.session }, error: verified.error };
        } finally { mutating = false; }
      };
      if (key === "signOut") return async () => {
        mutating = true;
        invalidate();
        try {
          const result = await target.signOut();
          if (!result.error) { signedOut = true; invalidate(); emit("SIGNED_OUT", null); }
          return result;
        } finally { mutating = false; }
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { auth, getToken: async () => (await getSession()).data.session?.access_token ?? null };
}
