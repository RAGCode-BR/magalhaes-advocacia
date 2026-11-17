export const TOKEN_URL =
  "https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token";
export const API_URL = "https://api.sicoob.com.br/conta-corrente/v4/";
export type BankRow = {
  external_id: string;
  booked_on: string;
  description: string;
  amount_cents: number;
};
export type BankBalance = { kind: "ledger" | "blocked" | "credit_limit"; amount_cents: number };

export class BankError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export function bankCents(value: unknown): number {
  // Sicoob v4 returns decimal strings, with a dot and no grouping separators.
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match)
    throw new BankError(
      "Valor bancário inválido. A importação foi interrompida.",
      "invalid_amount",
    );
  const absolute = BigInt(match[2]) * 100n + BigInt((match[3] || "").padEnd(2, "0"));
  const cents = match[1] ? -absolute : absolute;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER))
    throw new BankError("Valor bancário fora do limite suportado.", "unsafe_amount");
  return Number(cents);
}

export function bankMonth(value: string, today = new Date()): { from: string; through: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
    throw new BankError("Selecione um mês válido.", "invalid_month");
  const current = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(today);
  if (value > current.slice(0, 7) || Number(value.slice(0, 4)) < Number(current.slice(0, 4)) - 5)
    throw new BankError("Selecione um mês passado ou o mês atual.", "invalid_month");
  const last = new Date(
    Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 0),
  ).getUTCDate();
  return {
    from: `${value}-01`,
    through: value === current.slice(0, 7) ? current : `${value}-${last}`,
  };
}

export function bankRows(body: any, month: string): BankRow[] {
  const rows = body?.resultado?.transacoes;
  if (!Array.isArray(rows) || rows.length > 10000 || body?.links?.next)
    throw new BankError(
      "Extrato incompleto ou fora do limite. Nenhum lançamento foi importado.",
      "invalid_statement",
    );
  const seen = new Set<string>();
  return rows.map((row): BankRow => {
    const id = row.transactionId;
    const day = typeof row.data === "string" ? row.data.slice(0, 10) : "";
    const parsed = new Date(`${day}T12:00:00Z`);
    if (
      typeof id !== "string" ||
      !id.trim() ||
      id.length > 256 ||
      seen.has(id) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !day.startsWith(`${month}-`) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== day ||
      !["CREDITO", "DEBITO"].includes(row.tipo)
    )
      throw new BankError(
        "Identificador, data ou tipo de movimentação inválido. Revise o extrato com o banco.",
        "invalid_transaction",
      );
    seen.add(id);
    const value = bankCents(row.valor);
    if (value <= 0)
      throw new BankError("Movimentação com valor não positivo.", "invalid_transaction");
    const description = [row.descricao, row.descInfComplementar]
      .filter((x) => typeof x === "string" && x.trim())
      .join(" · ")
      .trim()
      .slice(0, 1000);
    if (!description) throw new BankError("Movimentação sem descrição.", "invalid_transaction");
    return {
      external_id: id,
      booked_on: day,
      description,
      amount_cents: row.tipo === "DEBITO" ? -value : value,
    };
  });
}

export function bankBalances(body: any): BankBalance[] {
  const r = body?.resultado;
  return [
    { kind: "ledger", amount_cents: bankCents(r?.saldo) },
    { kind: "blocked", amount_cents: bankCents(r?.saldoBloqueado) },
    { kind: "credit_limit", amount_cents: bankCents(r?.saldoLimite) },
  ];
}

export interface MtlsFetcher {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}
export async function bankJson(fetcher: MtlsFetcher, url: string, init: RequestInit): Promise<any> {
  const response = await fetcher.fetch(url, {
    ...init,
    // Workers implements manual/follow only. Non-2xx below rejects redirects
    // without sending the token or client certificate to another destination.
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new BankError(
      `O Sicoob recusou a consulta (HTTP ${response.status}). Tente novamente ou confira o acesso da conta.`,
      `http_${response.status}`,
    );
  return response.json();
}
