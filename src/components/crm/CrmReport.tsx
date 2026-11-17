import { useState } from "react";
import { addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FinanceFlowChart } from "@/components/finance/FinanceBalanceChart";
import { DetailRows, KpiStrip, Sheet, SheetGutter } from "@/components/finance/FinanceSheet";

// CRM report built only from the leads already loaded on the page.

export type CrmReportLead = {
  id: string;
  title: string;
  company_name: string | null;
  client_id: string | null;
  stage: string;
  source: string | null;
  amount: number | null;
  expected_close_date: string | null;
  created_at: string;
  updated_at: string;
};

type Period = "30" | "90" | "365" | "all";

const brl = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const brDate = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const STALE_DAYS = 14;

export function CrmReport({
  leads,
  stages,
  clientNames,
  today,
  wonStage = "finalizado",
  openLead,
}: {
  leads: CrmReportLead[];
  stages: { id: string; label: string; color: string }[];
  clientNames: Map<string, string>;
  /** YYYY-MM-DD in America/Sao_Paulo. */
  today: string;
  wonStage?: string;
  openLead: (id: string) => void;
}) {
  const [period, setPeriod] = useState<Period>("90");
  const days = period === "all" ? null : Number(period);
  const since = (offset: number) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
  };
  const start = days === null ? "" : since(days);
  const previousStart = days === null ? "" : since(days * 2);
  const created = (lead: CrmReportLead) => lead.created_at.slice(0, 10);
  const inPeriod = leads.filter((lead) => created(lead) >= start);
  const previous =
    days === null
      ? []
      : leads.filter((lead) => created(lead) >= previousStart && created(lead) < start);
  const won = inPeriod.filter((lead) => lead.stage === wonStage);
  const open = leads.filter((lead) => lead.stage !== wonStage);
  const value = (list: CrmReportLead[]) => list.reduce((sum, lead) => sum + (lead.amount ?? 0), 0);
  const conversion = inPeriod.length ? Math.round((won.length / inPeriod.length) * 100) : null;
  const growth = previous.length
    ? Math.round(((inPeriod.length - previous.length) / previous.length) * 100)
    : null;
  const in30 = since(-30);
  const forecast = open.filter(
    (lead) =>
      lead.expected_close_date &&
      lead.expected_close_date >= today &&
      lead.expected_close_date <= in30,
  );
  const overdueClose = open.filter(
    (lead) => lead.expected_close_date && lead.expected_close_date < today,
  );
  const stale = open.filter(
    (lead) =>
      differenceInCalendarDays(parseISO(today), parseISO(lead.updated_at.slice(0, 10))) >=
      STALE_DAYS,
  );
  const wonLabel = stages.find((stage) => stage.id === wonStage)?.label ?? "Finalizado";

  // Funnel: current position of every lead (not limited by period).
  const funnel = stages.map((stage) => {
    const list = leads.filter((lead) => lead.stage === stage.id);
    return { ...stage, count: list.length, value: value(list) };
  });
  const funnelMax = Math.max(1, ...funnel.map((stage) => stage.count));

  const months = Array.from({ length: 12 }, (_, index) =>
    format(addMonths(parseISO(today.slice(0, 7) + "-01"), index - 11), "yyyy-MM"),
  );
  const monthly = months.map((month) => ({
    key: month,
    label: format(parseISO(month + "-01"), "MMM/yy", { locale: ptBR }).replace(/^./, (c) =>
      c.toUpperCase(),
    ),
    income: leads.filter((lead) => lead.created_at.startsWith(month)).length,
    expense: leads.filter((lead) => lead.created_at.startsWith(month) && lead.stage === wonStage)
      .length,
  }));

  const bySource = new Map<string, CrmReportLead[]>();
  for (const lead of inPeriod) {
    const key = lead.source?.trim() || "Não informada";
    bySource.set(key, [...(bySource.get(key) ?? []), lead]);
  }
  const sources = [...bySource.entries()].sort((a, b) => b[1].length - a[1].length);

  const attention = [
    ...overdueClose.map((lead) => ({ lead, reason: "Fechamento previsto já passou" })),
    ...stale
      .filter((lead) => !overdueClose.includes(lead))
      .map((lead) => ({ lead, reason: `Sem atualização há ${STALE_DAYS}+ dias` })),
  ].slice(0, 10);
  const nameOf = (lead: CrmReportLead) =>
    clientNames.get(lead.client_id ?? "") ?? lead.company_name ?? "";
  const stageOf = (id: string) => stages.find((stage) => stage.id === id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Relatório comercial</h2>
          <p className="text-sm text-muted-foreground">
            Leads criados no período, conversão e o que precisa de atenção.
          </p>
        </div>
        <div className="flex rounded-lg border bg-muted/40 p-1" role="group" aria-label="Período">
          {(
            [
              ["30", "30 dias"],
              ["90", "90 dias"],
              ["365", "12 meses"],
              ["all", "Tudo"],
            ] as const
          ).map(([option, label]) => (
            <button
              key={option}
              type="button"
              aria-pressed={period === option}
              onClick={() => setPeriod(option)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                period === option
                  ? "bg-card font-semibold shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <KpiStrip
        items={[
          {
            label: "Novos leads",
            value: String(inPeriod.length),
            tone: "balance",
            hint:
              growth === null
                ? days === null
                  ? "Desde o início"
                  : "Sem base no período anterior"
                : `${growth > 0 ? "+" : ""}${growth}% vs. período anterior`,
            summary: `Leads criados no período${previous.length ? `; no período anterior foram ${previous.length}` : ""}. Clique no nome para abrir o lead.`,
            detail: () => (
              <DetailRows
                rows={inPeriod.map((lead) => ({
                  key: lead.id,
                  date: lead.created_at,
                  title: (
                    <button
                      type="button"
                      className="text-left underline-offset-2 hover:underline"
                      onClick={() => openLead(lead.id)}
                    >
                      {lead.title}
                    </button>
                  ),
                  subtitle: [nameOf(lead), stageOf(lead.stage)?.label].filter(Boolean).join(" · "),
                  value: brl(lead.amount ?? 0),
                }))}
                total={brl(value(inPeriod))}
                empty="Nenhum lead criado no período."
              />
            ),
          },
          {
            label: `Taxa de conversão (${wonLabel.toLocaleLowerCase("pt-BR")})`,
            value: conversion === null ? "—" : `${conversion}%`,
            tone: "income",
            hint: `${won.length} de ${inPeriod.length} leads do período`,
            summary: `Leads criados no período que hoje estão em ${wonLabel}, divididos pelo total de leads do período.`,
            detail: () => (
              <DetailRows
                rows={won.map((lead) => ({
                  key: lead.id,
                  date: lead.created_at,
                  title: (
                    <button
                      type="button"
                      className="text-left underline-offset-2 hover:underline"
                      onClick={() => openLead(lead.id)}
                    >
                      {lead.title}
                    </button>
                  ),
                  subtitle: [nameOf(lead), stageOf(lead.stage)?.label].filter(Boolean).join(" · "),
                  value: brl(lead.amount ?? 0),
                }))}
                total={brl(value(won))}
                empty="Nenhum lead fechado no período."
              />
            ),
          },
          {
            label: "Ticket médio fechado",
            value: won.length ? brl(value(won) / won.length) : "—",
            tone: "income",
            hint: `${brl(value(won))} fechados no período`,
            summary: `Valor dos leads fechados (${brl(value(won))}) dividido pela quantidade (${won.length}).`,
            detail: () => (
              <DetailRows
                rows={won.map((lead) => ({
                  key: lead.id,
                  date: lead.created_at,
                  title: (
                    <button
                      type="button"
                      className="text-left underline-offset-2 hover:underline"
                      onClick={() => openLead(lead.id)}
                    >
                      {lead.title}
                    </button>
                  ),
                  subtitle: [nameOf(lead), stageOf(lead.stage)?.label].filter(Boolean).join(" · "),
                  value: brl(lead.amount ?? 0),
                }))}
                total={brl(value(won))}
                empty="Nenhum lead fechado no período."
              />
            ),
          },
          {
            label: "Em negociação",
            value: brl(value(open)),
            tone: "neutral",
            hint: `${open.length} leads abertos · ${brl(value(forecast))} previstos em 30 dias`,
            summary:
              "Soma do valor de todos os leads que ainda não foram finalizados, de qualquer período.",
            detail: () => (
              <DetailRows
                rows={[...open]
                  .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
                  .map((lead) => ({
                    key: lead.id,
                    date: lead.created_at,
                    title: (
                      <button
                        type="button"
                        className="text-left underline-offset-2 hover:underline"
                        onClick={() => openLead(lead.id)}
                      >
                        {lead.title}
                      </button>
                    ),
                    subtitle: [nameOf(lead), stageOf(lead.stage)?.label]
                      .filter(Boolean)
                      .join(" · "),
                    value: brl(lead.amount ?? 0),
                  }))}
                total={brl(value(open))}
                empty="Nenhum lead em negociação."
              />
            ),
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-xl border bg-card p-4 md:p-5">
          <h3 className="mb-4 font-semibold">Funil por etapa</h3>
          <ul className="space-y-3">
            {funnel.map((stage) => (
              <li key={stage.id} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: stage.color }}
                    />
                    <span className="truncate">{stage.label}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <strong>{stage.count}</strong>{" "}
                    <span className="text-xs text-muted-foreground">{brl(stage.value)}</span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(stage.count ? 3 : 0, (stage.count / funnelMax) * 100)}%`,
                      background: stage.color,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Posição atual de todos os leads, independentemente do período.
          </p>
        </section>
        <section className="min-w-0 rounded-xl border bg-card p-4 md:p-5">
          <h3 className="mb-3 font-semibold">Leads por mês · 12 meses</h3>
          <FinanceFlowChart
            label="Novos leads e leads finalizados por mês de criação"
            incomeLabel="Novos leads"
            expenseLabel={`Hoje em ${wonLabel}`}
            format={(n) => String(n)}
            axisFormat={(n) => String(Math.round(n))}
            showResult={false}
            integer
            incomeColor="bg-primary"
            expenseColor="bg-emerald-600 dark:bg-emerald-400"
            data={monthly}
          />
        </section>
      </div>

      <section className="space-y-3 rounded-xl border bg-card p-4 md:p-5">
        <h3 className="font-semibold">Conversão por origem</h3>
        {sources.length ? (
          <Sheet
            label="Conversão por origem"
            maxHeight=""
            columns={[
              { label: "Origem" },
              { label: "Leads", align: "right" },
              { label: wonLabel, align: "right" },
              { label: "Conversão", align: "right" },
              { label: "Valor fechado", align: "right" },
              { label: "Em negociação", align: "right" },
            ]}
          >
            {sources.map(([source, list], index) => {
              const closed = list.filter((lead) => lead.stage === wonStage);
              const rate = Math.round((closed.length / list.length) * 100);
              return (
                <tr key={source}>
                  <SheetGutter n={index + 1} />
                  <td className="min-w-36">{source}</td>
                  <td className="text-right">{list.length}</td>
                  <td className="text-right">{closed.length}</td>
                  <td
                    className={`text-right font-medium ${rate >= 30 ? "text-emerald-700 dark:text-emerald-400" : rate === 0 ? "text-muted-foreground" : ""}`}
                  >
                    {rate}%
                  </td>
                  <td className="whitespace-nowrap text-right">{brl(value(closed))}</td>
                  <td className="whitespace-nowrap text-right text-muted-foreground">
                    {brl(value(list.filter((lead) => lead.stage !== wonStage)))}
                  </td>
                </tr>
              );
            })}
          </Sheet>
        ) : (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhum lead criado neste período.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4 md:p-5">
        <div>
          <h3 className="font-semibold">Precisam de atenção</h3>
          <p className="text-sm text-muted-foreground">
            Leads abertos com fechamento previsto vencido ou sem atualização há {STALE_DAYS} dias ou
            mais. Clique para abrir.
          </p>
        </div>
        {attention.length ? (
          <Sheet
            label="Leads que precisam de atenção"
            maxHeight=""
            columns={[
              { label: "Lead" },
              { label: "Etapa" },
              { label: "Valor", align: "right" },
              { label: "Previsão" },
              { label: "Motivo" },
            ]}
          >
            {attention.map(({ lead, reason }, index) => {
              const stage = stageOf(lead.stage);
              return (
                <tr key={lead.id} className="cursor-pointer" onClick={() => openLead(lead.id)}>
                  <SheetGutter n={index + 1} />
                  <td className="min-w-44">
                    <button
                      type="button"
                      className="text-left font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={(event) => {
                        event.stopPropagation();
                        openLead(lead.id);
                      }}
                    >
                      {lead.title}
                    </button>
                    {nameOf(lead) && (
                      <p className="text-xs text-muted-foreground">{nameOf(lead)}</p>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="h-2 w-2 rounded-full"
                        style={{ background: stage?.color }}
                      />
                      {stage?.label ?? lead.stage}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-right">{brl(lead.amount ?? 0)}</td>
                  <td
                    className={`whitespace-nowrap ${lead.expected_close_date && lead.expected_close_date < today ? "text-destructive" : ""}`}
                  >
                    {lead.expected_close_date ? brDate(lead.expected_close_date) : "—"}
                  </td>
                  <td className="whitespace-nowrap text-amber-700 dark:text-amber-300">{reason}</td>
                </tr>
              );
            })}
          </Sheet>
        ) : (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            Nenhum lead parado ou com previsão vencida.
          </p>
        )}
      </section>
    </div>
  );
}
