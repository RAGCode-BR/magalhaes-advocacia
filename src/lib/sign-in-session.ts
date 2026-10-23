import type { Session } from "@supabase/supabase-js";

type SignInAuth = {
  signInWithPassword: (credentials: { email: string; password: string }) => Promise<{
    data: { session: Session | null };
    error: { message: string } | null;
  }>;
};

/** Complete sign-in in this tab even when the auth adapter emits no event here. */
export async function signInAndHydrate(
  auth: SignInAuth,
  credentials: { email: string; password: string },
  hydrate: (session: Session) => Promise<void>,
) {
  const { data, error } = await auth.signInWithPassword(credentials);
  if (error) throw new Error(error.message);
  const session = data?.session;
  if (!session?.user?.id || !session.access_token)
    throw new Error("Não foi possível iniciar a sessão. Tente entrar novamente.");
  if (session.user.email?.toLowerCase() !== credentials.email.trim().toLowerCase())
    throw new Error("A sessão retornada não corresponde ao login informado. Saia e entre novamente.");
  await hydrate(session);
}

/** Provider messages are not always localized by the Neon adapter. */
export function signInFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/invalid.*(email|password|credentials)|invalid_email_or_password/i.test(message))
    return "E-mail ou senha incorretos. Confira seus dados e tente novamente.";
  return message || "Não foi possível entrar. Tente novamente.";
}
