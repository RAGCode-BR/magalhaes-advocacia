import { supabase } from "@/integrations/supabase/client";
import type {
  FinanceEntry,
  FinanceSettlement,
  FinanceAccount,
  FinanceRegister,
  FinanceAgreement,
  FinanceTransfer,
  FinanceService,
  FinanceOrder,
  FinanceOrderItem,
} from "./office-finance";

export const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const isoToday = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
export const currency = (cents: number) => money.format(cents / 100);
export const displayDate = (value: string) => value.split("-").reverse().join("/");
export const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
export const fieldClass = "grid gap-1.5 text-sm font-medium";
export type DocumentInfo = { id: string; entry_id: string; filename: string };
export type FinanceHistory = {
  id: string;
  entity_id: string;
  entity_type: string;
  action: string;
  created_at: string;
  created_by: string;
};
export type FinanceTable =
  | "office_finance_entries"
  | "office_finance_settlements"
  | "office_finance_documents"
  | "office_finance_accounts"
  | "office_finance_registers"
  | "office_finance_agreements"
  | "office_finance_transfers"
  | "office_finance_history"
  | "office_finance_services"
  | "office_finance_orders"
  | "office_finance_order_items";

// Database types are generated separately for the original application schema.
export const table = (name: FinanceTable) => supabase.from(name as never);

export async function financeRows<T>(name: FinanceTable, columns = "*"): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await table(name)
      .select(columns)
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function financeRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  return data;
}

export async function loadOfficeFinance() {
  const [entries, settlements, documents, accounts, registers, agreements, transfers] =
    await Promise.all([
      financeRows<FinanceEntry>("office_finance_entries"),
      financeRows<FinanceSettlement>("office_finance_settlements"),
      financeRows<DocumentInfo>("office_finance_documents", "id,entry_id,filename"),
      financeRows<FinanceAccount>("office_finance_accounts"),
      financeRows<FinanceRegister>("office_finance_registers"),
      financeRows<FinanceAgreement>("office_finance_agreements"),
      financeRows<FinanceTransfer>("office_finance_transfers"),
    ]);
  return { entries, settlements, documents, accounts, registers, agreements, transfers };
}

export type OfficeFinanceData = Awaited<ReturnType<typeof loadOfficeFinance>>;

// Load the new module independently so older databases can still open the ledger.
export async function loadFinanceOrders() {
  const [services, orders, items] = await Promise.all([
    financeRows<FinanceService>("office_finance_services"),
    financeRows<FinanceOrder>("office_finance_orders"),
    financeRows<FinanceOrderItem>("office_finance_order_items"),
  ]);
  return { services, orders, items };
}

export function saveCsv(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
