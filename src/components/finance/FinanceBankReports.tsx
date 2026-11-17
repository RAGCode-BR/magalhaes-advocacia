import { useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReconcileDialog } from "./FinanceBank";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  currency,
  displayDate,
  financeRpc,
  isoToday,
  type OfficeFinanceData,
} from "@/lib/office-finance-data";
import {
  bankDescriptionParts,
  bankHistoryGroup,
  loadBankOverview,
  type BankTransaction,
} from "@/lib/office-bank";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FinanceFlowChart } from "./FinanceBalanceChart";
import {
  Amount,
  DetailRows,
  KpiStrip,
  Sheet,
  SheetGutter,
  SicoobLogo,
  StatusChip,
} from "./FinanceSheet";

// Reports built only from what the Sicoob connector already stores (read-only RPCs).

type Period = { month: string; row_count: number; synced_at: string };

const monthLabel = (month: string) => {
  const text = new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
  return text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);
};

async function loadMonthRows(month: string) {
  const rows: BankTransaction[] = [];
  let cursor: { date: string; id: string } | undefined;
  // 50 rows per page; stop at 1.000 rows to keep the report responsive.
  for (let page = 0; page < 20; page++) {
    const data = await loadBankOverview(month, "all", cursor);
    rows.push(...data.rows.slice(0, 50));
    if (data.rows.length <= 50) break;
    const last = data.rows[49];
    cursor = { date: last.booked_on, id: last.id };
  }
  return rows;
}

export function FinanceBankReports({
  userId,
  ledger,
  openStatement,
}: {
  userId: string;
  ledger: OfficeFinanceData;
  /** Opens the Sicoob statement in Contas e extratos (to reconcile). */
  openStatement?: () => void;
}) {
  const [historyFilter, setHistoryFilter] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<"largest" | "pending" | "all">("largest");
  const today = isoToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const periods = useQuery({
    queryKey: ["office-bank-periods", userId],
    queryFn: async () => (await financeRpc("office_bank_periods_list", {})) as unknown as Period[],
  });
  const months = [...(periods.data ?? [])]
    .map((p) => p.month.slice(0, 7))
    .sort()
    .slice(-12);
  const monthly = useQueries({
    queries: months.map((m) => ({
      queryKey: ["office-bank", userId, m, "all", undefined],
      queryFn: () => loadBankOverview(m, "all"),
      staleTime: 60000,
    })),
  });
  const rows = useQuery({
    queryKey: ["office-bank-report-rows", userId, month],
    queryFn: () => loadMonthRows(month),
    staleTime: 60000,
  });

  const connection = monthly.find((q) => q.data?.connection)?.data?.connection;
  if (periods.isPending) return <p role="status">Carregando relatórios do Sicoob…</p>;
  if (periods.isError)
    return <p role="alert">Não foi possível carregar os relatórios do Sicoob.</p>;
  if (!periods.data?.length)
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Os relatórios do Sicoob aparecem depois da primeira atualização do extrato em Contas e
        extratos.
      </Card>
    );

  const flow = months.map((m, i) => {
    const totals = monthly[i]?.data?.totals;
    return {
      month: m,
      credits: totals?.credits ?? 0,
      debits: totals?.debits ?? 0,
      count: totals?.count ?? 0,
      pending: totals?.pending ?? 0,
      loading: monthly[i]?.isPending,
    };
  });
  const sum = flow.reduce(
    (acc, f) => ({
      credits: acc.credits + f.credits,
      debits: acc.debits + f.debits,
      count: acc.count + f.count,
      pending: acc.pending + f.pending,
    }),
    { credits: 0, debits: 0, count: 0, pending: 0 },
  );

  // Banco × sistema: what the bank shows vs. what was settled on the linked account.
  const accountId = connection?.account_id;
  const kinds = new Map(ledger.entries.map((entry) => [entry.id, entry.kind]));
  const system = (m: string) => {
    let credits = 0;
    let debits = 0;
    for (const s of ledger.settlements) {
      if (s.account_id !== accountId || s.reversed_at || !s.settled_on.startsWith(m)) continue;
      if (kinds.get(s.entry_id) === "income") credits += s.amount_cents;
      else debits += s.amount_cents;
    }
    for (const t of ledger.transfers) {
      if (!t.transferred_on.startsWith(m)) continue;
      if (t.to_account === accountId) credits += t.amount_cents;
      if (t.from_account === accountId) debits += t.amount_cents;
    }
    return { credits, debits };
  };

  const monthRows = rows.data ?? [];
  const groups = new Map<string, { count: number; credits: number; debits: number }>();
  for (const row of monthRows) {
    const key = bankHistoryGroup(row.description);
    const g = groups.get(key) ?? { count: 0, credits: 0, debits: 0 };
    g.count++;
    if (row.amount_cents > 0) g.credits += row.amount_cents;
    else g.debits += row.amount_cents;
    groups.set(key, g);
  }
  const grouped = [...groups.entries()].sort(
    (a, b) =>
      Math.abs(b[1].credits) +
      Math.abs(b[1].debits) -
      Math.abs(a[1].credits) -
      Math.abs(a[1].debits),
  );
  const maxGroup = Math.max(1, ...grouped.flatMap(([, g]) => [g.credits, -g.debits]));
  const incoming = monthRows.filter((row) => row.amount_cents > 0);
  const incomingCount = incoming.length;
  const monthCredits = incoming.reduce((sum, row) => sum + row.amount_cents, 0);
  const monthDebits = -monthRows
    .filter((row) => row.amount_cents < 0)
    .reduce((sum, row) => sum + row.amount_cents, 0);
  const averageIn = incomingCount ? Math.round(monthCredits / incomingCount) : 0;
  const biggest = incoming.reduce<BankTransaction | null>(
    (best, row) => (!best || row.amount_cents > best.amount_cents ? row : best),
    null,
  );
  const largestIn = biggest?.amount_cents ?? 0;
  const largestInName = biggest ? bankHistoryGroup(biggest.description) : "Sem entradas";
  const monthIndex = flow.findIndex((f) => f.month === month);
  const before = monthIndex > 0 ? flow[monthIndex - 1].credits : 0;
  const monthVariation = before ? Math.round(((monthCredits - before) / before) * 100) : null;
  const pending = monthRows
    .filter((row) => !row.settlement_id)
    .sort((a, b) => a.booked_on.localeCompare(b.booked_on));
  const pendingTotal = pending.reduce((s, r) => s + Math.abs(r.amount_cents), 0);
  const largest = [...monthRows]
    .sort((a, b) => Math.abs(b.amount_cents) - Math.abs(a.amount_cents))
    .slice(0, 8);

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <SicoobLogo className="h-5" />
            <div>
              <h2 className="text-lg font-semibold">Relatórios bancários</h2>
              <p className="text-xs text-muted-foreground">
                Meses já consultados no Sicoob · {connection?.name ?? "conta corrente"}
              </p>
            </div>
          </div>
        </div>
        <KpiStrip
          items={[
            {
              label: `Entradas em ${monthLabel(month)}`,
              value: currency(monthCredits),
              tone: "income",
              hint:
                monthVariation === null
                  ? "Sem base no mês anterior"
                  : `${monthVariation > 0 ? "+" : ""}${monthVariation}% vs. mês anterior`,
              summary:
                "Todos os créditos do extrato do Sicoob no mês, inclusive resgates de aplicação e transferências entre contas.",
              detail: () => (
                <TransactionList userId={userId} rows={incoming} openStatement={openStatement} />
              ),
            },
            {
              label: "Ticket médio de entrada",
              value: currency(averageIn),
              tone: "neutral",
              hint: `${incomingCount} ${incomingCount === 1 ? "entrada" : "entradas"} no mês`,
              summary: `Total de entradas (${currency(monthCredits)}) dividido pela quantidade de entradas (${incomingCount}).`,
              detail: () => (
                <TransactionList userId={userId} rows={incoming} openStatement={openStatement} />
              ),
            },
            {
              label: "Maior entrada do mês",
              value: currency(largestIn),
              tone: "income",
              hint: largestInName,
              summary: "As cinco maiores entradas do mês no extrato do Sicoob.",
              detail: () => (
                <TransactionList
                  userId={userId}
                  rows={[...incoming].sort((a, b) => b.amount_cents - a.amount_cents).slice(0, 5)}
                  openStatement={openStatement}
                />
              ),
            },
            {
              label: "Saídas sobre entradas",
              value: monthCredits ? `${Math.round((monthDebits / monthCredits) * 100)}%` : "—",
              tone: monthDebits > monthCredits ? "expense" : "balance",
              hint: `${currency(monthDebits)} de saídas no mês`,
              summary: `Saídas (${currency(monthDebits)}) divididas pelas entradas (${currency(monthCredits)}). Acima de 100%, saiu mais dinheiro do que entrou.`,
              detail: () => (
                <TransactionList
                  userId={userId}
                  rows={monthRows.filter((row) => row.amount_cents < 0)}
                  openStatement={openStatement}
                />
              ),
            },
          ]}
        />
        <KpiStrip
          items={[
            {
              label: `Entradas · ${flow.length} meses`,
              value: currency(sum.credits),
              tone: "income",
              summary: "Créditos do extrato em cada mês consultado no Sicoob.",
              detail: () => (
                <DetailRows
                  rows={flow.map((f) => ({
                    key: f.month,
                    title: monthLabel(f.month),
                    subtitle: `${f.count} movimentações`,
                    value: currency(f.credits),
                  }))}
                  total={currency(sum.credits)}
                />
              ),
            },
            {
              label: `Saídas · ${flow.length} meses`,
              value: currency(sum.debits),
              tone: "expense",
              summary: "Débitos do extrato em cada mês consultado no Sicoob.",
              detail: () => (
                <DetailRows
                  rows={flow.map((f) => ({
                    key: f.month,
                    title: monthLabel(f.month),
                    value: currency(f.debits),
                  }))}
                  total={currency(sum.debits)}
                />
              ),
            },
            {
              label: "Resultado no período",
              value: currency(sum.credits - sum.debits),
              tone: "balance",
              summary: "Entradas menos saídas no extrato, mês a mês.",
              detail: () => (
                <DetailRows
                  rows={flow.map((f) => ({
                    key: f.month,
                    title: monthLabel(f.month),
                    subtitle: `Entradas ${currency(f.credits)} · Saídas ${currency(f.debits)}`,
                    value: <Amount cents={f.credits - f.debits} />,
                  }))}
                  total={<Amount cents={sum.credits - sum.debits} />}
                />
              ),
            },
            {
              label: "Não conciliadas",
              value: String(sum.pending),
              tone: sum.pending ? "alert" : "income",
              hint: `de ${sum.count} movimentações`,
              summary:
                "Movimentações do extrato ainda sem vínculo com uma baixa do financeiro. Abaixo, as pendências do mês selecionado no detalhe.",
              onClick: openStatement,
              actionLabel: "Conciliar no extrato",
              detail: () => (
                <>
                  <DetailRows
                    rows={flow
                      .filter((f) => f.pending)
                      .map((f) => ({
                        key: f.month,
                        title: monthLabel(f.month),
                        subtitle: `de ${f.count} movimentações`,
                        value: `${f.pending} pendentes`,
                      }))}
                    empty="Tudo conciliado nos meses consultados."
                  />
                  <TransactionList userId={userId} rows={pending} openStatement={openStatement} />
                </>
              ),
            },
          ]}
        />
        <h3 className="font-semibold">Entradas × saídas no Sicoob</h3>
        <FinanceFlowChart
          label="Entradas e saídas mensais na conta Sicoob"
          data={flow.map((f) => ({
            key: f.month,
            label: monthLabel(f.month),
            income: f.credits,
            expense: f.debits,
          }))}
        />
        <Sheet
          label="Fluxo bancário mês a mês"
          maxHeight=""
          columns={[
            { label: "Mês" },
            { label: "Entradas", align: "right" },
            { label: "Saídas", align: "right" },
            { label: "Resultado", align: "right" },
            { label: "Movimentações", align: "right" },
            { label: "Conciliado", align: "right" },
          ]}
          footer={
            <tr>
              <td className="fin-sheet-gutter">Σ</td>
              <td>Total</td>
              <td className="text-right">{currency(sum.credits)}</td>
              <td className="text-right">{currency(sum.debits)}</td>
              <td className="text-right">
                <Amount cents={sum.credits - sum.debits} />
              </td>
              <td className="text-right">{sum.count}</td>
              <td className="text-right">
                {sum.count ? Math.round(((sum.count - sum.pending) / sum.count) * 100) : 0}%
              </td>
            </tr>
          }
        >
          {flow.map((f, i) => {
            const share = f.count ? Math.round(((f.count - f.pending) / f.count) * 100) : 100;
            return (
              <tr key={f.month}>
                <SheetGutter n={i + 1} />
                <td className="whitespace-nowrap">
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => setMonth(f.month)}
                  >
                    {monthLabel(f.month)}
                  </button>
                </td>
                <td className="whitespace-nowrap text-right">
                  {f.loading ? "…" : currency(f.credits)}
                </td>
                <td className="whitespace-nowrap text-right">
                  {f.loading ? "…" : currency(f.debits)}
                </td>
                <td className="whitespace-nowrap text-right font-medium">
                  {!f.loading && <Amount cents={f.credits - f.debits} />}
                </td>
                <td className="text-right">{f.count}</td>
                <td
                  className={`text-right font-medium ${share === 100 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300"}`}
                >
                  {share}%
                </td>
              </tr>
            );
          })}
        </Sheet>
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <h3 className="font-semibold">Banco × sistema</h3>
          <p className="text-sm text-muted-foreground">
            Compara o extrato do Sicoob com as baixas e transferências registradas na conta{" "}
            {connection?.name ?? "vinculada"}. Diferenças indicam lançamentos sem baixa ou baixas em
            outra conta.
          </p>
        </div>
        <Sheet
          label="Banco versus sistema"
          maxHeight=""
          columns={[
            { label: "Mês" },
            { label: "Entradas banco", align: "right" },
            { label: "Entradas sistema", align: "right" },
            { label: "Saídas banco", align: "right" },
            { label: "Saídas sistema", align: "right" },
            { label: "Diferença", align: "right" },
            { label: "Situação" },
          ]}
        >
          {flow.map((f, i) => {
            const s = system(f.month);
            const diff = f.credits - f.debits - (s.credits - s.debits);
            const matches = f.credits === s.credits && f.debits === s.debits;
            return (
              <tr key={f.month}>
                <SheetGutter n={i + 1} />
                <td className="whitespace-nowrap">{monthLabel(f.month)}</td>
                <td className="whitespace-nowrap text-right">{currency(f.credits)}</td>
                <td
                  className={`whitespace-nowrap text-right ${f.credits !== s.credits ? "bg-amber-500/10" : ""}`}
                >
                  {currency(s.credits)}
                </td>
                <td className="whitespace-nowrap text-right">{currency(f.debits)}</td>
                <td
                  className={`whitespace-nowrap text-right ${f.debits !== s.debits ? "bg-amber-500/10" : ""}`}
                >
                  {currency(s.debits)}
                </td>
                <td className="whitespace-nowrap text-right font-medium">
                  {diff ? <Amount cents={diff} /> : currency(0)}
                </td>
                <td>
                  <StatusChip status={matches ? "Confere" : "Diferença"} />
                </td>
              </tr>
            );
          })}
        </Sheet>
        <p className="text-xs text-muted-foreground">
          Confere: banco e sistema iguais. Diferença: há movimentação a investigar (célula destacada
          em amarelo).
        </p>
      </Card>

      <Card className="space-y-5 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Detalhe de {monthLabel(month)}</h3>
            <p className="text-sm text-muted-foreground">
              {monthRows.length} movimentações · {pending.length} para conciliar
            </p>
          </div>
          <Input
            type="month"
            className="w-auto"
            aria-label="Mês do detalhe bancário"
            max={today.slice(0, 7)}
            value={month}
            onChange={(e) => {
              if (e.target.value) setMonth(e.target.value);
            }}
          />
        </div>
        {rows.isPending && <p role="status">Carregando movimentações…</p>}
        {rows.isError && <p role="alert">Não foi possível carregar as movimentações deste mês.</p>}
        {rows.data && !monthRows.length && (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhuma movimentação importada neste mês. Atualize o extrato em Contas e extratos.
          </p>
        )}
        {!!monthRows.length && (
          <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <section className="space-y-3">
              <h4 className="text-sm font-medium">Por tipo de histórico</h4>
              <ul className="space-y-1">
                {grouped.map(([name, g]) => {
                  const net = g.credits + g.debits;
                  const income = net >= 0;
                  const size = Math.max(g.credits, -g.debits);
                  return (
                    <li key={name}>
                      <button
                        type="button"
                        onClick={() => setHistoryFilter(name)}
                        className={`w-full rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${historyFilter === name ? "bg-muted" : ""}`}
                      >
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate">
                            {name}{" "}
                            <span className="text-xs text-muted-foreground">· {g.count}×</span>
                          </span>
                          <span
                            className={`shrink-0 font-medium tabular-nums ${income ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}
                          >
                            {income ? "+" : "−"}
                            {currency(Math.abs(net))}
                          </span>
                        </span>
                        <span className="mt-1.5 block h-1.5 rounded-full bg-muted">
                          <span
                            className={`block h-full rounded-full ${income ? "bg-emerald-600 dark:bg-emerald-400" : "bg-destructive"}`}
                            style={{ width: `${Math.max(2, (size / maxGroup) * 100)}%` }}
                          />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  className="flex rounded-lg border bg-muted/40 p-1"
                  role="group"
                  aria-label="Movimentações"
                >
                  {(
                    [
                      ["largest", "Maiores"],
                      ["pending", `Para conciliar (${pending.length})`],
                      ["all", "Todas"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={detailView === value && !historyFilter}
                      onClick={() => {
                        setDetailView(value);
                        setHistoryFilter(null);
                      }}
                      className={`rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        detailView === value && !historyFilter
                          ? "bg-card font-semibold shadow-sm ring-1 ring-border"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {historyFilter && (
                  <button
                    type="button"
                    onClick={() => setHistoryFilter(null)}
                    className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
                  >
                    {historyFilter} ✕
                  </button>
                )}
              </div>
              <TransactionList
                userId={userId}
                rows={
                  historyFilter
                    ? monthRows.filter((row) => bankHistoryGroup(row.description) === historyFilter)
                    : detailView === "largest"
                      ? largest
                      : detailView === "pending"
                        ? pending
                        : [...monthRows].sort((x, y) => x.booked_on.localeCompare(y.booked_on))
                }
                openStatement={openStatement}
                empty={
                  detailView === "pending"
                    ? "Todas as movimentações deste mês estão conciliadas."
                    : "Nenhuma movimentação."
                }
              />
              {detailView === "pending" && !historyFilter && pending.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {currency(pendingTotal)} em movimentações sem baixa vinculada.
                </p>
              )}
            </section>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Bank-app style list: direction icon, readable history, counterpart and amount. */
function TransactionList({
  rows,
  userId,
  openStatement,
  empty = "Nenhuma movimentação.",
}: {
  rows: BankTransaction[];
  userId: string;
  openStatement?: () => void;
  empty?: string;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<BankTransaction | null>(null);
  const [reconciling, setReconciling] = useState<BankTransaction | null>(null);
  if (!rows.length)
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        {empty}
      </p>
    );
  const parts = selected ? bankDescriptionParts(selected.description) : null;
  return (
    <>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {rows.map((row) => {
          const { title, detail } = bankDescriptionParts(row.description);
          const income = row.amount_cents > 0;
          const Icon = income ? ArrowDownLeft : ArrowUpRight;
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => (row.settlement_id ? setSelected(row) : setReconciling(row))}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span
                  aria-hidden
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${income ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-destructive/10 text-destructive"}`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {displayDate(row.booked_on)}
                    {detail ? ` · ${detail}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={`block text-sm font-semibold tabular-nums ${income ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}
                  >
                    {income ? "+" : "−"}
                    {currency(Math.abs(row.amount_cents))}
                  </span>
                  {!row.settlement_id && (
                    <span className="text-[11px] text-amber-700 dark:text-amber-300">
                      Para conciliar
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {reconciling && (
        <ReconcileDialog
          key={reconciling.id}
          transaction={reconciling}
          userId={userId}
          close={() => setReconciling(null)}
          refresh={async () => {
            await queryClient.invalidateQueries({ queryKey: ["office-bank", userId] });
            await queryClient.invalidateQueries({ queryKey: ["office-bank-periods", userId] });
          }}
        />
      )}
      {selected && parts && (
        <Dialog open onOpenChange={(open) => !open && setSelected(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{parts.title}</DialogTitle>
              <DialogDescription>
                {parts.detail || "Movimentação do extrato Sicoob"}
              </DialogDescription>
            </DialogHeader>
            <p
              className={`text-3xl font-semibold tabular-nums ${selected.amount_cents > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}
            >
              {selected.amount_cents > 0 ? "+" : "−"}
              {currency(Math.abs(selected.amount_cents))}
            </p>
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Data</dt>
              <dd>{displayDate(selected.booked_on)}</dd>
              <dt className="text-muted-foreground">Tipo</dt>
              <dd>{selected.amount_cents > 0 ? "Entrada" : "Saída"}</dd>
              <dt className="text-muted-foreground">Conciliação</dt>
              <dd>
                <StatusChip status={selected.settlement_id ? "Conciliada" : "Pendente"} />
              </dd>
              <dt className="text-muted-foreground">Histórico do banco</dt>
              <dd className="break-words text-xs text-muted-foreground">{selected.description}</dd>
            </dl>
            {openStatement && (
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelected(null);
                    openStatement();
                  }}
                >
                  Abrir no extrato
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
