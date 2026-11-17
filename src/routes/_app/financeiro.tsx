import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useClients, useTasks } from "@/hooks/use-data";
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
  financeStatus,
  type FinanceEntry,
  type FinanceKind,
  type FinanceSettlement,
  type FinanceAccount,
  type FinanceRegister,
  financeCsv,
  financePlanDepth,
  financePlanOptions,
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
  const [kind, setKind] = useState<FinanceKind>("income");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [openBank, setOpenBank] = useState(false);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<{ id: string; kind: FinanceKind } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const entries = ledger.data?.entries ?? [];
  const settlements = ledger.data?.settlements ?? [];
  const documents = ledger.data?.documents ?? [];
  const selected = entries.find((entry) => entry.id === selectedId);
  const today = isoToday();
  const kindEntries = entries.filter((entry) => entry.kind === kind);
  const bucketTotals = kindEntries.reduce(
    (acc, entry) => {
      const bucket = quickBucket(entry, today);
      const remaining = entry.amount_cents - entry.settled_cents;
      if (bucket !== "cancelled") acc.all.cents += entry.amount_cents;
      acc.all.count++;
      acc[bucket].cents +=
        bucket === "settled" || bucket === "cancelled" ? entry.amount_cents : remaining;
      acc[bucket].count++;
      return acc;
    },
    Object.fromEntries(
      (["all", "overdue", "today", "upcoming", "settled", "cancelled"] as const).map((key) => [
        key,
        { cents: 0, count: 0 },
      ]),
    ) as Record<QuickFilter | "cancelled", { cents: number; count: number }>,
  );
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const planCodes = new Map(
    (ledger.data?.registers ?? [])
      .filter((item) => item.kind === "category" && item.code)
      .map((item) => [item.name, item.code ?? ""]),
  );
  const processNames = new Map(tasks.map((task) => [task.id, task.title]));
  const rows = kindEntries
    .filter((entry) => {
      if (clientFilter && entry.client_id !== clientFilter) return false;
      if ((dueFrom && entry.due_date < dueFrom) || (dueTo && entry.due_date > dueTo)) return false;
      if (quick !== "all" && quickBucket(entry, today) !== quick) return false;
      return [
        entry.description,
        entry.category,
        entry.supplier,
        entry.cost_center,
        clientNames.get(entry.client_id ?? ""),
        processNames.get(entry.process_id ?? ""),
      ].some((value) =>
        value?.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")),
      );
    })
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  return (
    <section className="mx-auto w-full min-w-0 max-w-7xl space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
          <p className="text-sm text-muted-foreground">
            Receitas, despesas, contas bancárias e relatórios do escritório.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setDraft({ id: crypto.randomUUID(), kind: "expense" })}
            disabled={!ledger.data}
          >
            <Plus /> Nova despesa
          </Button>
          <Button
            onClick={() => setDraft({ id: crypto.randomUUID(), kind: "income" })}
            disabled={!ledger.data}
          >
            <Plus /> Nova receita
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
            <div className="grid gap-2 sm:grid-cols-3">
              <label className={fieldClass}>
                Cliente
                <select
                  className={selectClass}
                  value={clientFilter}
                  onChange={(event) => setClientFilter(event.target.value)}
                >
                  <option value="">Todos os clientes</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
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
                      clientNames.get(entry.client_id ?? ""),
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
              <Sheet
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
                          {entry.installment_count > 1 && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              {entry.installment}/{entry.installment_count}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            entry.supplier,
                            clientNames.get(entry.client_id ?? ""),
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
        <ReportsSection userId={userId} ledger={ledger.data} />
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
      const installments = financeInstallments(
        financeCents(value("amount")),
        Number(value("count")),
        value("due"),
      );
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
        competence_date: value("competence"),
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
              : "O valor total será distribuído entre as parcelas mensais."}
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
                <Input
                  name="category"
                  list="finance-categories"
                  required
                  maxLength={100}
                  defaultValue={income ? "Honorários" : ""}
                />
              )}
            </label>
            {!income && (
              <label className={fieldClass}>
                Fornecedor
                <Input name="supplier" list="finance-suppliers" maxLength={160} />
              </label>
            )}
            {income && (
              <>
                <label className={fieldClass}>
                  Cliente
                  <select
                    className={selectClass}
                    value={clientId}
                    onChange={(event) => {
                      setClientId(event.target.value);
                      setProcessId("");
                    }}
                  >
                    <option value="">Sem cliente (receita avulsa)</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </label>
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
              Valor total em R$
              <Input name="amount" required inputMode="decimal" placeholder="0,00" />
            </label>
            <label className={fieldClass}>
              Parcelas
              <Input name="count" type="number" required min={1} max={120} defaultValue={1} />
            </label>
            <label className={fieldClass}>
              Competência
              <Input name="competence" required type="date" defaultValue={today} />
            </label>
            <label className={fieldClass}>
              Primeiro vencimento
              <Input name="due" required type="date" defaultValue={today} />
            </label>
          </div>
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
              <Input name="cost_center" maxLength={160} list="finance-centers" />
            )}
          </label>
          <datalist id="finance-categories">
            {registers
              .filter((item) => item.kind === "category" && item.active)
              .map((item) => (
                <option key={item.id} value={item.name} />
              ))}
          </datalist>
          <datalist id="finance-suppliers">
            {registers
              .filter((item) => item.kind === "supplier" && item.active)
              .map((item) => (
                <option key={item.id} value={item.name} />
              ))}
          </datalist>
          <datalist id="finance-centers">
            {registers
              .filter((item) => item.kind === "cost_center" && item.active)
              .map((item) => (
                <option key={item.id} value={item.name} />
              ))}
          </datalist>
          <label className={fieldClass}>
            Observações
            <Textarea name="notes" maxLength={4000} />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={close}>
              Cancelar
            </Button>
            <Button disabled={save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar lançamento"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const documentLimit = 2 * 1024 * 1024;

async function readDocument(file: File) {
  if (file.size === 0 || file.size > documentLimit)
    throw new Error("Escolha um arquivo de até 2 MB.");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(file);
  });
}

async function downloadDocument(documentInfo: DocumentInfo) {
  const { data, error } = await table("office_finance_documents")
    .select("content_base64")
    .eq("id", documentInfo.id)
    .single();
  if (error) throw error;
  const { content_base64 } = data as unknown as { content_base64: string };
  const bytes = Uint8Array.from(atob(content_base64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = documentInfo.filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const [documentId, setDocumentId] = useState(() => crypto.randomUUID());
  const [file, setFile] = useState<File | null>(null);
  const remaining = entry.amount_cents - entry.settled_cents;

  const settle = useMutation({
    mutationFn: async (form: FormData) => {
      const amount = financeCents(String(form.get("amount")));
      if (!amount || amount > remaining)
        throw new Error("Informe um valor dentro do saldo em aberto.");
      await insertFinance("office_finance_settlements", {
        id: settlementId,
        entry_id: entry.id,
        amount_cents: amount,
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
  const upload = useMutation({
    mutationFn: async (selectedFile: File) => {
      const content = await readDocument(selectedFile);
      await insertFinance("office_finance_documents", {
        id: documentId,
        entry_id: entry.id,
        filename: selectedFile.name.slice(0, 255),
        content_base64: content,
      });
    },
    onSuccess: async () => {
      setDocumentId(crypto.randomUUID());
      setFile(null);
      await refresh();
      toast.success("Arquivo anexado.");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível anexar o arquivo."),
  });
  const download = useMutation({
    mutationFn: downloadDocument,
    onError: () => toast.error("Não foi possível baixar o arquivo."),
  });
  function submitSettlement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settle.isPending) settle.mutate(new FormData(event.currentTarget));
  }

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
        if (!open && !settle.isPending && !upload.isPending) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry.description}</DialogTitle>
          <DialogDescription>
            Competência {displayDate(entry.competence_date)} · Vencimento{" "}
            {displayDate(entry.due_date)}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          Valor {currency(entry.amount_cents)} · Em aberto {currency(remaining)}
        </p>
        {entry.notes && <p className="whitespace-pre-wrap text-sm">{entry.notes}</p>}
        {!entry.cancelled_at && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={settle.isPending || upload.isPending}
              onClick={() => setEditing(true)}
            >
              Editar lançamento
            </Button>
            <Button
              variant="outline"
              disabled={settle.isPending || upload.isPending || entry.settled_cents > 0}
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
          <p className="text-sm text-destructive">Cancelado · {entry.cancellation_reason}</p>
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
                Valor em R$
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
                    {item.reversed_at ? (
                      <p className="text-muted-foreground">Estornado · {item.reversal_reason}</p>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-2"
                        disabled={settle.isPending || upload.isPending}
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
        <section className="space-y-2">
          <h3 className="font-medium">Comprovantes e documentos</h3>
          {documents.map((doc) => (
            <Button
              className="h-auto max-w-full whitespace-normal break-all"
              variant="outline"
              key={doc.id}
              disabled={download.isPending}
              onClick={() => download.mutate(doc)}
            >
              {doc.filename}
            </Button>
          ))}
          <label className={fieldClass}>
            Adicionar arquivo de até 2 MB
            <Input
              key={documentId}
              type="file"
              disabled={upload.isPending}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <Button
            variant="outline"
            disabled={!file || upload.isPending}
            onClick={() => {
              if (file) upload.mutate(file);
            }}
          >
            {upload.isPending ? "Anexando…" : "Anexar arquivo"}
          </Button>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function ReportsSection({ userId, ledger }: { userId: string; ledger: OfficeFinanceData }) {
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
        <FinanceBankReports userId={userId} ledger={ledger} />
      )}
    </div>
  );
}
