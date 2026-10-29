import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { signInFailureMessage } from "@/lib/sign-in-session";
import {
  answerConsent,
  continueAuthorization,
  initialOauthQuery,
  publicClientName,
  redirectHost,
  rememberApproval,
  takeApproval,
} from "@/lib/claude-connector";

/**
 * Login and consent pages of the TaskFlow OAuth provider (Neon Auth), opened by Claude when a
 * person connects the TaskFlow connector. They reuse the TaskFlow session and only redirect back
 * to the address the authorization server returns.
 */
function AuthorizationShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 p-4">
      <Card className="w-full max-w-md p-6 shadow-[var(--shadow-elegant)] sm:p-8">
        <div className="mb-6 rounded-xl bg-[#501618] p-3">
          <BrandLogo className="mx-auto h-20 w-full" />
        </div>
        {children}
      </Card>
    </div>
  );
}

function SignInForm({ intro }: { intro: string }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(signInFailureMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Entrar no TaskFlow</h1>
        <p className="mt-1 text-sm text-muted-foreground">{intro}</p>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="claude-email">E-mail</Label>
        <Input
          id="claude-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="claude-password">Senha</Label>
        <Input
          id="claude-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Entrar
      </Button>
    </form>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {text}
    </p>
  );
}

function Failure({ message }: { message: string }) {
  return (
    <div role="alert" className="space-y-2 text-sm">
      <p className="font-semibold text-destructive">Não foi possível concluir a conexão.</p>
      <p className="text-muted-foreground">{message}</p>
      <p className="text-muted-foreground">Volte ao Claude e tente conectar novamente.</p>
    </div>
  );
}

/**
 * What the person is allowing, shown before anything continues. The provider skips its own
 * consent step for some requests (only `openid`), so TaskFlow never continues an authorization
 * without this explicit confirmation, and it shows where the code will be sent.
 */
function AccessConfirmation({
  oauthQuery,
  onAnswer,
}: {
  oauthQuery: string;
  onAnswer: (accept: boolean) => Promise<void>;
}) {
  const { user, profile, signOut } = useAuth();
  const [clientName, setClientName] = useState<string | null>(null);
  const [answering, setAnswering] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const params = new URLSearchParams(oauthQuery);
  const clientId = params.get("client_id") ?? "";
  const returnHost = redirectHost(params.get("redirect_uri"));

  useEffect(() => {
    if (clientId) publicClientName(clientId).then(setClientName);
  }, [clientId]);

  const answer = async (accept: boolean) => {
    setAnswering(accept ? "allow" : "deny");
    setError(null);
    try {
      await onAnswer(accept);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tente novamente.");
      setAnswering(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="flex items-center gap-2 text-sm font-medium text-primary">
          <Sparkles className="h-4 w-4" />
          {clientName || "Aplicativo sem nome"}
        </p>
        <h1 className="mt-2 text-xl font-bold">Permitir acesso ao seu TaskFlow?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conta do TaskFlow: <strong>{profile?.full_name || user?.email}</strong>.{" "}
          <button
            type="button"
            className="text-primary underline underline-offset-2"
            disabled={!!answering}
            onClick={() => void signOut()}
          >
            Usar outra conta
          </button>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Pode ser diferente do e-mail da sua conta do Claude.
        </p>
      </div>
      <ul className="space-y-2 text-sm">
        {[
          "Ver o que você vê no TaskFlow: cards, clientes, comentários e arquivos.",
          "Criar e alterar cards, comentários e subtarefas, em seu nome, somente quando você pedir e aprovar no Claude.",
          "Nunca excluir nada.",
        ].map((item) => (
          <li key={item} className="flex gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {item}
          </li>
        ))}
      </ul>
      <div className="space-y-1 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
        <p className="flex gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          Só permita se foi você quem pediu a conexão agora, no seu Claude.
        </p>
        <p className="break-all pl-6">
          Depois de permitir, você volta para <strong>{returnHost}</strong>.
        </p>
        <p className="pl-6">Você pode desconectar quando quiser em TaskFlow → Claude.</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" disabled={!!answering} onClick={() => answer(false)}>
          {answering === "deny" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Negar
        </Button>
        <Button disabled={!!answering} onClick={() => answer(true)}>
          {answering === "allow" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Permitir
        </Button>
      </div>
    </div>
  );
}

function Denied() {
  return (
    <div role="status" className="space-y-2 text-sm">
      <p className="font-semibold">Acesso negado.</p>
      <p className="text-muted-foreground">Nada foi conectado. Você já pode fechar esta janela.</p>
    </div>
  );
}

/** Login step: signs in if needed, then asks before continuing the authorization. */
export function ClaudeLoginPage() {
  const { user, loading } = useAuth();
  const [denied, setDenied] = useState(false);
  const oauthQuery = initialOauthQuery();

  const onAnswer = async (accept: boolean) => {
    if (!accept) return setDenied(true);
    rememberApproval(new URLSearchParams(oauthQuery).get("client_id") ?? "");
    window.location.assign(await continueAuthorization(oauthQuery));
  };

  return (
    <AuthorizationShell>
      {!oauthQuery ? (
        <Failure message="Este endereço só funciona quando aberto pelo Claude." />
      ) : denied ? (
        <Denied />
      ) : loading ? (
        <Waiting text="Carregando…" />
      ) : !user ? (
        <SignInForm intro="Entre com a sua conta para conectar o Claude ao TaskFlow." />
      ) : (
        <AccessConfirmation oauthQuery={oauthQuery} onAnswer={onAnswer} />
      )}
    </AuthorizationShell>
  );
}

/**
 * Consent step of the provider. When the person has just confirmed the same application on the
 * login step in this tab, that answer is sent once instead of asking twice.
 */
export function ClaudeConsentPage() {
  const { user, loading } = useAuth();
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const oauthQuery = initialOauthQuery();
  const clientId = new URLSearchParams(oauthQuery).get("client_id") ?? "";
  const [approved] = useState(() => (clientId ? takeApproval(clientId) : false));
  const sent = useRef(false);

  const onAnswer = async (accept: boolean) => {
    const url = await answerConsent(oauthQuery, accept);
    if (accept) window.location.assign(url);
    else setDenied(true);
  };

  useEffect(() => {
    if (!approved || !user || sent.current) return;
    sent.current = true;
    onAnswer(true).catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- answer once, right after sign-in state is known
  }, [approved, user]);

  return (
    <AuthorizationShell>
      {!oauthQuery ? (
        <Failure message="Este endereço só funciona quando aberto pelo Claude." />
      ) : error ? (
        <Failure message={error} />
      ) : denied ? (
        <Denied />
      ) : loading || (approved && user) ? (
        <Waiting text="Concluindo a conexão com o Claude…" />
      ) : !user ? (
        <SignInForm intro="Entre com a sua conta para autorizar o Claude." />
      ) : (
        <AccessConfirmation oauthQuery={oauthQuery} onAnswer={onAnswer} />
      )}
    </AuthorizationShell>
  );
}
