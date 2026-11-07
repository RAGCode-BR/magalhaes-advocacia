import { addMonths, format, parseISO } from "date-fns";

export type FinanceKind = "income" | "expense";

export type FinanceEntry = {
  id: string;
  kind: FinanceKind;
  description: string;
  category: string;
  supplier: string | null;
  notes: string | null;
  client_id: string | null;
  process_id: string | null;
  installment: number;
  installment_count: number;
  competence_date: string;
  due_date: string;
  amount_cents: number;
  settled_cents: number;
  cost_center?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
};

export type FinanceSettlement = {
  id: string;
  entry_id: string;
  amount_cents: number;
  settled_on: string;
  account_id?: string | null;
  payment_method?: string;
  reversed_at?: string | null;
  reversal_reason?: string | null;
};

export function financeCents(value: string) {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return 0;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents <= 2147483647 ? cents : 0;
}

export function financeInstallments(cents: number, count: number, dueDate: string) {
  if (!Number.isInteger(count) || count < 1 || count > 120 || cents < count) {
    throw new Error("Informe de 1 a 120 parcelas com pelo menos R$ 0,01 cada.");
  }
  const base = Math.floor(cents / count);
  return Array.from({ length: count }, (_, index) => ({
    installment: index + 1,
    installment_count: count,
    amount_cents: base + Number(index < cents % count),
    due_date: format(addMonths(parseISO(dueDate), index), "yyyy-MM-dd"),
  }));
}

export function financeStatus(entry: FinanceEntry, today: string) {
  if (entry.cancelled_at) return "Cancelado";
  if (entry.settled_cents === entry.amount_cents) return "Quitado";
  if (entry.due_date < today) return entry.settled_cents ? "Parcial em atraso" : "Vencido";
  return entry.settled_cents ? "Parcial" : "Em aberto";
}

export function financeTotals(
  entries: FinanceEntry[],
  settlements: FinanceSettlement[],
  month: string,
  basis: "cash" | "competence",
) {
  const totals = { income: 0, expense: 0 };
  if (basis === "competence") {
    for (const entry of entries) {
      if (!entry.cancelled_at && entry.competence_date.startsWith(month))
        totals[entry.kind] += entry.amount_cents;
    }
  } else {
    const kinds = new Map(entries.map((entry) => [entry.id, entry.kind]));
    for (const settlement of settlements) {
      const kind = kinds.get(settlement.entry_id);
      if (kind && !settlement.reversed_at && settlement.settled_on.startsWith(month))
        totals[kind] += settlement.amount_cents;
    }
  }
  return { ...totals, balance: totals.income - totals.expense };
}

export type FinanceAccount = {
  id: string;
  name: string;
  opening_cents: number;
  opening_date: string;
  active: boolean;
};
export type FinanceRegister = {
  id: string;
  kind: "supplier" | "category" | "cost_center";
  name: string;
  contact: string | null;
  notes: string | null;
  active: boolean;
};
export type FinanceAgreement = {
  id: string;
  kind: "quote" | "recurring";
  status: "draft" | "approved" | "rejected" | "active" | "closed";
  description: string;
  client_id: string | null;
  process_id: string | null;
  amount_cents: number;
  periods: number;
  first_due: string;
  competence_date: string;
  category: string;
  cost_center: string | null;
  notes: string | null;
  generated_at: string | null;
};
export type FinanceTransfer = {
  id: string;
  from_account: string;
  to_account: string;
  amount_cents: number;
  transferred_on: string;
  description: string;
};

export type FinanceService = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  active: boolean;
};
export type FinanceOrder = {
  id: string;
  kind: "service" | "purchase";
  status: "draft" | "in_progress" | "completed" | "cancelled";
  description: string;
  client_id: string | null;
  process_id: string | null;
  supplier: string | null;
  category: string;
  cost_center: string | null;
  notes: string | null;
  total_cents: number;
  discount_cents: number;
  installments: number;
  competence_date: string;
  first_due: string;
  start_date: string;
  expected_date: string;
  responsible: string | null;
  generated_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
};
export type FinanceOrderItem = {
  id: string;
  order_id: string;
  service_id: string | null;
  description: string;
  quantity: number;
  unit_cents: number;
};

export function financeOrderTotal(
  items: Pick<FinanceOrderItem, "quantity" | "unit_cents">[],
  discount: number,
) {
  if (!items.length || items.length > 200) throw new Error("Adicione de 1 a 200 itens ao pedido.");
  let gross = 0;
  for (const item of items) {
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 10000 ||
      !Number.isInteger(item.unit_cents) ||
      item.unit_cents < 0 ||
      item.unit_cents > 2147483647
    )
      throw new Error("Revise a quantidade e o preço dos itens.");
    gross += item.quantity * item.unit_cents;
    if (!Number.isSafeInteger(gross)) throw new Error("O valor dos itens é muito alto.");
  }
  const total = gross - discount;
  if (!Number.isInteger(discount) || discount < 0 || total < 1 || total > 2147483647)
    throw new Error("O desconto deve ser menor que o total. Confira o valor líquido.");
  return { gross, discount, total };
}

export function financeAccountBalance(
  account: FinanceAccount,
  entries: FinanceEntry[],
  settlements: FinanceSettlement[],
  transfers: FinanceTransfer[],
  until: string,
) {
  if (until < account.opening_date) return 0;
  const kinds = new Map(entries.map((entry) => [entry.id, entry.kind]));
  let balance = Number(account.opening_cents);
  for (const settlement of settlements) {
    if (
      settlement.account_id !== account.id ||
      settlement.reversed_at ||
      settlement.settled_on > until ||
      settlement.settled_on < account.opening_date
    )
      continue;
    const kind = kinds.get(settlement.entry_id);
    if (kind) balance += (kind === "income" ? 1 : -1) * settlement.amount_cents;
  }
  for (const transfer of transfers) {
    if (transfer.transferred_on > until || transfer.transferred_on < account.opening_date) continue;
    if (transfer.from_account === account.id) balance -= transfer.amount_cents;
    if (transfer.to_account === account.id) balance += transfer.amount_cents;
  }
  return balance;
}

export function financeCsv(rows: unknown[][]) {
  // Prefix spreadsheet formulas in user-authored text before quoting fields.
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = String(value ?? "");
            if (/^[=+@\-\t\r]/.test(text) && !/^[+-]?\d+(?:[.,]\d+)?$/.test(text))
              text = "'" + text;
            return '"' + text.replace(/"/g, '""') + '"';
          })
          .join(";"),
      )
      .join("\r\n")
  );
}

export function financeDailyFlow(
  entries: FinanceEntry[],
  settlements: FinanceSettlement[],
  month: string,
) {
  const days = new Map<
    string,
    { income: number; expense: number; pendingIncome: number; pendingExpense: number }
  >();
  const kinds = new Map(entries.map((entry) => [entry.id, entry.kind]));
  const dayFor = (date: string) => {
    let day = days.get(date);
    if (!day) {
      day = { income: 0, expense: 0, pendingIncome: 0, pendingExpense: 0 };
      days.set(date, day);
    }
    return day;
  };
  for (const settlement of settlements) {
    const kind = kinds.get(settlement.entry_id);
    if (kind && !settlement.reversed_at && settlement.settled_on.startsWith(month)) {
      dayFor(settlement.settled_on)[kind] += settlement.amount_cents;
    }
  }
  for (const entry of entries) {
    const remaining = entry.amount_cents - entry.settled_cents;
    if (!entry.cancelled_at && remaining > 0 && entry.due_date.startsWith(month)) {
      const day = dayFor(entry.due_date);
      if (entry.kind === "income") day.pendingIncome += remaining;
      else day.pendingExpense += remaining;
    }
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amounts]) => ({
      date,
      ...amounts,
      actual: amounts.income - amounts.expense,
      projected: amounts.income - amounts.expense + amounts.pendingIncome - amounts.pendingExpense,
    }));
}
