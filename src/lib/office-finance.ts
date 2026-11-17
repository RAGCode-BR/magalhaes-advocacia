import { addDays, addMonths, format, parseISO } from "date-fns";

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
  recurrence_frequency?: FinanceFrequency | null;
  installment: number;
  installment_count: number;
  competence_date: string;
  due_date: string;
  amount_cents: number;
  settled_cents: number;
  cost_center?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  import_batch_id?: string | null;
  source_status?: string | null;
  counterparty_name?: string | null;
  counterparty_document?: string | null;
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
  principal_cents?: number;
  interest_cents?: number;
  fine_cents?: number;
  discount_cents?: number;
  source_reconciled?: boolean;
  import_batch_id?: string | null;
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

export const financeFrequencies = {
  weekly: "Semanal", fortnightly: "A cada 14 dias", monthly: "Mensal",
  quarterly: "Trimestral", yearly: "Anual",
} as const;
export type FinanceFrequency = keyof typeof financeFrequencies;

export function financeRecurrences(options: {
  cents: number; frequency: FinanceFrequency; dueDate: string; competenceDate: string;
  count?: number; until?: string;
}) {
  const { cents, frequency, dueDate, competenceDate, count, until } = options;
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(parseISO(value).getTime())
    && format(parseISO(value), "yyyy-MM-dd") === value;
  if (!Number.isInteger(cents) || cents < 1 || cents > 2147483647)
    throw new Error("Informe um valor válido por ocorrência.");
  if (!Object.hasOwn(financeFrequencies, frequency) || !validDate(dueDate) || !validDate(competenceDate))
    throw new Error("Confira a frequência, a competência e o primeiro vencimento.");
  if (until ? (!validDate(until) || until < dueDate) : (!Number.isInteger(count) || count! < 1 || count! > 120))
    throw new Error("Defina de 1 a 120 ocorrências ou uma data final a partir do primeiro vencimento.");
  const advance = (date: string, index: number) => {
    const start = parseISO(date);
    const next = frequency === "weekly" || frequency === "fortnightly"
      ? addDays(start, index * (frequency === "weekly" ? 7 : 14))
      : addMonths(start, index * (frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12));
    return format(next, "yyyy-MM-dd");
  };
  const dates: string[] = [];
  for (let index = 0; index < (until ? 121 : count!); index++) {
    const date = advance(dueDate, index);
    if (until && date > until) break;
    dates.push(date);
  }
  if (dates.length > 120) throw new Error("Use um período de até 120 ocorrências.");
  return dates.map((date, index) => ({
    installment: index + 1, installment_count: dates.length,
    amount_cents: cents, due_date: date,
    competence_date: advance(competenceDate, index), recurrence_frequency: frequency,
  }));
}

export function financeStatus(entry: FinanceEntry, today: string) {
  if (entry.cancelled_at && entry.source_status === "Perdido/Desconsiderado")
    return "Desconsiderado";
  if (entry.cancelled_at) return "Cancelado";
  if (entry.settled_cents === entry.amount_cents) return "Quitado";
  if (entry.due_date < today) return entry.settled_cents ? "Parcial em atraso" : "Vencido";
  return entry.settled_cents ? "Parcial" : "Em aberto";
}

export function financeSettlementAmounts(
  principal: number,
  interest: number,
  fine: number,
  discount: number,
  remaining: number,
) {
  if (
    ![principal, interest, fine, discount].every(
      (n) => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647,
    ) ||
    principal <= 0 ||
    principal > remaining
  )
    throw new Error("Confira o principal e os ajustes da baixa.");
  const net = principal + interest + fine - discount;
  if (net <= 0 || net > 2147483647)
    throw new Error("O valor pago precisa ser positivo. Confira o desconto.");
  return {
    amount_cents: net,
    principal_cents: principal,
    interest_cents: interest,
    fine_cents: fine,
    discount_cents: discount,
  };
}

/** Cash received includes partial payments and adjustments. Outstanding values
 * consume principal only; a discounted invoice can be fully settled. */
export function financeLedgerBuckets(
  entries: FinanceEntry[],
  settlements: FinanceSettlement[],
  today: string,
) {
  const cash = new Map<string, number>();
  for (const s of settlements)
    if (!s.reversed_at) cash.set(s.entry_id, (cash.get(s.entry_id) ?? 0) + s.amount_cents);
  const buckets = {
    all: { cents: 0, count: 0 },
    overdue: { cents: 0, count: 0 },
    today: { cents: 0, count: 0 },
    upcoming: { cents: 0, count: 0 },
    settled: { cents: 0, count: 0 },
  };
  for (const e of entries) {
    buckets.all.count++;
    if (e.cancelled_at) continue;
    const paid = cash.get(e.id) ?? 0,
      remaining = e.amount_cents - e.settled_cents;
    buckets.all.cents += paid + remaining;
    if (paid > 0) {
      buckets.settled.cents += paid;
      buckets.settled.count++;
    }
    if (remaining > 0) {
      const bucket = e.due_date < today ? "overdue" : e.due_date === today ? "today" : "upcoming";
      buckets[bucket].cents += remaining;
      buckets[bucket].count++;
    }
  }
  return { buckets, cash };
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
  /** Chart-of-accounts code such as "1.1.02" (categories only). */
  code?: string | null;
  /** Receita or despesa (categories only); empty means both. */
  nature?: FinanceKind | null;
};

/** Sorts plan items by numeric code ("1.2" before "1.10"); uncoded items last. */
export function financePlanSort(a: FinanceRegister, b: FinanceRegister) {
  if (a.code && b.code) {
    const x = a.code.split(".").map(Number);
    const y = b.code.split(".").map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === undefined) return -1;
      if (y[i] === undefined) return 1;
      if (x[i] !== y[i]) return x[i] - y[i];
    }
    return 0;
  }
  if (a.code) return -1;
  if (b.code) return 1;
  return a.name.localeCompare(b.name, "pt-BR");
}

export const financePlanDepth = (code?: string | null) => (code ? code.split(".").length - 1 : 0);

/** Plan items usable for an entry of this kind, in plan order. */
export function financePlanOptions(registers: FinanceRegister[], kind: FinanceKind) {
  return registers
    .filter(
      (item) => item.kind === "category" && item.active && (!item.nature || item.nature === kind),
    )
    .sort(financePlanSort);
}
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
  created_at?: string;
  proposal?: unknown;
  crm_opportunity_id?: string | null;
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

// Suggested chart of accounts for a law office. Existing items with the same name are
// kept (same id) and only receive the code and nature.
export const SUGGESTED_PLAN: { code: string; name: string; nature: FinanceKind }[] = [
  { code: "1", name: "Receitas", nature: "income" },
  { code: "1.1", name: "Honorários", nature: "income" },
  { code: "1.2", name: "Honorários de êxito", nature: "income" },
  { code: "1.3", name: "Honorários de sucumbência", nature: "income" },
  { code: "1.4", name: "Assessoria mensal", nature: "income" },
  { code: "1.5", name: "Reembolso de despesas de clientes", nature: "income" },
  { code: "1.6", name: "Rendimentos financeiros", nature: "income" },
  { code: "1.9", name: "Outras receitas", nature: "income" },
  { code: "2", name: "Despesas", nature: "expense" },
  { code: "2.1", name: "Pessoal", nature: "expense" },
  { code: "2.1.01", name: "Salários e encargos", nature: "expense" },
  { code: "2.1.02", name: "Pró-labore", nature: "expense" },
  { code: "2.1.03", name: "Estagiários", nature: "expense" },
  { code: "2.2", name: "Ocupação", nature: "expense" },
  { code: "2.2.01", name: "Aluguel e condomínio", nature: "expense" },
  { code: "2.2.02", name: "Energia, água e internet", nature: "expense" },
  { code: "2.3", name: "Administrativas", nature: "expense" },
  { code: "2.3.01", name: "Material de escritório", nature: "expense" },
  { code: "2.3.02", name: "Softwares e sistemas", nature: "expense" },
  { code: "2.3.03", name: "Contabilidade", nature: "expense" },
  { code: "2.4", name: "Custas e despesas processuais", nature: "expense" },
  { code: "2.4.01", name: "Custas judiciais", nature: "expense" },
  { code: "2.4.02", name: "Diligências e deslocamentos", nature: "expense" },
  { code: "2.5", name: "Tributos e anuidades", nature: "expense" },
  { code: "2.5.01", name: "Impostos sobre faturamento", nature: "expense" },
  { code: "2.5.02", name: "Anuidade OAB", nature: "expense" },
  { code: "2.6", name: "Despesas bancárias", nature: "expense" },
  { code: "2.6.01", name: "Tarifas bancárias", nature: "expense" },
  { code: "2.6.02", name: "Juros e IOF", nature: "expense" },
  { code: "2.7", name: "Marketing", nature: "expense" },
  { code: "2.9", name: "Outras despesas", nature: "expense" },
];

/** Daily consolidated balance of active accounts for the last `days` days. */
export function financeBalanceSeries(
  accounts: FinanceAccount[],
  entries: FinanceEntry[],
  settlements: FinanceSettlement[],
  transfers: FinanceTransfer[],
  today: string,
  days = 90,
) {
  const active = accounts.filter((account) => account.active);
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(`${today}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - (days - 1 - index));
    const date = day.toISOString().slice(0, 10);
    return {
      date,
      cents: active.reduce(
        (sum, account) =>
          sum + financeAccountBalance(account, entries, settlements, transfers, date),
        0,
      ),
    };
  });
}

export type FinanceDreRow = {
  name: string;
  code: string | null;
  depth: number;
  group: boolean;
  values: number[];
};

/**
 * Management income statement (DRE gerencial): one row per chart-of-accounts item
 * per month. Group accounts add up their sub-accounts; root groups are omitted
 * because the Receitas/Despesas totals already show them. Categories outside the
 * plan are listed after it.
 */
export function financeDre(
  entries: FinanceEntry[],
  settlements: FinanceSettlement[],
  registers: FinanceRegister[],
  months: string[],
  basis: "cash" | "competence",
) {
  const amounts: Record<FinanceKind, Map<string, number[]>> = {
    income: new Map(),
    expense: new Map(),
  };
  const add = (entry: FinanceEntry, date: string, cents: number) => {
    const index = months.indexOf(date.slice(0, 7));
    if (index < 0) return;
    const map = amounts[entry.kind];
    const row = map.get(entry.category) ?? months.map(() => 0);
    row[index] += cents;
    map.set(entry.category, row);
  };
  if (basis === "competence") {
    for (const entry of entries)
      if (!entry.cancelled_at) add(entry, entry.competence_date, entry.amount_cents);
  } else {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    for (const settlement of settlements) {
      const entry = byId.get(settlement.entry_id);
      if (entry && !settlement.reversed_at)
        add(entry, settlement.settled_on, settlement.amount_cents);
    }
  }
  const build = (kind: FinanceKind) => {
    const map = amounts[kind];
    const plan = registers
      .filter(
        (item) => item.kind === "category" && item.code && (!item.nature || item.nature === kind),
      )
      .sort(financePlanSort);
    const codes = plan.map((item) => item.code ?? "");
    const rows: FinanceDreRow[] = [];
    const used = new Set<string>();
    for (const item of plan) {
      const code = item.code ?? "";
      const group = codes.some((other) => other.startsWith(code + "."));
      const depth = financePlanDepth(code);
      if (group && depth === 0) continue;
      const members = plan.filter(
        (other) => other.code === code || (other.code ?? "").startsWith(code + "."),
      );
      const values = months.map((_, index) =>
        members.reduce((sum, member) => sum + (map.get(member.name)?.[index] ?? 0), 0),
      );
      used.add(item.name);
      if (values.some(Boolean))
        rows.push({ name: item.name, code, depth: Math.max(0, depth - 1), group, values });
    }
    for (const [name, values] of [...map.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], "pt-BR"),
    ))
      if (!used.has(name)) rows.push({ name, code: null, depth: 0, group: false, values });
    const total = months.map((_, index) =>
      [...map.values()].reduce((sum, values) => sum + values[index], 0),
    );
    return { rows, total };
  };
  const income = build("income");
  const expense = build("expense");
  return {
    income,
    expense,
    result: months.map((_, index) => income.total[index] - expense.total[index]),
  };
}
