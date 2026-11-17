import pg from "pg";
import { handleBoleto } from "./boletos.ts";
import {
  API_URL,
  TOKEN_URL,
  BankError,
  bankBalances,
  bankJson,
  bankMonth,
  bankRows,
  type MtlsFetcher,
} from "./sicoob.ts";

interface Env {
  SICOOB_CERT: MtlsFetcher;
  SICOOB_CLIENT_ID: string;
  SICOOB_ACCOUNT: string;
  SICOOB_BENEFICIARY: string;
  BANK_DATABASE_URL: string;
  BANK_CONNECTION_ID: string;
  NEON_DATA_URL: string;
  APP_ORIGIN: string;
}
let cached: { client: string; token: string; until: number } | undefined;
async function token(env: Env) {
  if (cached?.client === env.SICOOB_CLIENT_ID && cached.until > Date.now()) return cached.token;
  const body = await bankJson(env.SICOOB_CERT, TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.SICOOB_CLIENT_ID,
      scope: "cco_consulta openid",
    }),
  });
  if (typeof body.access_token !== "string" || !body.scope?.split(" ").includes("cco_consulta"))
    throw new BankError("O Sicoob não autorizou a consulta da conta.", "invalid_token");
  cached = {
    client: env.SICOOB_CLIENT_ID,
    token: body.access_token,
    until: Date.now() + Math.max(0, Math.min(Number(body.expires_in) || 0, 300) - 60) * 1000,
  };
  return cached.token;
}

function safeError(error: unknown) {
  if (error instanceof BankError) return error.message;
  // Only these fixed database validation messages may reach a browser or logs.
  if (
    error instanceof Error &&
    [
      "O banco alterou uma movimentação conciliada. Revise a conciliação antes de atualizar.",
      "O honorário mudou. Revise o boleto antes de emitir.",
      "Aguarde a emissão antes de consultar.",
      "Boleto do banco não corresponde ao lançamento.",
      "Conta desativada.",
    ].includes(error.message)
  )
    return error.message;
  return "Não foi possível atualizar o Sicoob. Os dados anteriores foram preservados. Tente novamente.";
}

export async function synchronize(env: Env, month: string) {
  const period = bankMonth(month);
  if (!/^\d+$/.test(env.SICOOB_ACCOUNT))
    throw new BankError("Conta bancária não configurada.", "missing_account");
  const db = new pg.Client({
    connectionString: env.BANK_DATABASE_URL,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
  });
  let lease: string | null = null;
  try {
    await db.connect();
    lease = (
      await db.query("SELECT public.office_bank_sync_claim($1) AS lease", [env.BANK_CONNECTION_ID])
    ).rows[0].lease;
    if (!lease)
      return {
        busy: true,
        message:
          "Uma atualização já está em andamento ou acabou de ser concluída. Aguarde alguns segundos.",
      };
    const accessToken = await token(env);
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      client_id: env.SICOOB_CLIENT_ID,
      Accept: "application/json",
    };
    const balance = bankBalances(
      await bankJson(env.SICOOB_CERT, `${API_URL}saldo?numeroContaCorrente=${env.SICOOB_ACCOUNT}`, {
        headers,
      }),
    );
    // The official Conta Corrente documentation limits requests to two per second.
    await new Promise((resolve) => setTimeout(resolve, 600));
    const query = new URLSearchParams({
      numeroContaCorrente: env.SICOOB_ACCOUNT,
      diaInicial: "01",
      diaFinal: period.through.slice(8),
      agruparCNAB: "false",
    });
    const rows = bankRows(
      await bankJson(
        env.SICOOB_CERT,
        `${API_URL}extrato/${Number(month.slice(5))}/${month.slice(0, 4)}?${query}`,
        { headers },
      ),
      month,
    );
    const changed = (
      await db.query("SELECT public.office_bank_sync_finish($1,$2,$3,$4,$5,NULL) AS changed", [
        env.BANK_CONNECTION_ID,
        lease,
        period.from,
        JSON.stringify(rows),
        JSON.stringify(balance),
      ])
    ).rows[0].changed;
    return { busy: false, count: rows.length, changed, month, synced_at: new Date().toISOString() };
  } catch (error) {
    if (lease) {
      try {
        await db.query("SELECT public.office_bank_sync_finish($1,$2,$3,'[]','[]',$4)", [
          env.BANK_CONNECTION_ID,
          lease,
          period.from,
          safeError(error),
        ]);
      } catch {
        /* The lease expires even if the database connection was interrupted. */
      }
    }
    throw new BankError(safeError(error), error instanceof BankError ? error.code : "sync_failed");
  } finally {
    await db.end().catch(() => {});
  }
}

function json(value: unknown, status = 200, origin?: string) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET")
      return json({ ok: true, service: "magalhaes-sicoob" });
    const origin = request.headers.get("Origin");
    if (origin && origin !== env.APP_ORIGIN) return json({ error: "Origem não autorizada." }, 403);
    const boletoAction = /^\/boletos\/(issue|query|pdf)$/.exec(path)?.[1];
    if (request.method === "OPTIONS" && (path === "/sync" || boletoAction))
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": env.APP_ORIGIN,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "600",
          Vary: "Origin",
        },
      });
    if ((path !== "/sync" && !boletoAction) || request.method !== "POST")
      return json({ error: "Não encontrado." }, 404, origin || undefined);
    const authorization = request.headers.get("Authorization") || "";
    if (!/^Bearer [^\s]+$/.test(authorization) || authorization.length > 20000)
      return json(
        { error: "Entre no sistema para atualizar o extrato." },
        401,
        origin || undefined,
      );
    try {
      const auth = await fetch(`${env.NEON_DATA_URL}/rpc/office_bank_sync_authorize`, {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: "{}",
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      if (!auth.ok && auth.status !== 401 && auth.status !== 403 && auth.status !== 400)
        throw new BankError(
          "Não foi possível validar sua sessão agora. Tente novamente.",
          "auth_unavailable",
        );
      const authResult = await auth.json().catch(() => null);
      if (!auth.ok || authResult !== true) {
        console.warn(
          "bank_authorization_denied",
          auth.status,
          typeof authResult?.code === "string" && /^[A-Z0-9_]{1,20}$/.test(authResult.code)
            ? authResult.code
            : "denied",
        );
        return json(
          { error: "Acesso restrito a administradores. Entre novamente se a sessão expirou." },
          403,
          origin || undefined,
        );
      }
      const body = await request.text();
      if (body.length > 512)
        return json({ error: "Solicitação inválida." }, 400, origin || undefined);
      if (boletoAction) {
        let input: { id?: string; nossoNumero?: string };
        try {
          input = JSON.parse(body);
        } catch {
          return json({ error: "Solicitação inválida." }, 400, origin || undefined);
        }
        if (
          !input ||
          typeof input.id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id) ||
          (input.nossoNumero !== undefined && !/^\d{1,20}$/.test(input.nossoNumero))
        )
          return json({ error: "Boleto inválido." }, 400, origin || undefined);
        const result = await handleBoleto(env, boletoAction, input.id, input.nossoNumero);
        if ("pdf" in result)
          return new Response(result.pdf as BodyInit, {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename="boleto-${input.id}.pdf"`,
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
              "Access-Control-Allow-Origin": env.APP_ORIGIN,
              Vary: "Origin",
            },
          });
        return json(result, 200, origin || undefined);
      }
      let month: string;
      try {
        month = JSON.parse(body).month;
        bankMonth(month);
      } catch {
        return json({ error: "Selecione um mês válido." }, 400, origin || undefined);
      }
      return json(await synchronize(env, month), 200, origin || undefined);
    } catch (error) {
      console.error("bank_sync_failed", error instanceof BankError ? error.code : "request_failed");
      return json({ error: safeError(error) }, 502, origin || undefined);
    }
  },
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const month = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" })
      .format(new Date())
      .slice(0, 7);
    try {
      await synchronize(env, month);
    } catch (error) {
      console.error(
        "bank_scheduled_sync_failed",
        error instanceof BankError ? error.code : "sync_failed",
      );
    }
  },
};
