import { describe, expect, it } from "vitest";
import { bankHistoryGroup } from "./office-bank";
import {
  financeDre,
  financePlanSort,
  type FinanceRegister as PlanItem,
  financeCents,
  financeInstallments,
  financeStatus,
  financeTotals,
  financeOrderTotal,
  type FinanceEntry,
} from "./office-finance";

const entry: FinanceEntry = {
  id: "honorario",
  kind: "income",
  description: "Honorários",
  category: "Honorários",
  supplier: null,
  notes: null,
  client_id: "cliente",
  process_id: null,
  installment: 1,
  installment_count: 1,
  competence_date: "2026-01-25",
  due_date: "2026-02-28",
  amount_cents: 10000,
  settled_cents: 2500,
};

describe("office finance", () => {
  it("calculates item totals in cents and rejects discounts or quantities that cannot be financed", () => {
    expect(
      financeOrderTotal(
        [
          { quantity: 3, unit_cents: 3333 },
          { quantity: 1, unit_cents: 1 },
        ],
        500,
      ),
    ).toEqual({ gross: 10000, discount: 500, total: 9500 });
    expect(() => financeOrderTotal([{ quantity: 1, unit_cents: 100 }], 100)).toThrow();
    expect(() => financeOrderTotal([{ quantity: 1.5, unit_cents: 100 }], 0)).toThrow();
    expect(() => financeOrderTotal([{ quantity: 10000, unit_cents: 2147483647 }], 0)).toThrow();
    expect(() => financeOrderTotal([{ quantity: 1, unit_cents: 100 }], -1)).toThrow();
    expect(() => financeOrderTotal([], 0)).toThrow();
  });
  it("allocates every cent and preserves the original day when possible", () => {
    const rows = financeInstallments(financeCents("100,00"), 3, "2026-01-31");
    expect(rows.map((row) => row.amount_cents)).toEqual([3334, 3333, 3333]);
    expect(rows.map((row) => row.due_date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(() => financeInstallments(2, 3, "2026-01-31")).toThrow();
    expect(financeCents("10,001")).toBe(0);
  });

  it("separates accrual from partial cash settlements", () => {
    const payments = [
      { id: "baixa", entry_id: entry.id, amount_cents: 2500, settled_on: "2026-03-01" },
    ];
    expect(financeTotals([entry], payments, "2026-01", "competence").income).toBe(10000);
    expect(financeTotals([entry], payments, "2026-01", "cash").income).toBe(0);
    expect(financeTotals([entry], payments, "2026-03", "cash").income).toBe(2500);
    expect(financeStatus(entry, "2026-03-01")).toBe("Parcial em atraso");
  });
});

describe("finance account balances and exports", () => {
  it("keeps opening balance, transfers and settlements separate from revenue totals", async () => {
    const { financeAccountBalance, financeCsv, financeDailyFlow } =
      await import("./office-finance");
    const payment = {
      id: "payment",
      entry_id: entry.id,
      amount_cents: 2500,
      settled_on: "2026-03-01",
      account_id: "bank",
    };
    const account = {
      id: "bank",
      name: "Conta",
      opening_cents: 1000,
      opening_date: "2026-01-01",
      active: true,
    };
    const transfer = {
      id: "transfer",
      from_account: "bank",
      to_account: "cash",
      amount_cents: 500,
      transferred_on: "2026-03-01",
      description: "Registro",
    };
    expect(financeAccountBalance(account, [entry], [payment], [transfer], "2026-03-01")).toBe(3000);
    expect(
      financeAccountBalance(
        account,
        [entry],
        [{ ...payment, reversed_at: "2026-03-01" }],
        [transfer],
        "2026-03-01",
      ),
    ).toBe(500);
    expect(financeDailyFlow([entry], [payment], "2026-03")[0].income).toBe(2500);
    expect(financeDailyFlow([{ ...entry, cancelled_at: "2026-02-01" }], [], "2026-02")).toEqual([]);
    expect(financeCsv([["=HYPERLINK(1)", "-20,50", 'Nome "citado"']])).toContain(
      '"' + "'=HYPERLINK(1)" + '";"-20,50";"Nome ""citado"""',
    );
  });
});

describe("chart of accounts and DRE", () => {
  const plan = (code: string, name: string, nature: "income" | "expense"): PlanItem => ({
    id: code,
    kind: "category",
    name,
    code,
    nature,
    contact: null,
    notes: null,
    active: true,
  });
  const registers = [
    plan("2", "Despesas", "expense"),
    plan("2.10", "Marketing", "expense"),
    plan("2.2", "Ocupação", "expense"),
    plan("2.2.01", "Aluguel", "expense"),
    plan("1", "Receitas", "income"),
    plan("1.1", "Honorários", "income"),
  ];

  it("orders codes numerically, so 2.2 comes before 2.10", () => {
    expect([...registers].sort(financePlanSort).map((item) => item.code)).toEqual([
      "1",
      "1.1",
      "2",
      "2.2",
      "2.2.01",
      "2.10",
    ]);
  });

  it("adds sub-accounts into their group and keeps categories outside the plan", () => {
    const entry = (id: string, kind: "income" | "expense", category: string, cents: number) => ({
      id,
      kind,
      description: id,
      category,
      supplier: null,
      notes: null,
      client_id: null,
      process_id: null,
      installment: 1,
      installment_count: 1,
      competence_date: "2026-11-05",
      due_date: "2026-11-05",
      amount_cents: cents,
      settled_cents: cents,
    });
    const entries = [
      entry("a", "income", "Honorários", 10000),
      entry("b", "expense", "Aluguel", 3000),
      entry("c", "expense", "Cafezinho", 500),
    ];
    const settlements = entries.map((e) => ({
      id: "s" + e.id,
      entry_id: e.id,
      amount_cents: e.amount_cents,
      settled_on: "2026-11-05",
    }));
    const dre = financeDre(entries, settlements, registers, ["2026-10", "2026-11"], "cash");
    expect(dre.income.total).toEqual([0, 10000]);
    expect(dre.expense.rows.map((row) => [row.name, row.group, row.values[1]])).toEqual([
      ["Ocupação", true, 3000],
      ["Aluguel", false, 3000],
      ["Cafezinho", false, 500],
    ]);
    expect(dre.result).toEqual([0, 6500]);
  });

  it("groups bank descriptions by their first words", () => {
    expect(bankHistoryGroup("PIX RECEBIDO 12/11 FULANO")).toBe("PIX recebido");
    expect(bankHistoryGroup("APLICAÇÃO RDC")).toBe("Aplicação RDC");
    expect(bankHistoryGroup("123")).toBe("Sem histórico");
  });
});

describe("bank descriptions", () => {
  it("turns raw Sicoob histories into a readable title and counterpart", async () => {
    const { bankDescriptionParts } = await import("./office-bank");
    expect(
      bankDescriptionParts(
        "PIX RECEBIDO - OUTRA IF · Recebimento Pix|@ANA PAULA DA CRUZ MAGALHAES|@***.661.831-**|@",
      ),
    ).toEqual({ title: "PIX recebido - outra IF", detail: "Ana Paula da Cruz Magalhaes" });
    expect(bankDescriptionParts("RESGATE RDC AUTOMÁTICO")).toEqual({
      title: "Resgate RDC automático",
      detail: "",
    });
  });
});
