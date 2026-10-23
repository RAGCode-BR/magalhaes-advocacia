import type { Session } from "@supabase/supabase-js";

type SessionResult = { data: { session: Session | null }; error: any };
type AuthApi = {
  getSession(options?: { forceFetch?: boolean }): Promise<SessionResult>;
  signInWithPassword(credentials: { email: string; password: string }): Promise<any>;
  signOut(): Promise<{ error: any }>;
  onAuthStateChange?(callback: (event: string) => void): any;
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
export function createNeonSessionBridge<T extends AuthApi>(original: T) {
  let cached: Session | null = null;
  let fetchedAt = 0;
  let pending: Promise<SessionResult> | null = null;
  let generation = 0;
  let signedOut = false;
  const invalidate = () => { generation++; cached = null; pending = null; fetchedAt = 0; };
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
    if (event === "SIGNED_OUT") { signedOut = true; invalidate(); }
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") { signedOut = false; invalidate(); }
  });
  const auth = new Proxy(original, {
    get(target, key) {
      if (key === "getSession") return getSession;
      if (key === "signInWithPassword") return async (credentials: { email: string; password: string }) => {
        invalidate(); signedOut = false;
        const result = await target.signInWithPassword(credentials);
        if (result.error) return result;
        // A successful password check can still return a cached opaque token.
        const verified = await getSession({ forceFetch: true });
        return { data: { user: verified.data.session?.user ?? null, session: verified.data.session }, error: verified.error };
      };
      if (key === "signOut") return async () => {
        invalidate();
        const result = await target.signOut();
        if (!result.error) { signedOut = true; invalidate(); }
        return result;
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { auth, getToken: async () => (await getSession()).data.session?.access_token ?? null };
}
