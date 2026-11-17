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
import { currency, displayDate, financeRpc, isoToday } from "@/lib/office-finance-data";
import {
  loadBankOverview,
  synchronizeBank,
  type BankCandidate,
  type BankCursor,
  type BankTransaction,
} from "@/lib/office-bank";
import { FinanceActionDialog, type FinanceAction } from "./FinanceActionDialog";
import { Amount, KpiStrip, Sheet, SheetGutter, SicoobLogo, StatusChip } from "./FinanceSheet";

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
            },
            {
              label: "Entradas no mês",
              value: currency(data.totals?.credits ?? 0),
              tone: "income",
            },
            { label: "Saídas no mês", value: currency(data.totals?.debits ?? 0), tone: "expense" },
            {
              label: "Conciliação do mês",
              value: total ? `${reconciledShare}%` : "—",
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
                <tr key={row.id}>
                  <SheetGutter n={pages.length * 50 + index + 1} />
                  <td className="whitespace-nowrap">{displayDate(row.booked_on)}</td>
                  <td className="min-w-48 max-w-md break-words">{row.description}</td>
                  <td className="whitespace-nowrap text-right font-medium">
                    {row.amount_cents > 0 && <Amount cents={row.amount_cents} abs />}
                  </td>
                  <td className="whitespace-nowrap text-right font-medium">
                    {row.amount_cents < 0 && <Amount cents={row.amount_cents} abs />}
                  </td>
                  <td className="whitespace-nowrap">
                    {row.settlement_id ? (
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
                          onClick={() => setSelected(row)}
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

function ReconcileDialog({
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
  const [settlement, setSettlement] = useState("");
  const candidates = useQuery({
    queryKey: ["office-bank-candidates", userId, transaction.id],
    queryFn: async () =>
      (await financeRpc("office_bank_candidates", {
        p_transaction: transaction.id,
      })) as unknown as BankCandidate[],
  });
  const mutation = useMutation({
    mutationFn: () =>
      financeRpc("office_bank_reconcile", {
        p_transaction: transaction.id,
        p_settlement: settlement,
      }),
    onSuccess: async () => {
      await refresh();
      close();
      toast.success("Conciliação registrada.");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível conciliar."),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conciliar movimentação</DialogTitle>
          <DialogDescription>
            Escolha a baixa do financeiro que corresponde a esta movimentação. O vínculo não gera um
            novo recebimento ou pagamento.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg bg-muted/40 p-3 text-sm">
          <p className="break-words font-medium">{transaction.description}</p>
          <p className="mt-1">
            {displayDate(transaction.booked_on)} · {currency(transaction.amount_cents)}
          </p>
        </div>
        {candidates.isPending && <p role="status">Buscando baixas compatíveis…</p>}
        {candidates.isError && (
          <p role="alert">Não foi possível consultar as baixas. Feche e tente novamente.</p>
        )}
        {candidates.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma baixa com a mesma conta, valor e tipo foi encontrada. Em Lançamentos, cadastre o
            recebimento ou despesa e registre a baixa na conta Sicoob. Depois, volte para conciliar.
          </p>
        )}
        {!!candidates.data?.length && (
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">
              Baixas compatíveis — confira a descrição e a data
            </legend>
            {candidates.data.map((candidate) => (
              <label key={candidate.id} className="flex gap-3 rounded-lg border p-3 text-sm">
                <input
                  className="mt-1"
                  type="radio"
                  name="bank-settlement"
                  checked={settlement === candidate.id}
                  onChange={() => setSettlement(candidate.id)}
                />
                <span className="min-w-0 break-words">
                  <strong>{candidate.description}</strong>
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
          <Button variant="outline" disabled={mutation.isPending} onClick={close}>
            Voltar
          </Button>
          <Button disabled={!settlement || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Conciliando…" : "Confirmar conciliação"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
