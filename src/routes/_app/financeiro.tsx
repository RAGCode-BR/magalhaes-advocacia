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
  financeTotals,
  type FinanceEntry,
  type FinanceKind,
  type FinanceSettlement,
  type FinanceAccount,
  type FinanceRegister,
  financeCsv,
} from "@/lib/office-finance";

export const Route = createFileRoute("/_app/financeiro")({ component: FinanceRoute });

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
} from "@/lib/office-finance-data";
import { FinanceAgreements } from "@/components/finance/FinanceAgreements";
import { FinanceOrders } from "@/components/finance/FinanceOrders";
import { FinanceRegisters } from "@/components/finance/FinanceRegisters";
import { FinanceAccounts } from "@/components/finance/FinanceAccounts";
import {
  FinanceReports,
  FinanceStatement,
  FinanceHistoryPanel,
} from "@/components/finance/FinanceReports";
import { FinanceActionDialog, type FinanceAction } from "@/components/finance/FinanceActionDialog";
import { FinanceEntryEditor } from "@/components/finance/FinanceEntryEditor";

async function insertFinance(name: FinanceTable, values: object | object[]) {
  const { error } = await table(name).upsert(values as never, {
    onConflict: "id",
    ignoreDuplicates: true,
  });
  if (error) throw error;
}

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
  const [section, setSection] = useState("entries");
  const [clientFilter, setClientFilter] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [kind, setKind] = useState<FinanceKind>("income");
  const [month, setMonth] = useState(isoToday().slice(0, 7));
  const [basis, setBasis] = useState<"cash" | "competence">("cash");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<{ id: string; kind: FinanceKind } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const entries = ledger.data?.entries ?? [];
  const settlements = ledger.data?.settlements ?? [];
  const documents = ledger.data?.documents ?? [];
  const selected = entries.find((entry) => entry.id === selectedId);
  const today = isoToday();
  const totals = financeTotals(entries, settlements, month, basis);
  const nextWeek = new Date(`${today}T12:00:00Z`);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  const upcomingLimit = nextWeek.toISOString().slice(0, 10);
  const kindEntries = entries.filter((entry) => entry.kind === kind);
  const pendingTotals = kindEntries.reduce(
    (summary, entry) => {
      if (entry.cancelled_at) return summary;
      const remaining = entry.amount_cents - entry.settled_cents;
      summary.open += remaining;
      if (entry.due_date < today) summary.overdue += remaining;
      else if (entry.due_date <= upcomingLimit) summary.upcoming += remaining;
      return summary;
    },
    { open: 0, overdue: 0, upcoming: 0 },
  );
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const processNames = new Map(tasks.map((task) => [task.id, task.title]));
  const rows = kindEntries
    .filter((entry) => {
      if (clientFilter && entry.client_id !== clientFilter) return false;
      if ((dueFrom && entry.due_date < dueFrom) || (dueTo && entry.due_date > dueTo)) return false;
      const currentStatus = financeStatus(entry, today);
      if (status !== "all" && currentStatus !== status) return false;
      return [
        entry.description,
        entry.category,
        entry.supplier,
        clientNames.get(entry.client_id ?? ""),
        processNames.get(entry.process_id ?? ""),
      ].some((value) =>
        value?.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")),
      );
    })
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  return (
    <section className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Magalhães Advocacia
          </p>
          <h1 className="text-2xl font-semibold">Financeiro</h1>
          <p className="text-sm text-muted-foreground">
            Honorários, despesas e movimentações do escritório.
          </p>
        </div>
        {section === "entries" && (
          <Button
            onClick={() => setDraft({ id: crypto.randomUUID(), kind })}
            disabled={!ledger.data}
          >
            <Plus /> {kind === "income" ? "Novo honorário" : "Nova despesa"}
          </Button>
        )}
      </header>
      <nav className="flex gap-2 overflow-x-auto pb-2" aria-label="Seções do financeiro">
        {[
          ["entries", "Lançamentos"],
          ["quote", "Orçamentos"],
          ["recurring", "Contratos"],
          ["services", "Serviços"],
          ["service", "Ordens de serviço"],
          ["purchase", "Compras"],
          ["accounts", "Contas"],
          ["registers", "Cadastros"],
          ["statement", "Extrato"],
          ["reports", "Relatórios"],
          ["history", "Histórico"],
        ].map(([value, label]) => (
          <Button
            className="shrink-0"
            key={value}
            variant={section === value ? "default" : "outline"}
            aria-pressed={section === value}
            onClick={() => setSection(value)}
          >
            {label}
          </Button>
        ))}
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
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">Resumo mensal</h2>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="w-auto"
                  aria-label="Mês do resumo"
                  type="month"
                  value={month}
                  onChange={(event) => {
                    if (event.target.value) setMonth(event.target.value);
                  }}
                />
                <select
                  className={selectClass + " w-auto"}
                  aria-label="Regime do resumo"
                  value={basis}
                  onChange={(event) =>
                    setBasis(event.target.value === "cash" ? "cash" : "competence")
                  }
                >
                  <option value="cash">Caixa</option>
                  <option value="competence">Competência</option>
                </select>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {[
                [basis === "cash" ? "Recebido" : "Receitas", totals.income],
                [basis === "cash" ? "Pago" : "Despesas", totals.expense],
                ["Resultado do mês", totals.balance],
              ].map(([label, amount]) => (
                <div className="rounded-lg bg-muted/50 p-3" key={label}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="font-semibold tabular-nums">{currency(Number(amount))}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card className="space-y-4 p-4">
            <div className="flex flex-wrap gap-2" aria-label="Tipo de lançamento">
              <Button
                variant={kind === "income" ? "default" : "outline"}
                aria-pressed={kind === "income"}
                onClick={() => setKind("income")}
              >
                Contas a receber
              </Button>
              <Button
                variant={kind === "expense" ? "default" : "outline"}
                aria-pressed={kind === "expense"}
                onClick={() => setKind("expense")}
              >
                Contas a pagar
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                ["Total em aberto", pendingTotals.open],
                ["Saldo vencido", pendingTotals.overdue],
                ["Vence em até 7 dias", pendingTotals.upcoming],
              ].map(([label, amount]) => (
                <div className="rounded-lg bg-muted/50 p-3" key={label}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="font-semibold tabular-nums">{currency(Number(amount))}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-2">
              <Input
                className="sm:max-w-xs"
                placeholder="Buscar lançamento, cliente ou processo"
                aria-label="Buscar lançamentos"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select
                className={selectClass + " sm:w-auto"}
                aria-label="Filtrar por situação"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">Todas as situações</option>
                {[
                  "Em aberto",
                  "Vencido",
                  "Parcial",
                  "Parcial em atraso",
                  "Quitado",
                  "Cancelado",
                ].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
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
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      {["Lançamento", "Vencimento", "Valor", "Em aberto", "Situação", "Ações"].map(
                        (label) => (
                          <th scope="col" key={label} className="p-2 font-medium">
                            {label}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((entry) => (
                      <tr key={entry.id} className="border-b last:border-0">
                        <td className="min-w-48 p-2">
                          <p className="font-medium">
                            {entry.description}
                            {entry.installment_count > 1 &&
                              ` · ${entry.installment}/${entry.installment_count}`}
                          </p>
                          <p className="text-muted-foreground">
                            {[
                              entry.category,
                              entry.supplier,
                              clientNames.get(entry.client_id ?? ""),
                              processNames.get(entry.process_id ?? ""),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </td>
                        <td className="whitespace-nowrap p-2">{displayDate(entry.due_date)}</td>
                        <td className="whitespace-nowrap p-2">{currency(entry.amount_cents)}</td>
                        <td className="whitespace-nowrap p-2">
                          {currency(
                            entry.cancelled_at ? 0 : entry.amount_cents - entry.settled_cents,
                          )}
                        </td>
                        <td className="p-2">{financeStatus(entry, today)}</td>
                        <td className="p-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedId(entry.id)}
                          >
                            Detalhes
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhum lançamento encontrado.
              </p>
            )}
          </Card>
        </>
      )}
      {ledger.data && (section === "quote" || section === "recurring") && (
        <FinanceAgreements agreements={ledger.data.agreements} kind={section} refresh={refresh} />
      )}
      {ledger.data && section === "accounts" && (
        <FinanceAccounts ledger={ledger.data} refresh={refresh} />
      )}
      {ledger.data && (section === "services" || section === "service" || section === "purchase") && (
        <FinanceOrders key={section} userId={userId} section={section} registers={ledger.data.registers} refresh={refresh} />
      )}
      {ledger.data && section === "registers" && (
        <FinanceRegisters registers={ledger.data.registers} refresh={refresh} />
      )}
      {ledger.data && section === "reports" && <FinanceReports ledger={ledger.data} />}
      {ledger.data && section === "statement" && <FinanceStatement ledger={ledger.data} />}
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
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const value = (field: string) => String(form.get(field) ?? "").trim();
      const description = value("description");
      const category = value("category");
      if (!description || !category) throw new Error("Informe a descrição e a categoria.");
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
        client_id: clientId || null,
        process_id: processId || null,
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
          <DialogTitle>{income ? "Novo honorário" : "Nova despesa"}</DialogTitle>
          <DialogDescription>
            O valor total será distribuído entre as parcelas mensais.
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
              Categoria
              <Input
                name="category"
                list="finance-categories"
                required
                maxLength={100}
                defaultValue={income ? "Honorários" : ""}
              />
            </label>
            {!income && (
              <label className={fieldClass}>
                Fornecedor
                <Input name="supplier" list="finance-suppliers" maxLength={160} />
              </label>
            )}
            <label className={fieldClass}>
              Cliente
              <select
                className={selectClass}
                required={income}
                value={clientId}
                onChange={(event) => {
                  setClientId(event.target.value);
                  setProcessId("");
                }}
              >
                <option value="">{income ? "Selecione um cliente" : "Sem cliente"}</option>
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
            <Input name="cost_center" maxLength={160} list="finance-centers" />
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
