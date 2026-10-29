/**
 * Bridge between TaskFlow and each person's own Claude. The conversation happens in the Claude
 * apps (the person's own plan) through the TaskFlow MCP connector (mcp/); this module only talks
 * to the Neon Auth OAuth provider, with the person's existing session cookie, to authorize,
 * list and revoke that connection.
 */

/** Public MCP endpoint people paste into Claude. Empty until the connector is published. */
export const CLAUDE_CONNECTOR_URL: string = import.meta.env.VITE_TASKFLOW_MCP_URL ?? "";

/** Neon Auth issuer derived from the public project URL, like the browser data client. */
export function neonAuthIssuer(neonUrl: string | undefined = import.meta.env.VITE_NEON_URL) {
  if (!neonUrl) return null;
  const base = new URL(neonUrl);
  const path = base.pathname.replace(/\/$/, "");
  return `${base.protocol}//${base.hostname.replace(".", ".neonauth.")}${path}/auth`;
}

export type ClaudeConnection = {
  id: string;
  clientId: string;
  scopes: string[];
  createdAt: string;
};

async function callAuth<T>(path: string, init: RequestInit = {}): Promise<T> {
  const issuer = neonAuthIssuer();
  if (!issuer) throw new Error("A conexão com o Claude exige o banco Neon.");
  const response = await fetch(`${issuer}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(body?.message || "Não foi possível falar com o serviço de login.");
  return body as T;
}

/** The redirect returned by the OAuth provider; neither endpoint answers with an HTTP redirect. */
type Redirect = { redirect?: boolean; url?: string };

/** Resumes the authorization after the person is signed in (login page). */
export async function continueAuthorization(oauthQuery: string) {
  const { url } = await callAuth<Redirect>("/oauth2/continue", {
    method: "POST",
    body: JSON.stringify({ selected: true, oauth_query: oauthQuery }),
  });
  if (!url) throw new Error("O serviço de login não devolveu o próximo passo.");
  return url;
}

/** Answers the consent screen; the result URL returns the person to Claude. */
export async function answerConsent(oauthQuery: string, accept: boolean) {
  const { url } = await callAuth<Redirect>("/oauth2/consent", {
    method: "POST",
    body: JSON.stringify({ accept, oauth_query: oauthQuery }),
  });
  if (!url) throw new Error("O serviço de login não devolveu o próximo passo.");
  return url;
}

export async function publicClientName(clientId: string) {
  try {
    const client = await callAuth<{ client_name?: string }>(
      `/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`,
    );
    return client.client_name || null;
  } catch {
    return null;
  }
}

type RawConsent = {
  id: string;
  clientId?: string;
  client_id?: string;
  scopes?: string[] | string;
  createdAt?: string;
  created_at?: string;
};

export async function listClaudeConnections(): Promise<ClaudeConnection[]> {
  const consents = await callAuth<RawConsent[]>("/oauth2/get-consents");
  return (consents ?? []).map((consent) => ({
    id: consent.id,
    clientId: consent.clientId ?? consent.client_id ?? "",
    scopes: Array.isArray(consent.scopes)
      ? consent.scopes
      : (consent.scopes ?? "").split(" ").filter(Boolean),
    createdAt: consent.createdAt ?? consent.created_at ?? "",
  }));
}

/** Revokes the authorization; Claude has to sign in again to use TaskFlow. */
export async function disconnectClaude(consentId: string) {
  await callAuth("/oauth2/delete-consent", {
    method: "POST",
    body: JSON.stringify({ id: consentId }),
  });
}

/** Opens a new conversation in the person's own Claude with the request already written. */
export function askClaudeUrl(prompt: string) {
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}

/** Signed authorization parameters exactly as received, without the leading "?". */
export function oauthQueryFrom(search: string) {
  return search.startsWith("?") ? search.slice(1) : search;
}

// The router normalizes the address on load (repeated `ba_param` become one JSON value), which
// breaks the provider's signature. This module is evaluated while the route tree is imported,
// before the router exists, so this is still the query the authorization server sent.
const initialOauthSearch =
  typeof window !== "undefined" && window.location.pathname.includes("/oauth/")
    ? window.location.search
    : "";

export function initialOauthQuery() {
  return oauthQueryFrom(initialOauthSearch);
}

/** Host the authorization code goes back to, so the person can spot an unexpected site. */
export function redirectHost(redirectUri: string | null) {
  try {
    return redirectUri ? new URL(redirectUri).host : "endereço desconhecido";
  } catch {
    return "endereço desconhecido";
  }
}

// An explicit "Permitir" on the login step, valid only in this tab for two minutes, so the
// provider's consent step that may follow does not ask the same question twice.
const APPROVAL_KEY = "taskflow-claude-approval";

export function rememberApproval(clientId: string) {
  try {
    sessionStorage.setItem(APPROVAL_KEY, JSON.stringify({ clientId, at: Date.now() }));
  } catch {
    // Without storage the consent step simply asks again.
  }
}

export function takeApproval(clientId: string) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(APPROVAL_KEY) ?? "null");
    sessionStorage.removeItem(APPROVAL_KEY);
    return Boolean(saved && saved.clientId === clientId && Date.now() - saved.at < 120_000);
  } catch {
    return false;
  }
}

/** Longer requests would make the claude.ai address too long; Claude can ask for the rest. */
export const CLAUDE_REQUEST_LIMIT = 2000;

/**
 * Free request typed anywhere in TaskFlow. The context names what the person is looking at, so
 * Claude can find it through the connector without the person repeating it.
 */
export function buildClaudeRequest(text: string, context?: string | null) {
  const request = text.trim().slice(0, CLAUDE_REQUEST_LIMIT);
  if (!request) return "";
  return [
    "Use o conector do TaskFlow.",
    context ? `Contexto: estou vendo ${context} no TaskFlow.` : null,
    request,
  ]
    .filter(Boolean)
    .join(" ");
}

const SCREEN_NAMES: Record<string, string> = {
  "/mural": "o Mural",
  "/dashboard": "o Dashboard",
  "/tasks": "a Gestão de processos",
  "/conversations": "as Conversas",
  "/obligations": "as Obrigações",
  "/meetings": "as Reuniões",
  "/clients": "a lista de Clientes",
  "/crm": "o CRM",
  "/reports": "os Relatórios",
  "/agenda": "a Agenda",
};

/** Describes the current screen; a client page names the client itself. */
export function screenContext(
  pathname: string,
  clients: readonly { id: string; name: string }[] = [],
) {
  const clientId = pathname.match(
    /\/(?:clients|client-report)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  )?.[1];
  const client = clientId && clients.find((item) => item.id === clientId);
  if (client) return `o cliente "${client.name}"`;
  const screen = Object.keys(SCREEN_NAMES).find(
    (path) => pathname === path || pathname.includes(`${path}/`) || pathname.endsWith(path),
  );
  return screen ? SCREEN_NAMES[screen] : null;
}
