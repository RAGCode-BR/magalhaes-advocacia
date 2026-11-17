import pg from "pg";
import { TOKEN_URL, BankError, bankJson, bankCents, type MtlsFetcher } from "./sicoob.ts";
import { boletoRequest, type BoletoIntent } from "../../src/lib/sicoob-boleto.ts";
export const BOLETO_URL = "https://api.sicoob.com.br/cobranca-bancaria/v3/boletos";
export interface BoletoEnv {
  SICOOB_CERT: MtlsFetcher;
  SICOOB_CLIENT_ID: string;
  SICOOB_ACCOUNT: string;
  SICOOB_BENEFICIARY: string;
  BANK_DATABASE_URL: string;
  BANK_CONNECTION_ID: string;
}
let cached: { client: string; token: string; until: number } | undefined;
async function headers(env: BoletoEnv) {
  if (!env.SICOOB_BENEFICIARY)
    throw new BankError("Beneficiário Sicoob não configurado.", "missing_beneficiary");
  if (!cached || cached.client !== env.SICOOB_CLIENT_ID || cached.until < Date.now()) {
    const data = await bankJson(env.SICOOB_CERT, TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.SICOOB_CLIENT_ID,
        scope: "boletos_inclusao boletos_consulta openid",
      }),
    });
    if (
      typeof data.access_token !== "string" ||
      !["boletos_inclusao", "boletos_consulta"].every((x) => data.scope?.split(" ").includes(x))
    )
      throw new BankError(
        "O Sicoob não liberou a emissão e consulta de boletos para esta aplicação.",
        "boleto_scope",
      );
    cached = {
      client: env.SICOOB_CLIENT_ID,
      token: data.access_token,
      until: Date.now() + Math.max(0, Math.min(Number(data.expires_in) || 0, 300) - 60) * 1000,
    };
  }
  return {
    Authorization: `Bearer ${cached.token}`,
    client_id: env.SICOOB_CLIENT_ID,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}
export function boletoResult(body: any, b: BoletoIntent, beneficiary: string) {
  const r = body?.resultado;
  if (
    !r ||
    String(r.numeroCliente) !== beneficiary ||
    Number(r.codigoModalidade) !== 1 ||
    r.seuNumero !== b.reference ||
    bankCents(r.valor) !== b.amount_cents ||
    r.pagador?.numeroCpfCnpj !== b.payer.numeroCpfCnpj ||
    !/^\d{1,20}$/.test(String(r.nossoNumero)) ||
    !Number(r.nossoNumero)
  )
    throw new BankError(
      "O retorno do banco não corresponde ao boleto. Consulte a cobrança antes de continuar.",
      "boleto_mismatch",
    );
  const limited = (value: unknown, max: number) =>
    typeof value === "string" ? value.slice(0, max) : "";
  const bar = limited(r.codigoBarras, 44),
    line = limited(r.linhaDigitavel, 60).replace(/[^\d]/g, "");
  if ((bar && !/^\d{44}$/.test(bar)) || (line && !/^\d{47}$/.test(line)))
    throw new BankError("O banco retornou uma linha digitável inválida.", "boleto_mismatch");
  return {
    nossoNumero: String(r.nossoNumero),
    seuNumero: b.reference,
    amount_cents: b.amount_cents,
    payer_document: b.payer.numeroCpfCnpj,
    codigoBarras: bar,
    linhaDigitavel: line,
    situacaoBoleto: limited(r.situacaoBoleto, 100) || "Registrado",
    dataVencimento: limited(r.dataVencimento, 30).slice(0, 10),
    queried_at: new Date().toISOString(),
  };
}
export function boletoPdf(body: any): Uint8Array {
  const encoded = body?.resultado?.pdfBoleto;
  if (
    typeof encoded !== "string" ||
    encoded.length > 10_000_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  )
    throw new BankError(
      "O Sicoob não disponibilizou o PDF. Tente consultar novamente.",
      "missing_pdf",
    );
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
    throw new BankError("PDF inválido recebido do banco.", "invalid_pdf");
  return bytes;
}
// Persist the issuing state BEFORE contacting the bank. Never retry an ambiguous POST.
export async function issueBoleto(db: pg.Client, env: BoletoEnv, id: string) {
  const h = await headers(env); // a token failure cannot create an issuance intent
  const claim = (
    await db.query("SELECT public.office_boleto_claim($1,$2) AS result", [
      id,
      env.BANK_CONNECTION_ID,
    ])
  ).rows[0].result;
  if (!claim.claimed) return { state: claim.state, repeated: true };
  const b = claim.boleto as BoletoIntent;
  let submitted = false;
  try {
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(
      new Date(),
    );
    let payload;
    try {
      payload = boletoRequest(b, env.SICOOB_BENEFICIARY, env.SICOOB_ACCOUNT, today);
    } catch (e) {
      throw new BankError((e as Error).message, "boleto_validation");
    }
    submitted = true;
    const response = await env.SICOOB_CERT.fetch(BOLETO_URL, {
      method: "POST",
      headers: h,
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      // These explicit refusals did not register a charge. 409/5xx/timeouts stay uncertain.
      if ([400, 401, 403, 404, 422, 429].includes(response.status)) submitted = false;
      throw new BankError(
        `O Sicoob não confirmou a emissão (HTTP ${response.status}). Revise os dados e a habilitação de cobrança.`,
        `boleto_http_${response.status}`,
      );
    }
    const data = boletoResult(await response.json(), b, env.SICOOB_BENEFICIARY);
    await db.query("SELECT public.office_boleto_finish($1,$2,'issued',$3,NULL)", [
      id,
      b.lease,
      JSON.stringify(data),
    ]);
    return { state: "issued" };
  } catch (error) {
    const state = submitted ? "uncertain" : "rejected";
    const message = submitted
      ? "O banco pode ter registrado o boleto, mas a confirmação não chegou. Não emita novamente. Confira no Sicoob e use Vincular pelo nosso número."
      : error instanceof BankError
        ? error.message
        : "Não foi possível enviar o boleto. Tente novamente.";
    // If persistence also fails, the durable "issuing" state still prevents another POST.
    await db
      .query("SELECT public.office_boleto_finish($1,$2,$3,'{}',$4)", [id, b.lease, state, message])
      .catch(() => {});
    throw new BankError(message, state);
  }
}
export async function handleBoleto(
  env: BoletoEnv,
  action: string,
  id: string,
  nossoNumero?: string,
) {
  const db = new pg.Client({
    connectionString: env.BANK_DATABASE_URL,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000,
  });
  try {
    await db.connect();
    if (action === "issue") return await issueBoleto(db, env, id);
    const b = (
      await db.query("SELECT public.office_boleto_read($1,$2) AS result", [
        id,
        env.BANK_CONNECTION_ID,
      ])
    ).rows[0].result as BoletoIntent | null;
    if (!b || !["issuing", "issued", "uncertain"].includes(b.state))
      throw new BankError("Emita o boleto antes de consultar.", "not_issued");
    const number = b.bank_data.nossoNumero || nossoNumero;
    if (!/^\d{1,20}$/.test(String(number)) || !Number(number))
      throw new BankError(
        "Confira no Sicoob e informe o nosso número para localizar a cobrança.",
        "missing_number",
      );
    const q = new URLSearchParams({
      numeroCliente: env.SICOOB_BENEFICIARY,
      codigoModalidade: "1",
      nossoNumero: String(number),
    });
    if (action === "pdf") q.set("gerarPdf", "true");
    const data = await bankJson(
      env.SICOOB_CERT,
      `${BOLETO_URL}${action === "pdf" ? "/segunda-via" : ""}?${q}`,
      { headers: await headers(env) },
    );
    const result = boletoResult(data, b, env.SICOOB_BENEFICIARY);
    // A second copy may not carry the current status. Never overwrite it with a default.
    if (action === "pdf") return { pdf: boletoPdf(data) };
    await db.query("SELECT public.office_boleto_refresh($1,$2,$3)", [
      id,
      env.BANK_CONNECTION_ID,
      JSON.stringify(result),
    ]);
    return { state: "issued", bank_data: result };
  } finally {
    await db.end().catch(() => {});
  }
}
