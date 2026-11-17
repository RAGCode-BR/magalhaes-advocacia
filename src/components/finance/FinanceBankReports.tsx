import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  currency,
  displayDate,
  financeRpc,
  isoToday,
  type OfficeFinanceData,
} from "@/lib/office-finance-data";
import { bankHistoryGroup, loadBankOverview, type BankTransaction } from "@/lib/office-bank";
import { FinanceFlowChart } from "./FinanceBalanceChart";
import { Amount, KpiStrip, Sheet, SheetGutter, SicoobLogo, StatusChip } from "./FinanceSheet";

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
}: {
  userId: string;
  ledger: OfficeFinanceData;
}) {
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
    .slice(0, 5);

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
            },
            {
              label: "Ticket médio de entrada",
              value: currency(averageIn),
              tone: "neutral",
              hint: `${incomingCount} ${incomingCount === 1 ? "entrada" : "entradas"} no mês`,
            },
            {
              label: "Maior entrada do mês",
              value: currency(largestIn),
              tone: "income",
              hint: largestInName,
            },
            {
              label: "Saídas sobre entradas",
              value: monthCredits ? `${Math.round((monthDebits / monthCredits) * 100)}%` : "—",
              tone: monthDebits > monthCredits ? "expense" : "balance",
              hint: `${currency(monthDebits)} de saídas no mês`,
            },
          ]}
        />
        <KpiStrip
          items={[
            {
              label: `Entradas · ${flow.length} meses`,
              value: currency(sum.credits),
              tone: "income",
            },
            {
              label: `Saídas · ${flow.length} meses`,
              value: currency(sum.debits),
              tone: "expense",
            },
            {
              label: "Resultado no período",
              value: currency(sum.credits - sum.debits),
              tone: "balance",
            },
            {
              label: "Não conciliadas",
              value: String(sum.pending),
              tone: sum.pending ? "alert" : "income",
              hint: `de ${sum.count} movimentações`,
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

      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">Detalhe do mês</h3>
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
          <div className="grid gap-4 xl:grid-cols-2">
            <section className="space-y-2">
              <h4 className="text-sm font-medium">Por tipo de histórico</h4>
              <ul className="space-y-3 rounded-xl border p-4">
                {grouped.map(([name, g]) => {
                  const cents = g.credits || -g.debits;
                  const income = g.credits >= -g.debits;
                  return (
                    <li key={name} className="text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate">
                          {name} <span className="text-xs text-muted-foreground">· {g.count}×</span>
                        </span>
                        <span
                          className={`shrink-0 font-medium tabular-nums ${income ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}
                        >
                          {income ? "+" : "−"}
                          {currency(Math.abs(g.credits + g.debits) || cents)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${income ? "bg-emerald-600 dark:bg-emerald-400" : "bg-destructive"}`}
                          style={{ width: `${Math.max(2, (cents / maxGroup) * 100)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="space-y-2">
              <h4 className="text-sm font-medium">Maiores movimentações</h4>
              <Sheet
                label="Maiores movimentações"
                maxHeight=""
                columns={[
                  { label: "Data" },
                  { label: "Histórico" },
                  { label: "Valor", align: "right" },
                ]}
              >
                {largest.map((row, i) => (
                  <tr key={row.id}>
                    <SheetGutter n={i + 1} />
                    <td className="whitespace-nowrap">{displayDate(row.booked_on)}</td>
                    <td className="min-w-32 break-words">{row.description}</td>
                    <td className="whitespace-nowrap text-right">
                      <Amount cents={row.amount_cents} />
                    </td>
                  </tr>
                ))}
              </Sheet>
              <h4 className="pt-2 text-sm font-medium">
                Pendências de conciliação · {pending.length} ({currency(pendingTotal)})
              </h4>
              {pending.length ? (
                <Sheet
                  label="Pendências de conciliação"
                  maxHeight="max-h-72"
                  columns={[
                    { label: "Data" },
                    { label: "Histórico" },
                    { label: "Valor", align: "right" },
                  ]}
                >
                  {pending.map((row, i) => (
                    <tr key={row.id}>
                      <SheetGutter n={i + 1} />
                      <td className="whitespace-nowrap">{displayDate(row.booked_on)}</td>
                      <td className="min-w-32 break-words">{row.description}</td>
                      <td className="whitespace-nowrap text-right">
                        <Amount cents={row.amount_cents} />
                      </td>
                    </tr>
                  ))}
                </Sheet>
              ) : (
                <p className="text-sm text-emerald-700 dark:text-emerald-400">
                  Todas as movimentações deste mês estão conciliadas.
                </p>
              )}
            </section>
          </div>
        )}
      </Card>
    </div>
  );
}
