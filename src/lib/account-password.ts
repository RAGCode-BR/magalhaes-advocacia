import { createAuthClient } from "@neondatabase/neon-js/auth";
import { isNeonDatabase, supabase } from "@/integrations/supabase/client";

export async function changeAccountPassword(currentPassword: string, newPassword: string) {
  if (!isNeonDatabase) return supabase.auth.updateUser({ password: newPassword });
  const base = new URL(import.meta.env.VITE_NEON_URL);
  const auth = createAuthClient(
    `${base.protocol}//${base.hostname.replace(".", ".neonauth.")}${base.pathname}/auth`,
  );
  // The managed Auth service validates the current password and hashes the new one.
  return auth.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
}
