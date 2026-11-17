import { supabase } from "@/integrations/supabase/client";
import { financeRpc } from "./office-finance-data";

export type BankTransaction = {
  id: string;
  booked_on: string;
  description: string;
  amount_cents: number;
  settlement_id: string | null;
  reconciled_at: string | null;
};
export type BankCursor = { date: string; id: string };
export type BankOverview = {
  connection: null | {
    id: string;
    account_id: string;
    name: string;
    enabled: boolean;
    last_success_at: string | null;
    last_error: string | null;
    syncing_since: string | null;
  };
  rows: BankTransaction[];
  totals?: { credits: number; debits: number; count: number; pending: number };
  balances?: Record<string, { amount_cents: number; observed_at: string }>;
};
export type BankCandidate = {
  id: string;
  settled_on: string;
  amount_cents: number;
  description: string;
  client_name: string | null;
};

export async function loadBankOverview(
  month: string,
  status: string,
  cursor?: BankCursor,
): Promise<BankOverview> {
  return (await financeRpc("office_bank_overview", {
    p_month: `${month}-01`,
    p_status: status,
    p_before_date: cursor?.date ?? null,
    p_before_id: cursor?.id ?? null,
  })) as unknown as BankOverview;
}

export async function synchronizeBank(
  month: string,
): Promise<{ busy: boolean; count?: number; message?: string }> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token)
    throw new Error("Entre novamente para atualizar o extrato.");
  const response = await fetch("https://magalhaes-sicoob.ragcodebr.workers.dev/sync", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ month }),
    signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível atualizar o Sicoob.");
  return result;
}

export function isSicoobAccount(name: string | null | undefined) {
  return /sicoob|sicob/i.test(name ?? "");
}

// Groups bank descriptions such as "PIX RECEBIDO 12/11 FULANO" into "Pix recebido".
export function bankHistoryGroup(description: string) {
  const words = description
    .replace(/[0-9./:-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(" ")
    .toLocaleLowerCase("pt-BR");
  return words ? words[0].toLocaleUpperCase("pt-BR") + words.slice(1) : "Sem histórico";
}
