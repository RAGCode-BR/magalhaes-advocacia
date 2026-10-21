import { createClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/types";
import { createNeonBrowserClient } from "./neon-client";

/** All task writes and offline replay use the selected backend and verified JWT. */
export function createAuthenticatedDataClient(accessToken: string) {
  if (!accessToken) throw new Error("Sua sessão expirou. Entre novamente para salvar os dados.");
  const neonUrl = import.meta.env.VITE_NEON_URL;
  if (neonUrl)
    return createNeonBrowserClient(neonUrl, accessToken) as unknown as ReturnType<
      typeof createClient<Database>
    >;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("A conexão com o banco de dados não está configurada.");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
