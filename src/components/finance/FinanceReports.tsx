import { useState } from "react";
import { addDays, addMonths, format, parseISO } from "date-fns";
import { useClients, useProfiles } from "@/hooks/use-data";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  financeAccountBalance,
  financeCsv,
  financeDre,
  financeDailyFlow,
  financeTotals,
  type FinanceEntry,
} from "@/lib/office-finance";
import {
  currency,
  displayDate,
  isoToday,
  selectClass,
  saveCsv,
  financeRows,
  type OfficeFinanceData,
  type FinanceHistory,
} from "@/lib/office-finance-data";
import { Amount, DetailRows, KpiStrip, Sheet, SheetGutter, type DetailRow } from "./FinanceSheet";
import { FinanceFlowChart, FinanceShareBars } from "./FinanceBalanceChart";
import { ptBR } from "date-fns/locale";

export function FinanceReports({ ledger }: { ledger: OfficeFinanceData }) {
  const [month, setMonth] = useState(isoToday().slice(0, 7));
  const [basis, setBasis] = useState<"cash" | "competence">("cash");
  const [group, setGroup] = useState<"category" | "cost_center" | "client_id">("category");
  const { data: clients = [] } = useClients();
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const months = Array.from({ length: 12 }, (_, index) =>
    format(addMonths(parseISO(month + "-01"), index - 11), "yyyy-MM"),
  );
  const monthly = months.map((period) => ({
    period,
    ...financeTotals(ledger.entries, ledger.settlements, period, basis),
  }));
  const daily = financeDailyFlow(ledger.entries, ledger.settlements, month);
  const entriesById = new Map(ledger.entries.map((entry) => [entry.id, entry]));
  const grouped = new Map<string, { income: number; expense: number }>();
  function accumulate(entry: FinanceEntry, amount: number) {
    const name =
      group === "client_id"
        ? (clientNames.get(entry.client_id ?? "") ?? entry.counterparty_name ?? "Sem cliente")
        : entry[group] || "Sem centro de custo";
    const totals = grouped.get(name) ?? { income: 0, expense: 0 };
    totals[entry.kind] += amount;
    grouped.set(name, totals);
  }
  if (basis === "competence") {
    ledger.entries
      .filter((entry) => !entry.cancelled_at && entry.competence_date.startsWith(month))
      .forEach((entry) => accumulate(entry, entry.amount_cents));
  } else {
    ledger.settlements
      .filter((settlement) => !settlement.reversed_at && settlement.settled_on.startsWith(month))
      .forEach((settlement) => {
        const entry = entriesById.get(settlement.entry_id);
        if (entry) accumulate(entry, settlement.amount_cents);
      });
  }
  const groupedRows = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  function exportReport() {
    saveCsv(
      financeCsv([
        ["Regime", basis === "cash" ? "Caixa" : "Competência"],
        ["Mês", "Receitas (R$)", "Despesas (R$)", "Resultado (R$)"],
        ...monthly.map((item) => [
          item.period,
          (item.income / 100).toFixed(2).replace(".", ","),
          (item.expense / 100).toFixed(2).replace(".", ","),
          (item.balance / 100).toFixed(2).replace(".", ","),
        ]),
        [],
        ["Detalhamento", month],
        ["Grupo", "Receitas (R$)", "Despesas (R$)", "Resultado (R$)"],
        ...groupedRows.map(([name, item]) => [
          name,
          (item.income / 100).toFixed(2).replace(".", ","),
          (item.expense / 100).toFixed(2).replace(".", ","),
          ((item.income - item.expense) / 100).toFixed(2).replace(".", ","),
        ]),
      ]),
      `financeiro-${month}.csv`,
    );
  }
  const current = monthly.at(-1) ?? { income: 0, expense: 0, balance: 0 };
  const previous = monthly.at(-2) ?? { income: 0, expense: 0, balance: 0 };
  const margin = current.income ? Math.round((current.balance / current.income) * 100) : null;
  const incomeChange = previous.income
    ? Math.round(((current.income - previous.income) / previous.income) * 100)
    : null;
  const yearIncome = monthly.reduce((sum, item) => sum + item.income, 0);
  const yearExpense = monthly.reduce((sum, item) => sum + item.expense, 0);
  const openReceivable = ledger.entries
    .filter((entry) => entry.kind === "income" && !entry.cancelled_at)
    .reduce((sum, entry) => sum + entry.amount_cents - entry.settled_cents, 0);
  const overdueReceivable = ledger.entries
    .filter(
      (entry) => entry.kind === "income" && !entry.cancelled_at && entry.due_date < isoToday(),
    )
    .reduce((sum, entry) => sum + entry.amount_cents - entry.settled_cents, 0);
  const monthLabel = (period: string) =>
    format(parseISO(period + "-01"), "MMM/yy", { locale: ptBR }).replace(/^./, (c) =>
      c.toUpperCase(),
    );
  const share = (kind: "income" | "expense") =>
    groupedRows
      .map(([name, totals]) => ({ name, cents: totals[kind] }))
      .filter((row) => row.cents > 0)
      .sort((x, y) => y.cents - x.cents)
      .slice(0, 8);
  const groupName =
    group === "category"
      ? "conta do plano"
      : group === "cost_center"
        ? "centro de custo"
        : "cliente";
  const dreMonths = months.slice(-6);
  const dre = financeDre(ledger.entries, ledger.settlements, ledger.registers, dreMonths, basis);
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const dreIncome = sum(dre.income.total);
  const percentOf = (value: number) =>
    dreIncome ? `${Math.round((value / dreIncome) * 1000) / 10}%` : "–";
  // Records behind the month indicators, following the chosen basis.
  const monthRows = (kind: "income" | "expense"): DetailRow[] =>
    basis === "cash"
      ? ledger.settlements
          .filter((item) => !item.reversed_at && item.settled_on.startsWith(month))
          .flatMap((item) => {
            const entry = entriesById.get(item.entry_id);
            return entry && entry.kind === kind
              ? [
                  {
                    key: item.id,
                    date: item.settled_on,
                    title: entry.description,
                    subtitle: [
                      clientNames.get(entry.client_id ?? "") ?? entry.counterparty_name,
                      entry.category,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                    value: currency(item.amount_cents),
                  },
                ]
              : [];
          })
          .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
      : ledger.entries
          .filter(
            (entry) =>
              entry.kind === kind && !entry.cancelled_at && entry.competence_date.startsWith(month),
          )
          .sort((a, b) => a.competence_date.localeCompare(b.competence_date))
          .map((entry) => ({
            key: entry.id,
            date: entry.competence_date,
            title: entry.description,
            subtitle: [
              clientNames.get(entry.client_id ?? "") ?? entry.counterparty_name,
              entry.category,
            ]
              .filter(Boolean)
              .join(" · "),
            value: currency(entry.amount_cents),
          }));
  const openReceivableRows: DetailRow[] = ledger.entries
    .filter(
      (entry) =>
        entry.kind === "income" && !entry.cancelled_at && entry.amount_cents > entry.settled_cents,
    )
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .map((entry) => ({
      key: entry.id,
      date: entry.due_date,
      title: entry.description,
      subtitle: `${clientNames.get(entry.client_id ?? "") ?? entry.counterparty_name ?? "Sem cliente"}${entry.due_date < isoToday() ? " · vencido" : ""}`,
      value: currency(entry.amount_cents - entry.settled_cents),
    }));
  const basisNote =
    basis === "cash"
      ? "Regime de caixa: baixas registradas no mês."
      : "Regime de competência: lançamentos cuja competência é o mês, recebidos ou não.";
  const pct = (value: number | null) => (value === null ? "—" : `${value > 0 ? "+" : ""}${value}%`);
  return (
    <div className="space-y-4">
      <Card className="space-y-5 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Resultado do escritório</h2>
            <p className="text-sm text-muted-foreground">
              {basis === "cash"
                ? "Regime de caixa: o que foi efetivamente recebido e pago."
                : "Regime de competência: receitas e despesas pelo mês a que pertencem."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              className="w-auto"
              type="month"
              aria-label="Mês final do relatório"
              value={month}
              onChange={(event) => {
                if (event.target.value) setMonth(event.target.value);
              }}
            />
            <select
              className={selectClass.replace("w-full", "w-auto")}
              aria-label="Regime do relatório"
              value={basis}
              onChange={(event) => setBasis(event.target.value as "cash" | "competence")}
            >
              <option value="cash">Caixa</option>
              <option value="competence">Competência</option>
            </select>
            <Button variant="outline" onClick={exportReport}>
              Exportar CSV
            </Button>
          </div>
        </div>
        <KpiStrip
          items={[
            {
              label: `Receitas · ${monthLabel(month)}`,
              value: currency(current.income),
              tone: "income",
              hint: `${pct(incomeChange)} vs. mês anterior`,
              summary: `${basisNote} A variação compara com ${currency(previous.income)} do mês anterior.`,
              detail: () => (
                <DetailRows rows={monthRows("income")} total={currency(current.income)} />
              ),
            },
            {
              label: `Despesas · ${monthLabel(month)}`,
              value: currency(current.expense),
              tone: "expense",
              hint: `Mês anterior: ${currency(previous.expense)}`,
              summary: basisNote,
              detail: () => (
                <DetailRows rows={monthRows("expense")} total={currency(current.expense)} />
              ),
            },
            {
              label: "Resultado do mês",
              value: currency(current.balance),
              tone: current.balance < 0 ? "expense" : "balance",
              hint: margin === null ? "Sem receitas no mês" : `Margem de ${margin}%`,
              summary: `Receitas menos despesas do mês, agrupadas por ${groupName}. A margem é o resultado dividido pelas receitas.`,
              detail: () => (
                <DetailRows
                  rows={groupedRows.map(([name, totals]) => ({
                    key: name,
                    title: name,
                    subtitle: `Receitas ${currency(totals.income)} · Despesas ${currency(totals.expense)}`,
                    value: <Amount cents={totals.income - totals.expense} />,
                  }))}
                  total={<Amount cents={current.balance} />}
                />
              ),
            },
            {
              label: "A receber em aberto",
              value: currency(openReceivable),
              tone: overdueReceivable ? "alert" : "neutral",
              hint: `${currency(overdueReceivable)} vencido`,
              summary:
                "Tudo o que ainda falta receber, de todos os meses, ordenado por vencimento. Os vencidos estão marcados.",
              detail: () => (
                <DetailRows
                  rows={openReceivableRows}
                  total={currency(openReceivable)}
                  empty="Nada a receber em aberto."
                />
              ),
            },
          ]}
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="min-w-0">
            <h3 className="mb-3 text-sm font-medium">Receitas × despesas · 12 meses</h3>
            <FinanceFlowChart
              label="Receitas e despesas dos últimos 12 meses"
              incomeLabel="Receitas"
              expenseLabel="Despesas"
              data={monthly.map((item) => ({
                key: item.period,
                label: monthLabel(item.period),
                income: item.income,
                expense: item.expense,
              }))}
            />
          </div>
          <dl className="grid content-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Receitas em 12 meses</dt>
              <dd className="text-lg font-semibold tabular-nums">{currency(yearIncome)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Despesas em 12 meses</dt>
              <dd className="text-lg font-semibold tabular-nums">{currency(yearExpense)}</dd>
            </div>
            <div className="border-t pt-3">
              <dt className="text-muted-foreground">Resultado acumulado</dt>
              <dd
                className={`text-lg font-semibold tabular-nums ${yearIncome - yearExpense < 0 ? "text-destructive" : ""}`}
              >
                {currency(yearIncome - yearExpense)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Média mensal de receitas</dt>
              <dd className="font-semibold tabular-nums">
                {currency(Math.round(yearIncome / 12))}
              </dd>
            </div>
          </dl>
        </div>
      </Card>

      <Card className="space-y-3 p-4 md:p-5">
        <div>
          <h3 className="font-semibold">DRE gerencial · 6 meses</h3>
          <p className="text-sm text-muted-foreground">
            Demonstrativo de resultado pelo plano de contas (
            {basis === "cash" ? "caixa" : "competência"}). AV é a análise vertical: quanto cada
            conta representa da receita total.
          </p>
        </div>
        <Sheet
          label="DRE gerencial"
          maxHeight="max-h-[36rem]"
          columns={[
            { label: "Conta" },
            ...dreMonths.map((period) => ({ label: monthLabel(period), align: "right" as const })),
            { label: "Total", align: "right" },
            { label: "AV", align: "right" },
          ]}
        >
          {(
            [
              ["income", "(+) Receitas", dre.income],
              ["expense", "(−) Despesas", dre.expense],
            ] as const
          ).flatMap(([kind, title, part]) => [
            <tr key={kind} className="bg-muted/40 font-semibold">
              <SheetGutter n="" />
              <td>{title}</td>
              {part.total.map((value, index) => (
                <td key={index} className="whitespace-nowrap text-right">
                  {currency(value)}
                </td>
              ))}
              <td className="whitespace-nowrap text-right">{currency(sum(part.total))}</td>
              <td className="whitespace-nowrap text-right text-muted-foreground">
                {percentOf(sum(part.total))}
              </td>
            </tr>,
            ...part.rows.map((row, index) => (
              <tr key={kind + row.name} className={row.group ? "font-medium" : ""}>
                <SheetGutter n={index + 1} />
                <td
                  className="min-w-48 whitespace-nowrap"
                  style={{ paddingLeft: `${0.75 + row.depth * 1.1}rem` }}
                >
                  {row.code && (
                    <span className="mr-1.5 text-xs tabular-nums text-muted-foreground">
                      {row.code}
                    </span>
                  )}
                  {row.name}
                </td>
                {row.values.map((value, i) => (
                  <td key={i} className="whitespace-nowrap text-right">
                    {value ? currency(value) : <span className="text-muted-foreground">–</span>}
                  </td>
                ))}
                <td className="whitespace-nowrap text-right font-medium">
                  {currency(sum(row.values))}
                </td>
                <td className="whitespace-nowrap text-right text-muted-foreground">
                  {percentOf(sum(row.values))}
                </td>
              </tr>
            )),
          ])}
          <tr className="font-semibold [&>td]:border-t-[3px] [&>td]:border-double">
            <SheetGutter n="=" />
            <td>Resultado</td>
            {dre.result.map((value, index) => (
              <td key={index} className="whitespace-nowrap text-right">
                <Amount cents={value} />
              </td>
            ))}
            <td className="whitespace-nowrap text-right">
              <Amount cents={sum(dre.result)} />
            </td>
            <td className="whitespace-nowrap text-right text-muted-foreground">
              {percentOf(sum(dre.result))}
            </td>
          </tr>
          <tr className="text-muted-foreground">
            <SheetGutter n="%" />
            <td>Margem</td>
            {dre.result.map((value, index) => (
              <td key={index} className="whitespace-nowrap text-right">
                {dre.income.total[index]
                  ? `${Math.round((value / dre.income.total[index]) * 100)}%`
                  : "–"}
              </td>
            ))}
            <td className="whitespace-nowrap text-right">{percentOf(sum(dre.result))}</td>
            <td />
          </tr>
        </Sheet>
      </Card>

      <Card className="space-y-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">Composição de {monthLabel(month)}</h3>
          <select
            className={selectClass.replace("w-full", "w-auto")}
            aria-label="Agrupar relatório"
            value={group}
            onChange={(event) => setGroup(event.target.value as typeof group)}
          >
            <option value="category">Por conta do plano</option>
            <option value="cost_center">Por centro de custo</option>
            <option value="client_id">Por cliente</option>
          </select>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <section>
            <h4 className="mb-3 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              De onde veio o dinheiro
            </h4>
            <FinanceShareBars
              rows={share("income")}
              tone="income"
              empty="Nenhuma receita neste mês."
            />
          </section>
          <section>
            <h4 className="mb-3 text-sm font-medium text-destructive">Para onde foi o dinheiro</h4>
            <FinanceShareBars
              rows={share("expense")}
              tone="expense"
              empty="Nenhuma despesa neste mês."
            />
          </section>
        </div>
        {groupedRows.length > 0 && (
          <Sheet
            label={`Detalhamento por ${groupName}`}
            maxHeight="max-h-96"
            columns={[
              { label: groupName.charAt(0).toUpperCase() + groupName.slice(1) },
              { label: "Receitas", align: "right" },
              { label: "Despesas", align: "right" },
              { label: "Resultado", align: "right" },
            ]}
          >
            {groupedRows.map(([name, totals], index) => (
              <tr key={name}>
                <SheetGutter n={index + 1} />
                <td className="min-w-40">{name}</td>
                <td className="whitespace-nowrap text-right">{currency(totals.income)}</td>
                <td className="whitespace-nowrap text-right">{currency(totals.expense)}</td>
                <td className="whitespace-nowrap text-right font-medium">
                  <Amount cents={totals.income - totals.expense} />
                </td>
              </tr>
            ))}
          </Sheet>
        )}
      </Card>

      <Card className="space-y-3 p-4 md:p-5">
        <div>
          <h3 className="font-semibold">Fluxo diário de {monthLabel(month)}</h3>
          <p className="text-sm text-muted-foreground">
            O resultado previsto soma as baixas e o saldo ainda em aberto nos vencimentos deste mês.
          </p>
        </div>
        {daily.length > 0 ? (
          <Sheet
            label="Fluxo diário de caixa"
            maxHeight="max-h-[28rem]"
            columns={[
              { label: "Data" },
              { label: "Recebido", align: "right" },
              { label: "Pago", align: "right" },
              { label: "A receber", align: "right" },
              { label: "A pagar", align: "right" },
              { label: "Resultado previsto", align: "right" },
            ]}
          >
            {daily.map((day, index) => (
              <tr key={day.date}>
                <SheetGutter n={index + 1} />
                <td className="whitespace-nowrap">{displayDate(day.date)}</td>
                <td className="whitespace-nowrap text-right">
                  {day.income ? <Amount cents={day.income} abs /> : ""}
                </td>
                <td className="whitespace-nowrap text-right">
                  {day.expense ? <Amount cents={-day.expense} abs /> : ""}
                </td>
                <td className="whitespace-nowrap text-right text-muted-foreground">
                  {day.pendingIncome ? currency(day.pendingIncome) : ""}
                </td>
                <td className="whitespace-nowrap text-right text-muted-foreground">
                  {day.pendingExpense ? currency(day.pendingExpense) : ""}
                </td>
                <td
                  className={`whitespace-nowrap text-right font-medium ${day.projected < 0 ? "text-destructive" : ""}`}
                >
                  {currency(day.projected)}
                </td>
              </tr>
            ))}
          </Sheet>
        ) : (
          <p className="text-sm text-muted-foreground">Sem movimentos ou vencimentos neste mês.</p>
        )}
      </Card>
    </div>
  );
}

export function FinanceStatement({
  ledger,
  accountId = "",
  embedded = false,
}: {
  ledger: OfficeFinanceData;
  /** Fixed account chosen in Contas e extratos; empty means every account. */
  accountId?: string;
  embedded?: boolean;
}) {
  const [month, setMonth] = useState(isoToday().slice(0, 7));
  const entries = new Map(ledger.entries.map((entry) => [entry.id, entry]));
  const accounts = new Map(ledger.accounts.map((account) => [account.id, account.name]));
  const account = ledger.accounts.find((item) => item.id === accountId);
  const movements = ledger.settlements
    .filter(
      (item) =>
        !item.reversed_at &&
        item.settled_on.startsWith(month) &&
        (!accountId || item.account_id === accountId),
    )
    .map((item) => {
      const entry = entries.get(item.entry_id);
      return {
        id: item.id,
        date: item.settled_on,
        description: entry?.description ?? "Lançamento",
        category: entry?.category ?? "",
        account: accounts.get(item.account_id ?? "") ?? "Sem conta informada",
        amount: (entry?.kind === "income" ? 1 : -1) * item.amount_cents,
      };
    });
  for (const transfer of ledger.transfers.filter((item) => item.transferred_on.startsWith(month))) {
    if (!accountId || transfer.from_account === accountId)
      movements.push({
        id: transfer.id + "-out",
        date: transfer.transferred_on,
        description: "Transferência · " + transfer.description,
        category: "Transferência",
        account: accounts.get(transfer.from_account) ?? "",
        amount: -transfer.amount_cents,
      });
    if (!accountId || transfer.to_account === accountId)
      movements.push({
        id: transfer.id + "-in",
        date: transfer.transferred_on,
        description: "Transferência · " + transfer.description,
        category: "Transferência",
        account: accounts.get(transfer.to_account) ?? "",
        amount: transfer.amount_cents,
      });
  }
  // Oldest first, like a ledger, so the running column reads top to bottom.
  movements.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const previousDay = format(addDays(parseISO(month + "-01"), -1), "yyyy-MM-dd");
  const opening = account
    ? financeAccountBalance(
        account,
        ledger.entries,
        ledger.settlements,
        ledger.transfers,
        previousDay,
      )
    : 0;
  const credits = movements.reduce((sum, item) => sum + Math.max(item.amount, 0), 0);
  const debits = movements.reduce((sum, item) => sum + Math.min(item.amount, 0), 0);
  let running = opening;
  const columns = [
    { label: "Data" },
    { label: "Descrição" },
    { label: "Categoria" },
    ...(accountId ? [] : [{ label: "Conta" }]),
    { label: "Entrada", align: "right" as const },
    { label: "Saída", align: "right" as const },
    { label: account ? "Saldo" : "Acumulado no mês", align: "right" as const },
  ];
  const content = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          className="w-auto"
          type="month"
          aria-label="Mês do extrato"
          value={month}
          onChange={(event) => {
            if (event.target.value) setMonth(event.target.value);
          }}
        />
        <Button
          variant="outline"
          onClick={() =>
            saveCsv(
              financeCsv([
                ["Data", "Descrição", "Categoria", "Conta", "Valor (R$)"],
                ...movements.map((item) => [
                  displayDate(item.date),
                  item.description,
                  item.category,
                  item.account,
                  (item.amount / 100).toFixed(2).replace(".", ","),
                ]),
              ]),
              `extrato-${month}.csv`,
            )
          }
        >
          Exportar CSV
        </Button>
      </div>
      <KpiStrip
        items={[
          ...(account
            ? [
                {
                  label: "Saldo inicial",
                  value: currency(opening),
                  tone: "neutral" as const,
                  summary: `Saldo da conta no fim do mês anterior: abertura da conta mais todas as baixas e transferências até ${displayDate(previousDay)}.`,
                },
              ]
            : []),
          {
            label: "Entradas",
            value: currency(credits),
            tone: "income",
            summary: "Recebimentos e transferências recebidas no mês.",
            detail: () => (
              <DetailRows
                rows={movements
                  .filter((item) => item.amount > 0)
                  .map((item) => ({
                    key: item.id,
                    date: item.date,
                    title: item.description,
                    subtitle: [item.category, accountId ? "" : item.account]
                      .filter(Boolean)
                      .join(" · "),
                    value: currency(Math.abs(item.amount)),
                  }))}
                total={currency(credits)}
              />
            ),
          },
          {
            label: "Saídas",
            value: currency(-debits),
            tone: "expense",
            summary: "Pagamentos e transferências enviadas no mês.",
            detail: () => (
              <DetailRows
                rows={movements
                  .filter((item) => item.amount < 0)
                  .map((item) => ({
                    key: item.id,
                    date: item.date,
                    title: item.description,
                    subtitle: [item.category, accountId ? "" : item.account]
                      .filter(Boolean)
                      .join(" · "),
                    value: currency(Math.abs(item.amount)),
                  }))}
                total={currency(-debits)}
              />
            ),
          },
          account
            ? {
                label: "Saldo final",
                value: currency(opening + credits + debits),
                tone: "balance",
                summary: `Saldo inicial ${currency(opening)} + entradas ${currency(credits)} − saídas ${currency(-debits)}.`,
              }
            : {
                label: "Resultado do mês",
                value: currency(credits + debits),
                tone: "balance",
                summary: `Entradas ${currency(credits)} − saídas ${currency(-debits)} em todas as contas.`,
              },
        ]}
      />
      {movements.length ? (
        <Sheet
          label="Extrato de movimentações"
          columns={columns}
          footer={
            <tr>
              <td className="fin-sheet-gutter">Σ</td>
              <td colSpan={accountId ? 3 : 4}>Totais do mês</td>
              <td className="text-right">
                <Amount cents={credits} abs />
              </td>
              <td className="text-right">
                <Amount cents={debits} abs />
              </td>
              <td className="text-right">{currency(opening + credits + debits)}</td>
            </tr>
          }
        >
          {movements.map((item, index) => {
            running += item.amount;
            return (
              <tr key={item.id}>
                <SheetGutter n={index + 1} />
                <td className="whitespace-nowrap">{displayDate(item.date)}</td>
                <td className="min-w-48 break-words">{item.description}</td>
                <td className="whitespace-nowrap text-muted-foreground">{item.category}</td>
                {!accountId && <td className="whitespace-nowrap">{item.account}</td>}
                <td className="whitespace-nowrap text-right">
                  {item.amount > 0 && <Amount cents={item.amount} abs />}
                </td>
                <td className="whitespace-nowrap text-right">
                  {item.amount < 0 && <Amount cents={item.amount} abs />}
                </td>
                <td
                  className={`whitespace-nowrap text-right font-medium ${running < 0 ? "text-destructive" : ""}`}
                >
                  {currency(running)}
                </td>
              </tr>
            );
          })}
        </Sheet>
      ) : (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhuma baixa ou transferência neste mês. As movimentações aparecem aqui quando um
          lançamento recebe baixa nesta conta.
        </p>
      )}
    </div>
  );
  if (embedded) return content;
  return (
    <Card className="space-y-4 p-4">
      <h2 className="text-lg font-semibold">Extrato de movimentações</h2>
      {content}
    </Card>
  );
}

const entityNames: Record<string, string> = {
  office_finance_entries: "Lançamento",
  office_finance_settlements: "Baixa",
  office_finance_accounts: "Conta",
  office_finance_registers: "Cadastro",
  office_finance_agreements: "Proposta ou contrato",
  office_finance_transfers: "Transferência",
  office_finance_services: "Serviço",
  office_finance_orders: "Pedido de serviço ou compra",
  office_finance_order_items: "Item de pedido",
};

export function FinanceHistoryPanel({
  userId,
  ledger,
}: {
  userId: string;
  ledger: OfficeFinanceData;
}) {
  const { data: profiles = [] } = useProfiles();
  const users = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
  const descriptions = new Map([
    ...ledger.entries.map((entry) => [entry.id, entry.description] as const),
    ...ledger.accounts.map((account) => [account.id, account.name] as const),
    ...ledger.registers.map((register) => [register.id, register.name] as const),
    ...ledger.agreements.map((agreement) => [agreement.id, agreement.description] as const),
    ...ledger.transfers.map((transfer) => [transfer.id, transfer.description] as const),
  ]);
  for (const settlement of ledger.settlements)
    descriptions.set(settlement.id, descriptions.get(settlement.entry_id) ?? "Baixa financeira");
  const query = useQuery({
    queryKey: ["office-finance", userId, "history"],
    queryFn: () =>
      financeRows<FinanceHistory>(
        "office_finance_history",
        "id,entity_id,entity_type,action,created_at,created_by",
      ),
  });
  const [search, setSearch] = useState("");
  const rows = (query.data ?? [])
    .filter((item) =>
      (entityNames[item.entity_type] ?? item.entity_type)
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <Card className="space-y-4 p-4">
      <h2 className="text-lg font-semibold">Histórico financeiro</h2>
      <Input
        aria-label="Filtrar histórico"
        placeholder="Filtrar por lançamento, baixa, conta…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {query.isPending && <p role="status">Carregando histórico…</p>}
      {query.isError && (
        <div role="alert">
          Não foi possível carregar o histórico.{" "}
          <Button variant="outline" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      <ul className="divide-y text-sm">
        {rows.map((item) => (
          <li key={item.id} className="space-y-1 py-3">
            <p className="font-medium">
              {entityNames[item.entity_type] ?? "Registro"} ·{" "}
              {item.action === "INSERT"
                ? "Criação"
                : item.action === "DELETE"
                  ? "Exclusão"
                  : "Alteração"}
            </p>
            <p>
              {new Intl.DateTimeFormat("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "America/Sao_Paulo",
              }).format(new Date(item.created_at))}
            </p>
            <p className="break-all text-xs text-muted-foreground">
              {descriptions.get(item.entity_id) ?? "Registro financeiro"} ·{" "}
              {users.get(item.created_by) ?? "Administrador"}
            </p>
          </li>
        ))}
      </ul>
      {query.isSuccess && !rows.length && (
        <p className="text-sm text-muted-foreground">Nenhum evento encontrado.</p>
      )}
    </Card>
  );
}
