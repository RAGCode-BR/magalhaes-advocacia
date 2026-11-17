import { useQuery } from "@tanstack/react-query";
import { addMonths, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useClients } from "@/hooks/use-data";
import {
  financeBalanceSeries,
  financeStatus,
  financeTotals,
  type FinanceKind,
} from "@/lib/office-finance";
import { currency, displayDate, isoToday, type OfficeFinanceData } from "@/lib/office-finance-data";
import { loadBankOverview } from "@/lib/office-bank";
import { FinanceBalanceChart, FinanceFlowChart, FinanceShareBars } from "./FinanceBalanceChart";
import {
  Amount,
  DetailRows,
  KpiStrip,
  Sheet,
  SheetGutter,
  SicoobLogo,
  StatusChip,
  type DetailRow,
} from "./FinanceSheet";

const monthLabel = (period: string) =>
  format(parseISO(period + "-01"), "MMM/yy", { locale: ptBR }).replace(/^./, (c) =>
    c.toUpperCase(),
  );

export type FinanceNavigation = {
  kind?: FinanceKind;
  quick?: "all" | "overdue" | "today" | "upcoming" | "settled";
  search?: string;
  entryId?: string;
  bank?: boolean;
};

/** Finance landing page: balances, month indicators, bank status and what is due. */
export function FinanceDashboard({
  ledger,
  userId,
  navigate,
}: {
  ledger: OfficeFinanceData;
  userId: string;
  navigate: (section: string, options?: FinanceNavigation) => void;
}) {
  const today = isoToday();
  const month = today.slice(0, 7);
  const { data: clients = [] } = useClients();
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  // Same key as the Sicoob view's first page, so the cache is shared.
  const bank = useQuery({
    queryKey: ["office-bank", userId, month, "all", undefined],
    queryFn: () => loadBankOverview(month, "all"),
    staleTime: 30000,
  });

  const series = financeBalanceSeries(
    ledger.accounts,
    ledger.entries,
    ledger.settlements,
    ledger.transfers,
    today,
  );
  const balance = series.at(-1)?.cents ?? 0;
  const change = balance - (series[series.length - 31]?.cents ?? 0);

  const months = Array.from({ length: 6 }, (_, index) =>
    format(addMonths(parseISO(month + "-01"), index - 5), "yyyy-MM"),
  );
  const monthly = months.map((period) => ({
    period,
    ...financeTotals(ledger.entries, ledger.settlements, period, "cash"),
  }));
  const current = monthly.at(-1) ?? { income: 0, expense: 0, balance: 0 };
  const previous = monthly.at(-2) ?? { income: 0, expense: 0, balance: 0 };
  const margin = current.income ? Math.round((current.balance / current.income) * 100) : null;
  const variation = previous.income
    ? Math.round(((current.income - previous.income) / previous.income) * 100)
    : null;

  const nextWeek = new Date(`${today}T12:00:00Z`);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  const weekLimit = nextWeek.toISOString().slice(0, 10);
  const open = ledger.entries.filter(
    (entry) => !entry.cancelled_at && entry.amount_cents > entry.settled_cents,
  );
  const summary = (kind: FinanceKind) =>
    open
      .filter((entry) => entry.kind === kind)
      .reduce(
        (acc, entry) => {
          const remaining = entry.amount_cents - entry.settled_cents;
          acc.open += remaining;
          if (entry.due_date < today) {
            acc.overdue += remaining;
            acc.overdueCount++;
          } else if (entry.due_date <= weekLimit) acc.week += remaining;
          return acc;
        },
        { open: 0, overdue: 0, overdueCount: 0, week: 0 },
      );
  const receivable = summary("income");
  const payable = summary("expense");
  const upcoming = open
    .filter((entry) => entry.due_date <= weekLimit)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 8);

  const kinds = new Map(ledger.entries.map((entry) => [entry.id, entry]));
  const expensesByPlan = new Map<string, number>();
  for (const settlement of ledger.settlements) {
    const entry = kinds.get(settlement.entry_id);
    if (!entry || entry.kind !== "expense" || settlement.reversed_at) continue;
    if (!settlement.settled_on.startsWith(month)) continue;
    expensesByPlan.set(
      entry.category,
      (expensesByPlan.get(entry.category) ?? 0) + settlement.amount_cents,
    );
  }
  const expenseRows = [...expensesByPlan.entries()]
    .map(([name, cents]) => ({ name, cents }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 6);

  // Records behind the month indicators (cash basis: settlements of the month).
  const settledRows = (kind: FinanceKind): DetailRow[] =>
    ledger.settlements
      .filter((item) => !item.reversed_at && item.settled_on.startsWith(month))
      .flatMap((item) => {
        const entry = kinds.get(item.entry_id);
        if (!entry || entry.kind !== kind) return [];
        return [
          {
            key: item.id,
            date: item.settled_on,
            title: entry.description,
            subtitle: [clientNames.get(entry.client_id ?? "") ?? entry.supplier, entry.category]
              .filter(Boolean)
              .join(" · "),
            value: currency(item.amount_cents),
          },
        ];
      })
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const byPlan = new Map<string, number>();
  for (const item of ledger.settlements) {
    const entry = kinds.get(item.entry_id);
    if (!entry || item.reversed_at || !item.settled_on.startsWith(month)) continue;
    byPlan.set(
      entry.category,
      (byPlan.get(entry.category) ?? 0) +
        (entry.kind === "income" ? item.amount_cents : -item.amount_cents),
    );
  }
  const overdueRows: DetailRow[] = open
    .filter((entry) => entry.kind === "income" && entry.due_date < today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .map((entry) => ({
      key: entry.id,
      date: entry.due_date,
      title: entry.description,
      subtitle: `${clientNames.get(entry.client_id ?? "") ?? "Sem cliente"} · vencido há ${Math.round(
        (Date.parse(today) - Date.parse(entry.due_date)) / 86400000,
      )} dias`,
      value: currency(entry.amount_cents - entry.settled_cents),
    }));

  const connection = bank.data?.connection;
  const bankBalance = bank.data?.balances?.ledger;
  const bankTotals = bank.data?.totals;
  const reconciled = bankTotals?.count
    ? Math.round(((bankTotals.count - bankTotals.pending) / bankTotals.count) * 100)
    : null;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-0">
        <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:p-6">
          <div className="flex min-w-0 flex-col justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Saldo consolidado</p>
              <p className="mt-1 break-words text-[2.5rem] font-semibold leading-none tracking-tight tabular-nums">
                {currency(balance)}
              </p>
              <p className="mt-2 text-sm">
                <span
                  className={`font-medium tabular-nums ${change < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}
                >
                  {change >= 0 ? "+" : "−"}
                  {currency(Math.abs(change))}
                </span>{" "}
                <span className="text-muted-foreground">nos últimos 30 dias</span>
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-max"
              onClick={() => navigate("accounts", { bank: true })}
            >
              Ver contas e extratos <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-xs text-muted-foreground">Evolução do saldo · 90 dias</p>
            <FinanceBalanceChart points={series} label="Evolução do saldo consolidado" />
          </div>
        </div>
      </Card>

      <KpiStrip
        items={[
          {
            label: `Recebido em ${monthLabel(month)}`,
            value: currency(current.income),
            tone: "income",
            onClick: () => navigate("entries", { kind: "income", quick: "settled" }),
            actionLabel: "Ver contas recebidas",
            summary:
              "Soma das baixas de recebimento registradas neste mês, em todas as contas. Comparação com o total recebido no mês anterior.",
            detail: () => (
              <DetailRows rows={settledRows("income")} total={currency(current.income)} />
            ),
            hint:
              variation === null
                ? "Sem base no mês anterior"
                : `${variation > 0 ? "+" : ""}${variation}% vs. mês anterior`,
          },
          {
            label: `Pago em ${monthLabel(month)}`,
            value: currency(current.expense),
            tone: "expense",
            onClick: () => navigate("entries", { kind: "expense", quick: "settled" }),
            actionLabel: "Ver contas pagas",
            summary: "Soma das baixas de pagamento registradas neste mês, em todas as contas.",
            detail: () => (
              <DetailRows rows={settledRows("expense")} total={currency(current.expense)} />
            ),
            hint: `Mês anterior: ${currency(previous.expense)}`,
          },
          {
            label: "Resultado do mês",
            value: currency(current.balance),
            tone: current.balance < 0 ? "expense" : "balance",
            onClick: () => navigate("reports"),
            actionLabel: "Abrir relatórios",
            summary:
              "Recebido menos pago no mês. A margem é o resultado dividido pelo recebido. Abaixo, o resultado de cada conta do plano.",
            detail: () => (
              <DetailRows
                rows={[...byPlan.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, cents]) => ({
                    key: name,
                    title: name,
                    value: <Amount cents={cents} />,
                  }))}
                total={<Amount cents={current.balance} />}
              />
            ),
            hint: margin === null ? "Sem receitas no mês" : `Margem de ${margin}%`,
          },
          {
            label: "Inadimplência",
            value: currency(receivable.overdue),
            tone: receivable.overdue ? "alert" : "income",
            onClick: () => navigate("entries", { kind: "income", quick: "overdue" }),
            actionLabel: "Ver recebimentos vencidos",
            summary:
              "Valores a receber com vencimento anterior a hoje e ainda sem baixa total, do mais antigo para o mais recente.",
            detail: () => (
              <DetailRows
                rows={overdueRows}
                total={currency(receivable.overdue)}
                empty="Nenhum recebimento vencido."
              />
            ),
            hint: receivable.overdueCount
              ? `${receivable.overdueCount} ${receivable.overdueCount === 1 ? "recebimento vencido" : "recebimentos vencidos"}`
              : "Nenhum recebimento vencido",
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0 p-4 md:p-5">
          <h3 className="mb-3 font-semibold">Recebido × pago · 6 meses</h3>
          <FinanceFlowChart
            label="Recebimentos e pagamentos dos últimos 6 meses"
            incomeLabel="Recebido"
            expenseLabel="Pago"
            data={monthly.map((item) => ({
              key: item.period,
              label: monthLabel(item.period),
              income: item.income,
              expense: item.expense,
            }))}
          />
        </Card>
        <Card className="space-y-4 p-4 md:p-5">
          <div className="flex items-center justify-between gap-2">
            <SicoobLogo className="h-4" />
            <span className="text-xs text-muted-foreground">
              {connection?.last_success_at
                ? `Atualizado ${format(new Date(connection.last_success_at), "dd/MM HH:mm")}`
                : bank.isPending
                  ? "Carregando…"
                  : "Não conectado"}
            </span>
          </div>
          {connection ? (
            <>
              <div>
                <p className="text-sm text-muted-foreground">Saldo no banco</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {bankBalance ? currency(bankBalance.amount_cents) : "Aguardando consulta"}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Entradas no mês</dt>
                  <dd className="font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                    {currency(bankTotals?.credits ?? 0)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Saídas no mês</dt>
                  <dd className="font-medium tabular-nums text-destructive">
                    {currency(bankTotals?.debits ?? 0)}
                  </dd>
                </div>
              </dl>
              <div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Conciliação do mês</span>
                  <span className="font-medium tabular-nums">
                    {reconciled === null ? "—" : `${reconciled}%`}
                  </span>
                </div>
                <div
                  className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label="Movimentações conciliadas"
                  aria-valuenow={reconciled ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-emerald-600 dark:bg-emerald-400"
                    style={{ width: `${reconciled ?? 0}%` }}
                  />
                </div>
                {bankTotals?.pending ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {bankTotals.pending}{" "}
                    {bankTotals.pending === 1
                      ? "movimentação para conciliar"
                      : "movimentações para conciliar"}
                  </p>
                ) : (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Tudo conciliado
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => navigate("accounts", { bank: true })}
              >
                Abrir extrato Sicoob
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {bank.isPending
                ? "Consultando a conta…"
                : "A conta Sicoob ainda não está configurada."}
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(
          [
            ["income", "A receber", receivable],
            ["expense", "A pagar", payable],
          ] as const
        ).map(([kind, title, item]) => (
          <Card key={kind} className="p-4 md:p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{title}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("entries", { kind, quick: "all" })}
              >
                Ver lançamentos <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-1 text-sm">
              {(
                [
                  ["all", "Em aberto", item.open, ""],
                  ["overdue", "Vencido", item.overdue, item.overdue ? "text-destructive" : ""],
                  [
                    "upcoming",
                    "Próx. 7 dias",
                    item.week,
                    item.week ? "text-amber-700 dark:text-amber-300" : "",
                  ],
                ] as const
              ).map(([quick, label, cents, color]) => (
                <div key={quick} className="min-w-0">
                  <dt>
                    <button
                      type="button"
                      onClick={() => navigate("entries", { kind, quick })}
                      className="group -mx-2 w-[calc(100%+1rem)] rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block text-muted-foreground group-hover:text-foreground">
                        {label}
                      </span>
                      <span className={`block font-semibold tabular-nums ${color}`}>
                        {currency(cents)}
                      </span>
                    </button>
                  </dt>
                </div>
              ))}
            </dl>
            {item.open > 0 && (
              <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className="bg-destructive"
                  style={{ width: `${(item.overdue / item.open) * 100}%` }}
                />
                <div
                  className="bg-amber-500"
                  style={{ width: `${(item.week / item.open) * 100}%` }}
                />
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0 space-y-3 p-4 md:p-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <CalendarClock className="h-4 w-4 text-muted-foreground" /> Vencidos e próximos 7 dias
          </h3>
          {upcoming.length ? (
            <Sheet
              label="Vencimentos"
              maxHeight=""
              columns={[
                { label: "Vencimento" },
                { label: "Lançamento" },
                { label: "Valor", align: "right" },
                { label: "Situação" },
              ]}
            >
              {upcoming.map((entry, index) => (
                <tr
                  key={entry.id}
                  className="cursor-pointer"
                  onClick={() => navigate("entries", { kind: entry.kind, entryId: entry.id })}
                >
                  <SheetGutter n={index + 1} />
                  <td
                    className={`whitespace-nowrap ${entry.due_date < today ? "font-medium text-destructive" : ""}`}
                  >
                    {displayDate(entry.due_date)}
                  </td>
                  <td className="min-w-44">
                    <button
                      type="button"
                      className="text-left font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate("entries", { kind: entry.kind, entryId: entry.id });
                      }}
                    >
                      {entry.description}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {entry.kind === "income" ? "Receber" : "Pagar"} ·{" "}
                      {clientNames.get(entry.client_id ?? "") ?? entry.supplier ?? entry.category}
                    </p>
                  </td>
                  <td
                    className={`whitespace-nowrap text-right font-medium ${entry.kind === "income" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}
                  >
                    {currency(entry.amount_cents - entry.settled_cents)}
                  </td>
                  <td>
                    <StatusChip status={financeStatus(entry, today)} />
                  </td>
                </tr>
              ))}
            </Sheet>
          ) : (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nada vencido nem vencendo nos próximos 7 dias.
            </p>
          )}
        </Card>
        <Card className="space-y-3 p-4 md:p-5">
          <h3 className="font-semibold">Despesas de {monthLabel(month)} por conta</h3>
          <FinanceShareBars
            rows={expenseRows}
            tone="expense"
            empty="Nenhuma despesa paga neste mês."
            onSelect={(name) =>
              navigate("entries", { kind: "expense", quick: "settled", search: name })
            }
          />
          <Button variant="ghost" size="sm" className="w-full" onClick={() => navigate("reports")}>
            Ver relatórios completos <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Card>
      </div>
    </div>
  );
}
