import { FinanceExport } from "./FinanceExport";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  currency,
  displayDate,
  fieldClass,
  financeRpc,
  isoToday,
  loadOfficeFinance,
  selectClass,
} from "@/lib/office-finance-data";
import { financePlanDepth, financePlanOptions } from "@/lib/office-finance";
import { useClients } from "@/hooks/use-data";
import { ClientPicker } from "@/components/ClientPicker";
import {
  bankDescriptionParts,
  loadBankOverview,
  synchronizeBank,
  type BankCandidate,
  type BankCursor,
  type BankTransaction,
} from "@/lib/office-bank";
import { FinanceActionDialog, type FinanceAction } from "./FinanceActionDialog";
import {
  Amount,
  DetailRows,
  KpiStrip,
  Sheet,
  SheetGutter,
  SicoobLogo,
  StatusChip,
} from "./FinanceSheet";

const timestamp = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));

export function FinanceBank({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(isoToday().slice(0, 7));
  const [status, setStatus] = useState("all");
  const [pages, setPages] = useState<BankCursor[]>([]);
  const [selected, setSelected] = useState<BankTransaction | null>(null);
  const [action, setAction] = useState<FinanceAction | null>(null);
  const cursor = pages.at(-1);
  const bank = useQuery({
    queryKey: ["office-bank", userId, month, status, cursor],
    queryFn: () => loadBankOverview(month, status, cursor),
    staleTime: 30000,
    refetchInterval: (query) => {
      const since = query.state.data?.connection?.syncing_since;
      return since && Date.now() - new Date(since).getTime() < 120000 ? 5000 : false;
    },
  });
  const periods = useQuery({
    queryKey: ["office-bank-periods", userId],
    queryFn: async () =>
      (await financeRpc("office_bank_periods_list", {})) as unknown as {
        month: string;
        row_count: number;
        synced_at: string;
      }[],
  });
  const selectedPeriod = periods.data?.find((p) => p.month.slice(0, 7) === month);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["office-bank-periods", userId] });
    await queryClient.invalidateQueries({ queryKey: ["office-bank", userId] });
    await queryClient.invalidateQueries({ queryKey: ["office-bank-reconciliation", userId] });
    await queryClient.invalidateQueries({ queryKey: ["office-bank-report-rows", userId] });
  };
  const sync = useMutation({
    mutationFn: () => synchronizeBank(month),
    onSuccess: async (result) => {
      await refresh();
      toast[result.busy ? "info" : "success"](
        result.busy
          ? result.message
          : `Extrato atualizado: ${result.count} movimentações no período.`,
      );
    },
    onError: async (error: Error) => {
      await refresh();
      toast.error(error.message);
    },
  });
  const data = bank.data;
  const connection = data?.connection;
  const rows = data?.rows.slice(0, 50) ?? [];
  const hasNext = (data?.rows.length ?? 0) > 50;
  const balance = data?.balances?.ledger;
  const total = data?.totals?.count ?? 0;
  const pending = data?.totals?.pending ?? 0;
  const reconciledShare = total ? Math.round(((total - pending) / total) * 100) : 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <SicoobLogo className="h-5" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{connection?.name ?? "Conta Sicoob"}</p>
            <p className="text-xs text-muted-foreground">
              {connection?.last_success_at
                ? `Atualizado em ${timestamp(connection.last_success_at)}`
                : "Aguardando a primeira atualização"}
            </p>
          </div>
        </div>
        <Button onClick={() => sync.mutate()} disabled={sync.isPending || !connection?.enabled}>
          <RefreshCw className={`mr-2 h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />
          {sync.isPending ? "Atualizando…" : "Atualizar extrato"}
        </Button>
      </div>
      {bank.isPending && (
        <p role="status" className="text-sm">
          Carregando os dados bancários…
        </p>
      )}
      {bank.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <p>Não foi possível carregar o Sicoob.</p>
          <Button variant="outline" onClick={() => void bank.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {data && !connection && (
        <p className="text-sm text-muted-foreground">A conta Sicoob ainda não está configurada.</p>
      )}
      {connection?.last_error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {connection.last_error}
        </p>
      )}
      {connection && (
        <KpiStrip
          items={[
            {
              label: "Saldo no banco",
              value: balance ? currency(balance.amount_cents) : "Aguardando consulta",
              tone: "balance",
              hint: balance
                ? `Consultado em ${timestamp(balance.observed_at)} · sem limite de crédito`
                : undefined,
              summary:
                "Saldo informado pela API do Sicoob na última consulta. O limite de crédito não é somado. Pode diferir do saldo no sistema quando há movimentações sem baixa.",
            },
            {
              label: "Entradas no mês",
              value: currency(data.totals?.credits ?? 0),
              tone: "income",
              summary: "Créditos do extrato no mês selecionado. A lista mostra a página carregada.",
              detail: () => (
                <DetailRows
                  rows={rows
                    .filter((row) => row.amount_cents > 0)
                    .map((row) => ({
                      key: row.id,
                      date: row.booked_on,
                      title: bankDescriptionParts(row.description).title,
                      subtitle: bankDescriptionParts(row.description).detail,
                      value: currency(Math.abs(row.amount_cents)),
                    }))}
                />
              ),
            },
            {
              label: "Saídas no mês",
              value: currency(data.totals?.debits ?? 0),
              tone: "expense",
              summary: "Débitos do extrato no mês selecionado. A lista mostra a página carregada.",
              detail: () => (
                <DetailRows
                  rows={rows
                    .filter((row) => row.amount_cents < 0)
                    .map((row) => ({
                      key: row.id,
                      date: row.booked_on,
                      title: bankDescriptionParts(row.description).title,
                      subtitle: bankDescriptionParts(row.description).detail,
                      value: currency(Math.abs(row.amount_cents)),
                    }))}
                />
              ),
            },
            {
              label: "Conciliação do mês",
              value: total ? `${reconciledShare}%` : "—",
              summary: `${total - pending} de ${total} movimentações do mês estão vinculadas a uma baixa do financeiro. Use Conciliar na tabela para vincular as pendentes.`,
              detail: () => (
                <DetailRows
                  rows={rows
                    .filter((row) => !(row.settlement_id || row.transfer_id))
                    .map((row) => ({
                      key: row.id,
                      date: row.booked_on,
                      title: bankDescriptionParts(row.description).title,
                      subtitle: bankDescriptionParts(row.description).detail,
                      value: <Amount cents={row.amount_cents} />,
                    }))}
                  empty="Nenhuma pendência na página carregada."
                />
              ),
              tone: pending ? "alert" : "income",
              hint: (
                <span className="block">
                  <span
                    className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label="Movimentações conciliadas"
                    aria-valuenow={reconciledShare}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span
                      className="block h-full rounded-full bg-emerald-600 dark:bg-emerald-400"
                      style={{ width: `${reconciledShare}%` }}
                    />
                  </span>
                  <span className="mt-1 block">
                    {pending} de {total} não conciliadas
                  </span>
                </span>
              ),
            },
          ]}
        />
      )}
      {connection && (
        <FinanceExport
          report={async () => {
            const all: BankTransaction[] = [];
            let next: BankCursor | undefined;
            const seen = new Set<string>();
            for (let page = 0; page < 200; page++) {
              const overview = await loadBankOverview(month, status, next);
              const chunk = overview.rows.slice(0, 50);
              for (const row of chunk) {
                if (seen.has(row.id))
                  throw new Error(
                    "O extrato mudou durante a exportação. Atualize e tente novamente.",
                  );
                seen.add(row.id);
                all.push(row);
              }
              if (overview.rows.length <= 50)
                return {
                  title: `Extrato Sicoob · ${month}`,
                  note: `Mês completo no filtro ${status}. Saldo bancário atual (não saldo final do mês): ${balance ? currency(balance.amount_cents) : "indisponível"}. Consultado: ${balance ? timestamp(balance.observed_at) : "sem consulta"}.`,
                  columns: ["Data", "Histórico", "Entrada (R$)", "Saída (R$)", "Conciliação"],
                  rows: all.map((row) => [
                    row.booked_on.slice(0, 10).split("-").reverse().join("/"),
                    row.description,
                    Math.max(0, row.amount_cents) / 100,
                    Math.max(0, -row.amount_cents) / 100,
                    row.reconciled_at ? "Conciliada" : "Pendente",
                  ]),
                };
              const last = chunk.at(-1)!;
              next = { date: last.booked_on, id: last.id };
            }
            throw new Error("Extrato muito extenso. Exporte um período menor.");
          }}
        />
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-sm font-medium">
          Mês do extrato
          <Input
            type="month"
            max={isoToday().slice(0, 7)}
            value={month}
            className="w-auto"
            onChange={(e) => {
              if (e.target.value) {
                setMonth(e.target.value);
                setPages([]);
              }
            }}
          />
        </label>
        <div className="grid gap-1.5 text-sm font-medium">
          Conciliação
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Conciliação">
            {[
              ["all", "Todas"],
              ["pending", "Não conciliadas"],
              ["reconciled", "Conciliadas"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={status === value}
                onClick={() => {
                  setStatus(value);
                  setPages([]);
                }}
                className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  status === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="pb-2 text-xs text-muted-foreground">
          {selectedPeriod
            ? selectedPeriod.row_count
              ? `${selectedPeriod.row_count} movimentações retornadas pelo Sicoob · consulta em ${timestamp(selectedPeriod.synced_at)}`
              : `O Sicoob respondeu sem movimentações · consulta em ${timestamp(selectedPeriod.synced_at)}`
            : connection
              ? "Este mês ainda não foi consultado. Use Atualizar extrato."
              : null}
        </p>
      </div>
      {connection && (
        <>
          {rows.length ? (
            <Sheet
              label="Movimentações bancárias Sicoob"
              columns={[
                { label: "Data" },
                { label: "Histórico" },
                { label: "Entrada", align: "right" },
                { label: "Saída", align: "right" },
                { label: "Conciliação" },
              ]}
            >
              {rows.map((row, index) => (
                <tr
                  key={row.id}
                  onClick={
                    row.settlement_id || row.transfer_id ? undefined : () => setSelected(row)
                  }
                  className={row.settlement_id || row.transfer_id ? "" : "cursor-pointer"}
                  title={row.settlement_id || row.transfer_id ? undefined : "Clique para conciliar"}
                >
                  <SheetGutter n={pages.length * 50 + index + 1} />
                  <td className="whitespace-nowrap">{displayDate(row.booked_on)}</td>
                  <td className="min-w-48 max-w-md" title={row.description}>
                    <p className="break-words">{bankDescriptionParts(row.description).title}</p>
                    {bankDescriptionParts(row.description).detail && (
                      <p className="break-words text-xs text-muted-foreground">
                        {bankDescriptionParts(row.description).detail}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right font-medium">
                    {row.amount_cents > 0 && <Amount cents={row.amount_cents} abs />}
                  </td>
                  <td className="whitespace-nowrap text-right font-medium">
                    {row.amount_cents < 0 && <Amount cents={row.amount_cents} abs />}
                  </td>
                  <td className="whitespace-nowrap">
                    {row.settlement_id || row.transfer_id ? (
                      <div className="flex items-center gap-1">
                        <StatusChip status="Conciliada" />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            setAction({
                              title: "Desfazer conciliação",
                              explanation:
                                "A movimentação voltará para Não conciliadas. A baixa registrada no financeiro será mantida.",
                              needsReason: true,
                              run: (reason) =>
                                financeRpc("office_bank_unreconcile", {
                                  p_transaction: row.id,
                                  p_reason: reason,
                                }),
                            })
                          }
                        >
                          Desfazer
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <StatusChip status="Pendente" />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelected(row);
                          }}
                        >
                          Conciliar
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </Sheet>
          ) : (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nenhuma movimentação neste filtro. Para buscar um mês ainda não importado, clique em
              Atualizar extrato.
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!pages.length || bank.isFetching}
              onClick={() => setPages((p) => p.slice(0, -1))}
            >
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground">
              Página {pages.length + 1} · a importação não altera as baixas do financeiro
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext || bank.isFetching}
              onClick={() => {
                const last = rows.at(-1);
                if (last) setPages((p) => [...p, { date: last.booked_on, id: last.id }]);
              }}
            >
              Próxima
            </Button>
          </div>
          {!!periods.data?.length && (
            <details className="rounded-md border p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                Meses consultados ({periods.data.length})
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {periods.data.map((p) => (
                  <button
                    key={p.month}
                    onClick={() => {
                      setMonth(p.month.slice(0, 7));
                      setPages([]);
                    }}
                    className="rounded border p-2 text-left hover:bg-muted"
                  >
                    <span>
                      {p.month.slice(5, 7)}/{p.month.slice(0, 4)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {p.row_count} movimentações
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                O mês atual é atualizado automaticamente a cada 30 minutos. Estes são os dados
                retornados pela API do Sicoob. Se houver movimentações no extrato do banco que não
                aparecem aqui, solicite a liberação do histórico à cooperativa.
              </p>
            </details>
          )}
        </>
      )}
      {selected && (
        <ReconcileDialog
          key={selected.id}
          transaction={selected}
          userId={userId}
          close={() => setSelected(null)}
          refresh={refresh}
        />
      )}
      {action && (
        <FinanceActionDialog action={action} close={() => setAction(null)} refresh={refresh} />
      )}
    </div>
  );
}

/**
 * Reconcile a bank movement: link it to an existing settlement, or create the entry
 * (receita/despesa) from the movement itself, settled and reconciled in one step.
 */
export function ReconcileDialog({
  transaction,
  userId,
  close,
  refresh,
}: {
  transaction: BankTransaction;
  userId: string;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const income = transaction.amount_cents > 0;
  const kind = income ? "income" : "expense";
  const parts = bankDescriptionParts(transaction.description);
  const [settlement, setSettlement] = useState("");
  const [mode, setMode] = useState<"link" | "create" | null>(null);
  const [clientId, setClientId] = useState("");
  const [ids] = useState(() => ({ entry: crypto.randomUUID(), settlement: crypto.randomUUID() }));
  const { data: clients = [] } = useClients();
  const ledger = useQuery({
    queryKey: ["office-finance", userId],
    queryFn: loadOfficeFinance,
    staleTime: 30000,
  });
  const registers = ledger.data?.registers ?? [];
  const plan = financePlanOptions(registers, kind);
  const centers = registers.filter((item) => item.kind === "cost_center" && item.active);
  const candidates = useQuery({
    queryKey: ["office-bank-candidates", userId, transaction.id],
    queryFn: async () =>
      (await financeRpc("office_bank_candidates", {
        p_transaction: transaction.id,
      })) as unknown as BankCandidate[],
  });
  // Without matching settlements, start directly on "create".
  const current = mode ?? (candidates.data && !candidates.data.length ? "create" : "link");
  const done = async (message: string) => {
    await Promise.all([
      refresh(),
      queryClient.invalidateQueries({ queryKey: ["office-finance", userId] }),
      queryClient.invalidateQueries({ queryKey: ["office-bank-report-rows", userId] }),
    ]);
    close();
    toast.success(message);
  };
  const link = useMutation({
    mutationFn: () => {
      const candidate = candidates.data?.find((c) => c.id === settlement);
      if (!candidate) throw new Error("Escolha o lançamento correspondente.");
      return candidate.target_type === "transfer"
        ? financeRpc("office_bank_reconcile_transfer", {
            p_transaction: transaction.id,
            p_transfer: settlement,
          })
        : financeRpc("office_bank_reconcile", {
            p_transaction: transaction.id,
            p_settlement: settlement,
          });
    },
    onSuccess: () => done("Conciliação registrada."),
    onError: (error: Error) => toast.error(error.message || "Não foi possível conciliar."),
  });
  const create = useMutation({
    mutationFn: (form: FormData) => {
      const value = (key: string) => String(form.get(key) ?? "").trim();
      return financeRpc("office_bank_create_and_reconcile", {
        p_transaction: transaction.id,
        p_entry: ids.entry,
        p_settlement: ids.settlement,
        data: {
          description: value("description"),
          category: value("category"),
          cost_center: value("cost_center"),
          supplier: value("supplier"),
          notes: value("notes"),
          client_id: income ? clientId : "",
        },
      });
    },
    onSuccess: () => done(income ? "Receita criada e conciliada." : "Despesa criada e conciliada."),
    onError: (error: Error) => toast.error(error.message || "Não foi possível criar o lançamento."),
  });
  const busy = link.isPending || create.isPending;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Conciliar movimentação</DialogTitle>
          <DialogDescription>
            Vincule a uma baixa ou transferência já registrada. Confira os dados antes de confirmar.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{parts.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {displayDate(transaction.booked_on)}
              {parts.detail ? ` · ${parts.detail}` : ""}
            </p>
          </div>
          <p
            className={`shrink-0 text-lg font-semibold tabular-nums ${income ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}
          >
            {income ? "+" : "−"}
            {currency(Math.abs(transaction.amount_cents))}
          </p>
        </div>
        <div
          className="grid grid-cols-2 rounded-lg border bg-muted/40 p-1"
          role="group"
          aria-label="Forma de conciliar"
        >
          {(
            [
              [
                "link",
                `Lançamento existente${candidates.data ? ` (${candidates.data.length})` : ""}`,
              ],
              ["create", income ? "Criar receita" : "Criar despesa"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={current === value}
              onClick={() => setMode(value)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                current === value
                  ? "bg-card font-semibold shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {current === "link" ? (
          <>
            {candidates.isPending && <p role="status">Buscando baixas compatíveis…</p>}
            {candidates.isError && (
              <p role="alert">Não foi possível consultar as baixas. Feche e tente novamente.</p>
            )}
            {candidates.data?.length === 0 && (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Nenhuma baixa ou transferência com a mesma conta, valor e tipo. Use{" "}
                {income ? "Criar receita" : "Criar despesa"} para lançar e conciliar de uma vez.
              </p>
            )}
            {!!candidates.data?.length && (
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">
                  Escolha a baixa ou transferência correspondente
                </legend>
                {candidates.data.map((candidate) => (
                  <label
                    key={candidate.id}
                    className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40 ${settlement === candidate.id ? "border-primary ring-1 ring-primary" : ""}`}
                  >
                    <input
                      className="mt-1"
                      type="radio"
                      name="bank-settlement"
                      checked={settlement === candidate.id}
                      onChange={() => setSettlement(candidate.id)}
                    />
                    <span className="min-w-0 break-words">
                      <strong>{candidate.description}</strong>
                      {candidate.target_type === "transfer" && (
                        <span className="block text-xs font-medium text-primary">
                          Transferência entre contas
                        </span>
                      )}
                      {candidate.source_reconciled && (
                        <span className="block text-xs text-muted-foreground">
                          Marcado como conciliado no Conta Azul · conferir vínculo
                        </span>
                      )}
                      {candidate.client_name && (
                        <span className="block text-muted-foreground">{candidate.client_name}</span>
                      )}
                      <span className="block">
                        {displayDate(candidate.settled_on)} · {currency(candidate.amount_cents)}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={close}>
                Voltar
              </Button>
              <Button disabled={!settlement || busy} onClick={() => link.mutate()}>
                {link.isPending ? "Conciliando…" : "Confirmar conciliação"}
              </Button>
            </div>
          </>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) create.mutate(new FormData(event.currentTarget));
            }}
          >
            <label className={fieldClass}>
              Descrição
              <Input
                name="description"
                required
                maxLength={200}
                defaultValue={[parts.title, parts.detail].filter(Boolean).join(" · ").slice(0, 200)}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldClass}>
                Conta do plano
                {plan.length ? (
                  <select name="category" required className={selectClass} defaultValue="">
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
                    required
                    maxLength={100}
                    defaultValue={income ? "Honorários" : ""}
                  />
                )}
              </label>
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
                  <Input name="cost_center" maxLength={160} />
                )}
              </label>
              {income ? (
                <div className={`${fieldClass} sm:col-span-2`}>
                  Cliente
                  <ClientPicker
                    aria-label="Cliente"
                    clients={clients}
                    value={clientId}
                    emptyLabel="Sem cliente (receita avulsa)"
                    onChange={setClientId}
                  />
                </div>
              ) : (
                <label className={`${fieldClass} sm:col-span-2`}>
                  Fornecedor
                  <Input
                    name="supplier"
                    maxLength={160}
                    defaultValue={parts.detail.slice(0, 160)}
                  />
                </label>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              O lançamento é criado com a data e o valor do banco, recebe a baixa na conta Sicoob e
              fica conciliado com esta movimentação.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={close}>
                Voltar
              </Button>
              <Button disabled={busy}>
                {create.isPending
                  ? "Salvando…"
                  : income
                    ? "Criar receita e conciliar"
                    : "Criar despesa e conciliar"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
