import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Plus, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useClients, useTasks } from "@/hooks/use-data";
import { financeShortcut } from "@/lib/finance-shortcuts";
import { OPEN_OVERLAY_SELECTOR } from "@/lib/keyboard-screen-nav";
import { FinanceReconciliation } from "@/components/finance/FinanceReconciliation";
import { FinanceAttachments } from "@/components/finance/FinanceAttachments";
import { ClientPicker } from "@/components/ClientPicker";
import { SuggestInput } from "@/components/SuggestInput";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  financeCents,
  financeInstallments,
  financeRecurrences,
  financeFrequencies,
  type FinanceFrequency,
  financeStatus,
  financeLedgerBuckets,
  financeSettlementAmounts,
  type FinanceEntry,
  type FinanceKind,
  type FinanceSettlement,
  type FinanceAccount,
  type FinanceRegister,
  financeCsv,
  financePlanDepth,
  financePlanOptions,
  financePlanSort,
} from "@/lib/office-finance";

export const Route = createFileRoute("/_app/financeiro")({ component: FinanceRoute });

// Conta-a-receber/pagar summary tabs, in the order an office reviews them.
type QuickFilter = "all" | "overdue" | "today" | "upcoming" | "settled";
function quickBucket(entry: FinanceEntry, today: string): QuickFilter | "cancelled" {
  if (entry.cancelled_at) return "cancelled";
  if (entry.settled_cents >= entry.amount_cents) return "settled";
  if (entry.due_date < today) return "overdue";
  if (entry.due_date === today) return "today";
  return "upcoming";
}
const quickFilters = (kind: FinanceKind) =>
  [
    {
      value: "overdue",
      label: "Vencidos",
      dot: "bg-destructive",
      bar: "after:bg-destructive",
      text: "text-destructive",
    },
    {
      value: "today",
      label: "Vencem hoje",
      dot: "bg-amber-500",
      bar: "after:bg-amber-500",
      text: "text-amber-700 dark:text-amber-300",
    },
    { value: "upcoming", label: "A vencer", dot: "bg-sky-500", bar: "after:bg-sky-500", text: "" },
    {
      value: "settled",
      label: kind === "income" ? "Recebidos" : "Pagos",
      dot: "bg-emerald-600 dark:bg-emerald-400",
      bar: "after:bg-emerald-600 dark:after:bg-emerald-400",
      text: "text-emerald-700 dark:text-emerald-400",
    },
    {
      value: "all",
      label: "Total do período",
      dot: "bg-primary",
      bar: "after:bg-primary",
      text: "",
    },
  ] as const satisfies readonly {
    value: QuickFilter;
    label: string;
    dot: string;
    bar: string;
    text: string;
  }[];

import {
  currency,
  displayDate,
  isoToday,
  selectClass,
  fieldClass,
  table,
  financeRpc,
  loadOfficeFinance,
  saveCsv,
  type FinanceTable,
  type DocumentInfo,
  type OfficeFinanceData,
} from "@/lib/office-finance-data";
import { FinanceAgreements } from "@/components/finance/FinanceAgreements";
import { FinanceOrders } from "@/components/finance/FinanceOrders";
import { FinanceRegisters } from "@/components/finance/FinanceRegisters";
import { FinanceAccounts } from "@/components/finance/FinanceAccounts";
import { FinanceBoletos } from "@/components/finance/FinanceBoletos";
import { FinanceDashboard } from "@/components/finance/FinanceDashboard";
import { FinanceBankReports } from "@/components/finance/FinanceBankReports";
import { FinanceReports, FinanceHistoryPanel } from "@/components/finance/FinanceReports";
import { Sheet, SheetGutter, StatusChip } from "@/components/finance/FinanceSheet";
import { FinanceActionDialog, type FinanceAction } from "@/components/finance/FinanceActionDialog";
import { FinanceImportStatus } from "@/components/finance/FinanceImportStatus";
import { FinanceEntryEditor } from "@/components/finance/FinanceEntryEditor";

async function insertFinance(name: FinanceTable, values: object | object[]) {
  const { error } = await table(name).upsert(values as never, {
    onConflict: "id",
    ignoreDuplicates: true,
  });
  if (error) throw error;
}

// Grouped by what the office is doing: day-to-day money, sales and long-lived setup.
// Contratos, Serviços, Ordens de serviço and Compras are hidden from the menu at the
// office's request; their components and data are kept untouched.
const financeSections: { label: string; items: [string, string][] }[] = [
  {
    label: "Movimento",
    items: [
      ["dashboard", "Painel"],
      ["entries", "Lançamentos"],
      ["accounts", "Contas e extratos"],
      ["reconciliation", "Conciliação bancária"],
      ["boletos", "Boletos"],
    ],
  },
  {
    label: "Gestão",
    items: [
      ["registers", "Plano de contas"],
      ["reports", "Relatórios"],
      ["history", "Histórico"],
    ],
  },
];

function FinanceRoute() {
  const { isAdmin, isClient, user } = useAuth();
  if (!isAdmin || isClient || !user) return <Navigate to="/settings" replace />;
  return <FinancePage key={user.id} userId={user.id} />;
}

function FinancePage({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["office-finance", userId];
  const { data: clients = [] } = useClients();
  const { data: tasks = [] } = useTasks();
  const ledger = useQuery({
    queryKey,
    queryFn: loadOfficeFinance,
  });
  const [section, setSection] = useState("dashboard");
  const [clientFilter, setClientFilter] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const monthEnd = (month: string) => {
    const [year, number] = month.split("-").map(Number);
    return `${month}-${String(new Date(year, number, 0).getDate()).padStart(2, "0")}`;
  };
  const selectedMonth = dueFrom.endsWith("-01") && dueTo === monthEnd(dueFrom.slice(0, 7)) ? dueFrom.slice(0, 7) : "";
  const [kind, setKind] = useState<FinanceKind>("income");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [openBank, setOpenBank] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [centerFilter, setCenterFilter] = useState("");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [draft, setDraft] = useState<{ id: string; kind: FinanceKind } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [attachmentId, setAttachmentId] = useState<string | null>(null);

  const entries = ledger.data?.entries ?? [];
  const settlements = ledger.data?.settlements ?? [];
  const documents = ledger.data?.documents ?? [];
  const selected = entries.find((entry) => entry.id === selectedId);
  const attachmentEntry = entries.find((entry) => entry.id === attachmentId);
  const today = isoToday();
  const kindEntries = entries.filter((entry) => entry.kind === kind);
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const planCodes = new Map(
    (ledger.data?.registers ?? [])
      .filter((item) => item.kind === "category" && item.code)
      .map((item) => [item.name, item.code ?? ""]),
  );
  const processNames = new Map(tasks.map((task) => [task.id, task.title]));
  // Filters list every plan account and every cost center, registered or used by an
  // entry, so nothing is hidden by the Contas a receber / Contas a pagar choice.
  const registers = ledger.data?.registers ?? [];
  const used = (field: "category" | "cost_center") =>
    entries.map((entry) => entry[field]).filter((value): value is string => !!value);
  const planAccounts = registers.filter((item) => item.kind === "category").sort(financePlanSort);
  const planNature = (name: string) =>
    planAccounts.find((item) => item.name === name)?.nature ??
    (entries.some((e) => e.category === name && e.kind === "income")
      ? entries.some((e) => e.category === name && e.kind === "expense")
        ? null
        : "income"
      : entries.some((e) => e.category === name)
        ? "expense"
        : null);
  const planNames = [
    ...new Set([...planAccounts.map((item) => item.name), ...used("category")]),
  ];
  const planGroups = (
    [
      ["Receitas", "income"],
      ["Despesas", "expense"],
      ["Receitas e despesas", null],
    ] as const
  )
    .map(([label, nature]) => ({
      label,
      names: planNames.filter((name) => (planNature(name) ?? null) === nature),
    }))
    .filter((group) => group.names.length);
  const centerNames = [
    ...new Set([
      ...registers.filter((item) => item.kind === "cost_center").map((item) => item.name),
      ...used("cost_center"),
    ]),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const filteredEntries = kindEntries
    .filter((entry) => {
      if (clientFilter && entry.client_id !== clientFilter) return false;
      if (categoryFilter && entry.category !== categoryFilter) return false;
      if (centerFilter && entry.cost_center !== centerFilter) return false;
      if (minValue && entry.amount_cents < Number(minValue) * 100) return false;
      if (maxValue && entry.amount_cents > Number(maxValue) * 100) return false;
      if ((dueFrom && entry.due_date < dueFrom) || (dueTo && entry.due_date > dueTo)) return false;
      return [
        entry.description,
        entry.category,
        entry.supplier,
        entry.cost_center,
        clientNames.get(entry.client_id ?? "") ?? entry.counterparty_name,
        processNames.get(entry.process_id ?? ""),
      ].some((value) =>
        value?.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")),
      );
    })
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  const { buckets: bucketTotals, cash: cashByEntry } = financeLedgerBuckets(
    filteredEntries,
    settlements,
    today,
  );
  const rows = filteredEntries.filter(
    (entry) =>
      quick === "all" ||
      (quick === "settled"
        ? (cashByEntry.get(entry.id) ?? 0) > 0
        : quickBucket(entry, today) === quick),
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  // R = nova receita, D = nova despesa, from any tab (never while typing or with a dialog open).
  const ready = !!ledger.data;
  useEffect(() => {
    if (!ready) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const kind = financeShortcut(event, document.querySelector(OPEN_OVERLAY_SELECTOR) != null);
      if (!kind) return;
      event.preventDefault();
      setDraft((current) => current ?? { id: crypto.randomUUID(), kind });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ready]);

  const shortcutHint = (key: string) => (
    <kbd
      aria-hidden
      className="ml-0.5 hidden min-w-5 rounded border border-current/25 px-1 text-[11px] font-semibold leading-4 opacity-70 sm:inline-block"
    >
      {key}
    </kbd>
  );

  return (
    <section className="mx-auto w-full min-w-0 max-w-none space-y-5 p-3 md:p-5">
      {/* Title, new-entry buttons and tabs stay on screen while long lists scroll.
          Solid background on purpose: a backdrop-filter on a sticky header inside the
          scrolling <main> makes Chrome/Safari skip repainting parts of the long
          dashboard after scrolling to the bottom and back up (blank areas). */}
      <div className="sticky top-0 z-30 border-b border-border/75 bg-background -mx-3 -mt-3 space-y-3 px-3 pb-3 pt-3 md:-mx-5 md:-mt-5 md:px-5 md:pt-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Receitas, despesas, contas bancárias e relatórios do escritório.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setDraft({ id: crypto.randomUUID(), kind: "expense" })}
            disabled={!ledger.data}
            title="Nova despesa (atalho: D)"
            aria-keyshortcuts="D"
          >
            <Plus /> Nova despesa {shortcutHint("D")}
          </Button>
          <Button
            onClick={() => setDraft({ id: crypto.randomUUID(), kind: "income" })}
            disabled={!ledger.data}
            title="Nova receita (atalho: R)"
            aria-keyshortcuts="R"
          >
            <Plus /> Nova receita {shortcutHint("R")}
          </Button>
        </div>
      </header>
      <nav
        className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden"
        aria-label="Seções do financeiro"
      >
        <div className="flex w-max items-center gap-1 rounded-xl border bg-muted/40 p-1">
          {financeSections.map((group, groupIndex) => (
            <div
              key={group.label}
              role="group"
              aria-label={group.label}
              className="flex items-center gap-1"
            >
              {groupIndex > 0 && <span aria-hidden className="mx-1 h-5 w-px bg-border" />}
              {group.items.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-current={section === value ? "page" : undefined}
                  onClick={() => setSection(value)}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    section === value
                      ? "bg-card font-semibold text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </nav>
      </div>
      {ledger.data && <FinanceImportStatus userId={userId} ledger={ledger.data} />}
      {ledger.isPending && <p role="status">Carregando o financeiro…</p>}
      {ledger.isError && (
        <Card className="flex flex-wrap items-center gap-3 p-4" role="alert">
          Não foi possível carregar o financeiro.
          <Button variant="outline" onClick={() => void ledger.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      )}
      {ledger.data && section === "entries" && (
        <>
          <Card className="space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                className="flex rounded-lg border bg-muted/40 p-1"
                role="group"
                aria-label="Tipo de lançamento"
              >
                {(
                  [
                    ["income", "Contas a receber"],
                    ["expense", "Contas a pagar"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={kind === value}
                    onClick={() => {
                      setKind(value);
                      setQuick("all");
                      // A plan account of the other type would leave the list empty.
                      const nature = planNature(categoryFilter);
                      if (nature && nature !== value) setCategoryFilter("");
                    }}
                    className={`rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      kind === value
                        ? "bg-card font-semibold shadow-sm ring-1 ring-border"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Input
                className="sm:max-w-xs"
                placeholder="Buscar lançamento, cliente ou processo"
                aria-label="Buscar lançamentos"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div
              className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3 lg:grid-cols-5"
              role="group"
              aria-label="Filtrar por situação"
            >
              {quickFilters(kind).map((filter) => {
                const item = bucketTotals[filter.value];
                const activeTab = quick === filter.value;
                return (
                  <button
                    key={filter.value}
                    type="button"
                    aria-pressed={activeTab}
                    onClick={() => setQuick(filter.value)}
                    className={`relative min-w-0 px-4 py-3 text-left transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] ${
                      activeTab
                        ? `bg-card ${filter.bar}`
                        : "bg-card/70 after:bg-transparent hover:bg-card"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <span aria-hidden className={`h-2 w-2 rounded-full ${filter.dot}`} />
                      {filter.label}
                    </span>
                    <span
                      className={`mt-1.5 block text-xl font-semibold leading-none tracking-tight tabular-nums ${item.cents ? filter.text : ""}`}
                    >
                      {currency(item.cents)}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {item.count} {item.count === 1 ? "lançamento" : "lançamentos"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <label className={fieldClass}>Mês de vencimento
                <Input type="month" aria-label="Filtrar mês de vencimento" value={selectedMonth} onChange={event => { const month = event.target.value; setDueFrom(month ? `${month}-01` : ""); setDueTo(month ? monthEnd(month) : ""); }} />
              </label>
              <div className={fieldClass}>
                Cliente
                <ClientPicker
                  aria-label="Filtrar por cliente"
                  clients={clients}
                  value={clientFilter}
                  emptyLabel="Todos os clientes"
                  onChange={setClientFilter}
                />
              </div>
              <label className={fieldClass}>
                Vencimento inicial
                <Input
                  type="date"
                  value={dueFrom}
                  onChange={(event) => setDueFrom(event.target.value)}
                />
              </label>
              <label className={fieldClass}>
                Vencimento final
                <Input
                  type="date"
                  value={dueTo}
                  min={dueFrom}
                  onChange={(event) => setDueTo(event.target.value)}
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className={fieldClass}>
                Plano de contas
                <select
                  className="h-10 rounded-md border bg-background px-3"
                  value={categoryFilter}
                  onChange={(e) => {
                    const name = e.target.value;
                    setCategoryFilter(name);
                    // Choosing a despesa while on Contas a receber (or the opposite) switches the list.
                    const nature = planNature(name);
                    if (nature && nature !== kind) {
                      setKind(nature);
                      setQuick("all");
                    }
                  }}
                >
                  <option value="">Todas as contas</option>
                  {planGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.names.map((name) => {
                        const code = planCodes.get(name);
                        return (
                          <option key={name} value={name}>
                            {code ? `${code} ` : ""}
                            {name}
                          </option>
                        );
                      })}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className={fieldClass}>
                Centro de custo
                <select
                  className="h-10 rounded-md border bg-background px-3"
                  value={centerFilter}
                  onChange={(e) => setCenterFilter(e.target.value)}
                >
                  <option value="">Todos os centros</option>
                  {centerNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={fieldClass}>Valor mínimo (R$)<Input type="number" min="0" step="0.01" value={minValue} onChange={e => setMinValue(e.target.value)} /></label>
              <label className={fieldClass}>Valor máximo (R$)<Input type="number" min={minValue || "0"} step="0.01" value={maxValue} onChange={e => setMaxValue(e.target.value)} /></label>
            </div>
            <div className="flex flex-wrap items-center gap-3"><span className="text-sm text-muted-foreground">{rows.length} lançamentos encontrados</span><Button variant="ghost" onClick={() => { setSearch(""); setClientFilter(""); setDueFrom(""); setDueTo(""); setCategoryFilter(""); setCenterFilter(""); setMinValue(""); setMaxValue(""); setQuick("all"); }}>Limpar filtros</Button></div>
            <Button
              variant="outline"
              onClick={() =>
                saveCsv(
                  financeCsv([
                    [
                      "Descrição",
                      "Cliente",
                      "Categoria",
                      "Centro de custo",
                      "Vencimento",
                      "Valor (R$)",
                      "Em aberto (R$)",
                      "Situação",
                    ],
                    ...rows.map((entry) => [
                      entry.description,
                      clientNames.get(entry.client_id ?? "") ?? entry.counterparty_name,
                      entry.category,
                      entry.cost_center,
                      displayDate(entry.due_date),
                      (entry.amount_cents / 100).toFixed(2).replace(".", ","),
                      ((entry.amount_cents - entry.settled_cents) / 100)
                        .toFixed(2)
                        .replace(".", ","),
                      financeStatus(entry, today),
                    ]),
                  ]),
                  kind === "income" ? "contas-a-receber.csv" : "contas-a-pagar.csv",
                )
              }
            >
              Exportar lista CSV
            </Button>
            {rows.length ? (
              <Sheet fit
                label={kind === "income" ? "Contas a receber" : "Contas a pagar"}
                columns={[
                  { label: "Vencimento" },
                  { label: "Lançamento" },
                  { label: "Conta do plano" },
                  { label: "Centro de custo" },
                  { label: "Valor", align: "right" },
                  { label: "Em aberto", align: "right" },
                  { label: "Situação" },
                  { label: "" },
                ]}
                footer={
                  <tr>
                    <td className="fin-sheet-gutter">Σ</td>
                    <td colSpan={4}>
                      {rows.length} {rows.length === 1 ? "lançamento" : "lançamentos"}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {currency(
                        rows.reduce((sum, e) => sum + (e.cancelled_at ? 0 : e.amount_cents), 0),
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {currency(
                        rows.reduce(
                          (sum, e) => sum + (e.cancelled_at ? 0 : e.amount_cents - e.settled_cents),
                          0,
                        ),
                      )}
                    </td>
                    <td colSpan={2} />
                  </tr>
                }
              >
                {rows.map((entry, index) => {
                  const situation = financeStatus(entry, today);
                  return (
                    <tr
                      key={entry.id}
                      onClick={() => setSelectedId(entry.id)}
                      className={`cursor-pointer ${situation === "Cancelado" ? "text-muted-foreground" : ""}`}
                    >
                      <SheetGutter n={index + 1} />
                      <td
                        className={`whitespace-nowrap ${situation === "Vencido" || situation === "Parcial em atraso" ? "font-medium text-destructive" : ""}`}
                      >
                        {displayDate(entry.due_date)}
                      </td>
                      <td className="min-w-52">
                        <p className="font-medium">
                          {entry.description}
                          {(entry.installment_count > 1 || entry.recurrence_frequency) && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              {entry.recurrence_frequency ? `${financeFrequencies[entry.recurrence_frequency]} · Ocorrência ` : ""}{entry.installment}/{entry.installment_count}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            entry.supplier,
                            clientNames.get(entry.client_id ?? "") ?? entry.counterparty_name,
                            processNames.get(entry.process_id ?? ""),
                          ]
                            .filter(Boolean)
                            .join(" · ") ||
                            (entry.kind === "income" ? "Receita avulsa" : "Sem fornecedor")}
                        </p>
                      </td>
                      <td className="whitespace-nowrap">
                        {planCodes.get(entry.category) && (
                          <span className="mr-1.5 text-xs tabular-nums text-muted-foreground">
                            {planCodes.get(entry.category)}
                          </span>
                        )}
                        {entry.category}
                      </td>
                      <td className="whitespace-nowrap text-muted-foreground">
                        {entry.cost_center || "—"}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        {currency(entry.amount_cents)}
                      </td>
                      <td className="whitespace-nowrap text-right font-medium">
                        {currency(
                          entry.cancelled_at ? 0 : entry.amount_cents - entry.settled_cents,
                        )}
                      </td>
                      <td>
                        <StatusChip status={situation} />
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setSelectedId(entry.id)}
                        >
                          Detalhes
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={(event) => {
                            event.stopPropagation();
                            setAttachmentId(entry.id);
                          }}
                        >
                          <Paperclip className="mr-1 h-3 w-3" />
                          Anexos ({documents.filter((doc) => doc.entry_id === entry.id).length})
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </Sheet>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhum lançamento encontrado.
              </p>
            )}
          </Card>
        </>
      )}
      {ledger.data && section === "dashboard" && (
        <FinanceDashboard
          ledger={ledger.data}
          userId={userId}
          navigate={(target, options = {}) => {
            if (options.kind) setKind(options.kind);
            if (options.quick) setQuick(options.quick);
            if (target === "entries") {
              setSearch(options.search ?? "");
              setClientFilter("");
              setDueFrom("");
              setDueTo("");
            }
            if (options.entryId) setSelectedId(options.entryId);
            setOpenBank(!!options.bank);
            setSection(target);
          }}
        />
      )}
      {ledger.data && section === "recurring" && (
        <FinanceAgreements agreements={ledger.data.agreements} kind="recurring" refresh={refresh} />
      )}
      {ledger.data && section === "reconciliation" && <FinanceReconciliation userId={userId} ledger={ledger.data} refreshLedger={refresh} />}
      {ledger.data && section === "accounts" && (
        <FinanceAccounts
          ledger={ledger.data}
          userId={userId}
          refresh={refresh}
          openBank={openBank}
        />
      )}
      {ledger.data &&
        (section === "services" || section === "service" || section === "purchase") && (
          <FinanceOrders
            key={section}
            userId={userId}
            section={section}
            registers={ledger.data.registers}
            refresh={refresh}
          />
        )}
      {ledger.data && section === "registers" && (
        <FinanceRegisters registers={ledger.data.registers} refresh={refresh} />
      )}
      {ledger.data && section === "reports" && (
        <ReportsSection
          userId={userId}
          ledger={ledger.data}
          openStatement={() => {
            setOpenBank(true);
            setSection("accounts");
          }}
        />
      )}
      {section === "boletos" && (
        <FinanceBoletos
          userId={userId}
          entries={entries}
          clients={clients}
          onNewEntry={() => {
            setSection("entries");
            setDraft({ id: crypto.randomUUID(), kind: "income" });
          }}
        />
      )}
      {ledger.data && section === "history" && (
        <FinanceHistoryPanel userId={userId} ledger={ledger.data} />
      )}
      {draft && (
        <EntryDialog
          draft={draft}
          clients={clients}
          tasks={tasks}
          registers={ledger.data?.registers ?? []}
          today={today}
          close={() => setDraft(null)}
          refresh={refresh}
        />
      )}
      {attachmentEntry && (
        <FinanceAttachments
          key={attachmentEntry.id}
          entry={attachmentEntry}
          documents={documents.filter((doc) => doc.entry_id === attachmentEntry.id)}
          close={() => setAttachmentId(null)}
          refresh={refresh}
        />
      )}
      {selected && (
        <EntryDetails
          key={selected.id}
          entry={selected}
          documents={documents.filter((doc) => doc.entry_id === selected.id)}
          settlements={settlements.filter((item) => item.entry_id === selected.id)}
          accounts={ledger.data?.accounts ?? []}
          registers={ledger.data?.registers ?? []}
          today={today}
          close={() => setSelectedId(null)}
          refresh={refresh}
        />
      )}
    </section>
  );
}

type EditorProps = {
  draft: { id: string; kind: FinanceKind };
  clients: NonNullable<ReturnType<typeof useClients>["data"]>;
  tasks: NonNullable<ReturnType<typeof useTasks>["data"]>;
  registers: FinanceRegister[];
  today: string;
  close: () => void;
  refresh: () => Promise<void>;
};

function EntryDialog({ draft, clients, tasks, registers, today, close, refresh }: EditorProps) {
  const [clientId, setClientId] = useState("");
  const [processId, setProcessId] = useState("");
  const [launchMode, setLaunchMode] = useState("single");
  const recurring = launchMode === "recurring";
  const [ending, setEnding] = useState("count");
  const [frequency, setFrequency] = useState<FinanceFrequency>("monthly");
  const [count, setCount] = useState("12");
  const [until, setUntil] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState(today);
  const [competence, setCompetence] = useState(today);
  let preview: ReturnType<typeof financeRecurrences> = [];
  let previewError = "";
  if (recurring) {
    try { preview = financeRecurrences({ cents: financeCents(amount), frequency, dueDate: due,
      competenceDate: competence, ...(ending === "count" ? { count: Number(count) } : { until: until || "invalid" }) }); }
    catch (error) { previewError = (error as Error).message; }
  }
  const income = draft.kind === "income";
  const plan = financePlanOptions(registers, draft.kind);
  const centers = registers
    .filter((item) => item.kind === "cost_center" && item.active)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const value = (field: string) => String(form.get(field) ?? "").trim();
      const description = value("description");
      const category = value("category");
      if (!description || !category)
        throw new Error("Informe a descrição e a conta do plano de contas.");
      const installments = recurring
        ? financeRecurrences({ cents: financeCents(value("amount")), frequency,
            dueDate: value("due"), competenceDate: value("competence"),
            ...(ending === "count" ? { count: Number(count) } : { until: until || "invalid" }) })
        : financeInstallments(financeCents(value("amount")), launchMode === "installments" ? Number(value("count")) : 1, value("due"))
            .map((item) => ({ ...item, competence_date: value("competence"), recurrence_frequency: null }));
      const rows = installments.map((installment) => ({
        ...installment,
        group_id: draft.id,
        kind: draft.kind,
        description,
        category,
        cost_center: value("cost_center") || null,
        client_id: income ? clientId || null : null,
        process_id: income ? processId || null : null,
        supplier: income ? null : value("supplier") || null,
        notes: value("notes") || null,
      }));
      const { error } = await table("office_finance_entries").upsert(rows as never, {
        onConflict: "group_id,installment",
        ignoreDuplicates: true,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await refresh();
      close();
      toast.success("Lançamento cadastrado.");
    },
    onError: (error: Error) =>
      toast.error(error.message || "Não foi possível salvar o lançamento."),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{income ? "Nova receita" : "Nova despesa"}</DialogTitle>
          <DialogDescription>
            {income
              ? "Honorário de cliente ou receita avulsa (rendimento, reembolso, venda). O cliente é opcional."
              : "Registre uma despesa avulsa, parcelada ou recorrente."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!save.isPending) save.mutate(new FormData(event.currentTarget));
          }}
        >
          <label className={fieldClass}>
            Tipo de lançamento
            <select className={selectClass} value={launchMode}
              disabled={save.isPending} onChange={(event) => setLaunchMode(event.target.value)}>
              <option value="single">Avulso</option>
              <option value="installments">Parcelado</option>
              <option value="recurring">Recorrente</option>
            </select>
          </label>
          <label className={fieldClass}>
            Descrição
            <Input name="description" required maxLength={200} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={fieldClass}>
              Conta do plano
              {plan.length ? (
                <select
                  name="category"
                  required
                  className={selectClass}
                  defaultValue={plan.find((item) => income && /honor/i.test(item.name))?.name ?? ""}
                >
                  <option value="">Selecione</option>
                  {plan.map((item) => (
                    <option key={item.id} value={item.name}>
                      {"\u00a0\u00a0".repeat(financePlanDepth(item.code))}
                      {item.code ? `${item.code} ` : ""}
                      {item.name}
                    </option>
                  ))}
                </select>
              ) : (
                <SuggestInput
                  name="category"
                  options={registers.filter((item) => item.kind === "category" && item.active).map((item) => item.name)}
                  required
                  maxLength={100}
                  defaultValue={income ? "Honorários" : ""}
                />
              )}
            </label>
            {!income && (
              <label className={fieldClass}>
                Fornecedor
                <SuggestInput name="supplier" options={registers.filter((item) => item.kind === "supplier" && item.active).map((item) => item.name)} maxLength={160} />
              </label>
            )}
            {income && (
              <>
                <div className={fieldClass}>
                  Cliente
                  <ClientPicker
                    aria-label="Cliente"
                    clients={clients}
                    value={clientId}
                    emptyLabel="Sem cliente (receita avulsa)"
                    onChange={(id) => {
                      setClientId(id);
                      setProcessId("");
                    }}
                  />
                </div>
                <label className={fieldClass}>
                  Processo
                  <select
                    className={selectClass}
                    disabled={!clientId}
                    value={processId}
                    onChange={(event) => setProcessId(event.target.value)}
                  >
                    <option value="">Sem processo vinculado</option>
                    {tasks
                      .filter((task) => task.client_id === clientId)
                      .map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.title}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
            <label className={fieldClass}>
              {recurring ? "Valor de cada ocorrência em R$" : "Valor total em R$"}
              <Input name="amount" required inputMode="decimal" placeholder="0,00" value={amount} onChange={(event) => setAmount(event.target.value)} />
            </label>
            {launchMode === "installments" && <label className={fieldClass}>
              Parcelas
              <Input name="count" type="number" required min={1} max={120} defaultValue={1} />
            </label>}
            {recurring && <>
              <label className={fieldClass}>Frequência
                <select className={selectClass} value={frequency} onChange={(event) => setFrequency(event.target.value as FinanceFrequency)}>
                  {Object.entries(financeFrequencies).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label className={fieldClass}>Terminar
                <select className={selectClass} value={ending} onChange={(event) => setEnding(event.target.value)}>
                  <option value="count">Após uma quantidade</option><option value="date">Em uma data</option>
                </select>
              </label>
              {ending === "count" ? <label className={fieldClass}>Quantidade de ocorrências
                <Input type="number" min={1} max={120} required value={count} onChange={(event) => setCount(event.target.value)} />
              </label> : <label className={fieldClass}>Data final (inclusive)
                <Input type="date" min={due} required value={until} onChange={(event) => setUntil(event.target.value)} />
              </label>}
            </>}
            <label className={fieldClass}>
              Competência
              <Input name="competence" required type="date" value={competence} onChange={(event) => setCompetence(event.target.value)} />
            </label>
            <label className={fieldClass}>
              Primeiro vencimento
              <Input name="due" required type="date" value={due} onChange={(event) => setDue(event.target.value)} />
            </label>
          </div>
          {recurring && <div className="rounded-xl border bg-muted/30 p-3 text-sm" aria-live="polite">
            <p className="font-medium">Prévia da recorrência</p>
            {preview.length ? <>
              <p>{preview.length} ocorrência(s) de {currency(preview[0].amount_cents)} · Total {currency(preview.length * preview[0].amount_cents)}</p>
              <p>De {displayDate(preview[0].due_date)} até {displayDate(preview[preview.length - 1].due_date)}</p>
              <details className="mt-2"><summary className="cursor-pointer">Conferir vencimentos</summary>
                <ol className="mt-2 max-h-36 overflow-auto">{preview.map((item) => <li key={item.installment}>
                  {item.installment}. {displayDate(item.due_date)} · {currency(item.amount_cents)}
                </li>)}</ol>
              </details>
            </> : <p>{previewError}</p>}
            <p className="mt-2 text-xs text-muted-foreground">O valor se repete integralmente. Todos os lançamentos do período serão criados ao salvar, com competência acompanhando a frequência. Não há pagamento ou emissão de boleto automática.</p>
          </div>}
          <label className={fieldClass}>
            Centro de custo
            {centers.length ? (
              <select name="cost_center" className={selectClass} defaultValue="">
                <option value="">Sem centro de custo</option>
                {centers.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            ) : (
              <SuggestInput name="cost_center" maxLength={160} options={registers.filter((item) => item.kind === "cost_center" && item.active).map((item) => item.name)} />
            )}
          </label>
          <label className={fieldClass}>
            Observações
            <Textarea name="notes" maxLength={4000} />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={close}>
              Cancelar
            </Button>
            <Button disabled={save.isPending || (recurring && !preview.length)}>
              {save.isPending ? "Salvando…" : "Salvar lançamento"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EntryDetails({
  entry,
  documents,
  settlements,
  accounts,
  registers,
  today,
  close,
  refresh,
}: {
  entry: FinanceEntry;
  documents: DocumentInfo[];
  settlements: FinanceSettlement[];
  accounts: FinanceAccount[];
  registers: FinanceRegister[];
  today: string;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<FinanceAction | null>(null);
  const [settlementId, setSettlementId] = useState(() => crypto.randomUUID());
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const remaining = entry.cancelled_at ? 0 : entry.amount_cents - entry.settled_cents;

  const settle = useMutation({
    mutationFn: async (form: FormData) => {
      const amount = financeCents(String(form.get("amount")));
      if (!amount || amount > remaining)
        throw new Error("Informe um valor dentro do saldo em aberto.");
      await insertFinance("office_finance_settlements", {
        id: settlementId,
        entry_id: entry.id,
        ...financeSettlementAmounts(
          amount,
          financeCents(String(form.get("interest") || "0")),
          financeCents(String(form.get("fine") || "0")),
          financeCents(String(form.get("discount") || "0")),
          remaining,
        ),
        settled_on: form.get("date"),
        account_id: form.get("account") || null,
        payment_method: form.get("method"),
      });
    },
    onSuccess: async () => {
      setSettlementId(crypto.randomUUID());
      await refresh();
      toast.success("Baixa registrada.");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível registrar a baixa."),
  });
  function submitSettlement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settle.isPending) settle.mutate(new FormData(event.currentTarget));
  }

  if (attachmentsOpen)
    return (
      <FinanceAttachments
        entry={entry}
        documents={documents}
        close={() => setAttachmentsOpen(false)}
        refresh={refresh}
      />
    );

  if (editing)
    return (
      <FinanceEntryEditor
        entry={entry}
        registers={registers}
        close={() => setEditing(false)}
        refresh={refresh}
      />
    );
  if (action)
    return <FinanceActionDialog action={action} close={() => setAction(null)} refresh={refresh} />;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !settle.isPending) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry.description}</DialogTitle>
          {entry.recurrence_frequency && <p className="text-sm text-muted-foreground">{financeFrequencies[entry.recurrence_frequency]} · Ocorrência {entry.installment}/{entry.installment_count}</p>}
          <DialogDescription>
            Competência {displayDate(entry.competence_date)} · Vencimento{" "}
            {displayDate(entry.due_date)}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          Valor {currency(entry.amount_cents)} · Em aberto {currency(remaining)}
        </p>
        {entry.import_batch_id && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">Importado do Conta Azul</p>
            {entry.counterparty_name && <p>{entry.counterparty_name}</p>}
            {entry.counterparty_document && (
              <p className="text-xs">CPF/CNPJ: {entry.counterparty_document}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Situação na origem: {entry.source_status}. Consulte os arquivos em Anexos. A coleta de
              comprovantes da origem está restrita a novembro de 2026.
            </p>
          </div>
        )}
        {entry.kind === "income" && <FinanceClientLink entry={entry} refresh={refresh} />}
        {entry.notes && <p className="whitespace-pre-wrap text-sm">{entry.notes}</p>}
        {!entry.cancelled_at && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={settle.isPending} onClick={() => setEditing(true)}>
              Editar lançamento
            </Button>
            <Button
              variant="outline"
              disabled={settle.isPending || entry.settled_cents > 0}
              onClick={() =>
                setAction({
                  title: "Cancelar lançamento",
                  needsReason: true,
                  explanation:
                    "O lançamento sairá dos valores previstos. O registro será preservado no histórico.",
                  run: (reason) =>
                    financeRpc("office_finance_cancel_entry", { target: entry.id, reason }),
                })
              }
            >
              Cancelar lançamento
            </Button>
          </div>
        )}
        {entry.cancelled_at && (
          <p className="text-sm text-destructive">
            {financeStatus(entry, today)} · {entry.cancellation_reason}
          </p>
        )}
        {remaining > 0 && !entry.cancelled_at && (
          <form
            className="grid gap-3 rounded-lg border p-3"
            key={settlementId}
            onSubmit={submitSettlement}
          >
            <h3 className="font-medium">Registrar baixa manual</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldClass}>
                Principal da parcela em R$
                <Input
                  name="amount"
                  required
                  inputMode="decimal"
                  defaultValue={(remaining / 100).toFixed(2).replace(".", ",")}
                />
              </label>
              <label className={fieldClass}>
                Data da baixa
                <Input name="date" type="date" required max={today} defaultValue={today} />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["interest", "Juros"],
                ["fine", "Multa"],
                ["discount", "Desconto"],
              ].map(([name, label]) => (
                <label key={name} className={fieldClass}>
                  {label} (R$)
                  <Input
                    name={name}
                    inputMode="decimal"
                    defaultValue="0,00"
                    pattern="[0-9]+([.,][0-9]{1,2})?"
                  />
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              O principal reduz o saldo da parcela. Juros e multa aumentam o valor pago; o desconto
              reduz esse valor.
            </p>
            <label className={fieldClass}>
              Conta de recebimento ou pagamento
              <select name="account" className={selectClass} defaultValue="">
                <option value="">Sem conta informada</option>
                {accounts
                  .filter((account) => account.active)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className={fieldClass}>
              Forma de pagamento
              <select name="method" className={selectClass} defaultValue="pix">
                <option value="pix">Pix</option>
                <option value="cash">Dinheiro</option>
                <option value="transfer">Transferência</option>
                <option value="card">Cartão</option>
                <option value="boleto">Boleto</option>
                <option value="other">Outros</option>
              </select>
            </label>
            <Button disabled={settle.isPending}>
              {settle.isPending ? "Registrando…" : "Registrar baixa"}
            </Button>
          </form>
        )}
        {settlements.length > 0 && (
          <section>
            <h3 className="font-medium">Histórico de baixas</h3>
            <ul className="text-sm">
              {[...settlements]
                .sort((a, b) => b.settled_on.localeCompare(a.settled_on))
                .map((item) => (
                  <li key={item.id}>
                    {displayDate(item.settled_on)} · {currency(item.amount_cents)}
                    <span className="ml-2 text-muted-foreground">
                      {accounts.find((account) => account.id === item.account_id)?.name}
                    </span>
                    {(!!item.interest_cents || !!item.fine_cents || !!item.discount_cents) && (
                      <p className="text-xs text-muted-foreground">
                        Principal {currency(item.principal_cents ?? item.amount_cents)} · Juros{" "}
                        {currency(item.interest_cents ?? 0)} · Multa{" "}
                        {currency(item.fine_cents ?? 0)} · Desconto{" "}
                        {currency(item.discount_cents ?? 0)}
                      </p>
                    )}
                    {item.source_reconciled && (
                      <p className="text-xs text-muted-foreground">
                        Conciliado no Conta Azul. O vínculo com o extrato atual é conferido na aba
                        Sicoob.
                      </p>
                    )}
                    {item.reversed_at ? (
                      <p className="text-muted-foreground">Estornado · {item.reversal_reason}</p>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-2"
                        disabled={settle.isPending}
                        onClick={() =>
                          setAction({
                            title: "Estornar baixa",
                            needsReason: true,
                            explanation:
                              "O valor voltará ao saldo em aberto e será retirado do caixa e do saldo da conta.",
                            run: (reason) =>
                              financeRpc("office_finance_reverse_settlement", {
                                target: item.id,
                                reason,
                              }),
                          })
                        }
                      >
                        Estornar
                      </Button>
                    )}
                  </li>
                ))}
            </ul>
          </section>
        )}
        <section className="rounded-xl border p-4">
          <h3 className="font-medium">Comprovantes e documentos</h3>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            {documents.length} arquivo(s) anexado(s). Arraste arquivos, visualize ou baixe os
            comprovantes.
          </p>
          <Button variant="outline" onClick={() => setAttachmentsOpen(true)}>
            <Paperclip className="mr-2 h-4 w-4" />
            Abrir anexos
          </Button>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function ReportsSection({
  userId,
  ledger,
  openStatement,
}: {
  userId: string;
  ledger: OfficeFinanceData;
  openStatement: () => void;
}) {
  const [view, setView] = useState<"office" | "bank">("bank");
  return (
    <div className="space-y-4">
      <div
        className="flex w-max rounded-md border p-0.5"
        role="group"
        aria-label="Tipo de relatório"
      >
        {(
          [
            ["bank", "Banco Sicoob"],
            ["office", "Resultado do escritório"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => setView(value)}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              view === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === "office" ? (
        <FinanceReports ledger={ledger} />
      ) : (
        <FinanceBankReports userId={userId} ledger={ledger} openStatement={openStatement} />
      )}
    </div>
  );
}

function FinanceClientLink({
  entry,
  refresh,
}: {
  entry: FinanceEntry;
  refresh: () => Promise<unknown>;
}) {
  const { data: clients = [] } = useClients();
  const [id, setId] = useState(entry.client_id ?? "");
  const save = useMutation({
    mutationFn: () =>
      financeRpc("office_finance_link_client", { target: entry.id, client: id || null }),
    onSuccess: async () => {
      await refresh();
      toast.success("Cliente vinculado ao lançamento.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <label className={fieldClass}>
        Cliente do cadastro
        <ClientPicker
          clients={clients}
          value={id}
          onChange={setId}
          emptyLabel="Sem vínculo com cadastro"
        />
      </label>
      {entry.import_batch_id && !entry.client_id && (
        <p className="text-xs text-muted-foreground">
          Confira o cliente antes de vincular. O nome e documento da origem foram preservados.
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={save.isPending || id === (entry.client_id ?? "")}
        onClick={() => save.mutate()}
      >
        Salvar vínculo
      </Button>
    </div>
  );
}
