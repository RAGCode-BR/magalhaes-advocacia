import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Landmark, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  financeRpc,
  isoToday,
  selectClass,
} from "@/lib/office-finance-data";
import {
  loadBankOverview,
  synchronizeBank,
  type BankCandidate,
  type BankCursor,
  type BankTransaction,
} from "@/lib/office-bank";
import { FinanceActionDialog, type FinanceAction } from "./FinanceActionDialog";

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
  const refresh = async () => {
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
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Landmark className="h-5 w-5 text-primary" />
              Sicoob
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Saldo, extrato e conciliação da conta do escritório.
            </p>
          </div>
          <Button onClick={() => sync.mutate()} disabled={sync.isPending || !connection?.enabled}>
            <RefreshCw className={`mr-2 h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />
            {sync.isPending ? "Atualizando…" : "Atualizar extrato"}
          </Button>
        </div>
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
          <label className="grid gap-1.5 text-sm font-medium">
            Conciliação
            <select
              className={selectClass + " w-auto"}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPages([]);
              }}
            >
              <option value="all">Todas</option>
              <option value="pending">Não conciliadas</option>
              <option value="reconciled">Conciliadas</option>
            </select>
          </label>
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
          <p className="text-sm text-muted-foreground">
            A conta Sicoob ainda não está configurada.
          </p>
        )}
        {connection && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                [
                  "Saldo atual do banco",
                  balance ? currency(balance.amount_cents) : "Aguardando consulta",
                ],
                ["Entradas no mês", currency(data.totals?.credits ?? 0)],
                ["Saídas no mês", currency(data.totals?.debits ?? 0)],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-lg bg-muted/40 p-3">
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="mt-1 break-words text-xl font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                {connection.name} ·{" "}
                {connection.last_success_at
                  ? `Última atualização: ${timestamp(connection.last_success_at)}`
                  : "Aguardando a primeira atualização"}
              </p>
              <p>
                O mês atual é atualizado automaticamente a cada 30 minutos. Para outros meses,
                selecione o período e clique em Atualizar extrato.
              </p>
              {balance && (
                <p>
                  Saldo consultado em {timestamp(balance.observed_at)}. O limite de crédito não é
                  somado ao saldo.
                </p>
              )}
            </div>
            {connection.last_error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {connection.last_error}
              </p>
            )}
          </>
        )}
      </Card>
      {connection && (
        <Card className="overflow-hidden">
          <div className="space-y-1 border-b p-4">
            <h3 className="font-semibold">Movimentações bancárias</h3>
            <p className="text-sm text-muted-foreground">
              {data.totals?.count ?? 0} movimentações · {data.totals?.pending ?? 0} não conciliadas.
              A importação não altera as baixas do financeiro.
            </p>
          </div>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/25">
                  <tr>
                    {["Data", "Descrição", "Valor", "Conciliação"].map((label) => (
                      <th scope="col" key={label} className="p-3 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="whitespace-nowrap p-3 align-top">
                        {displayDate(row.booked_on)}
                      </td>
                      <td className="min-w-48 max-w-md break-words p-3 align-top">
                        {row.description}
                      </td>
                      <td
                        className={`whitespace-nowrap p-3 align-top font-medium tabular-nums ${row.amount_cents < 0 ? "text-destructive" : "text-emerald-700"}`}
                      >
                        {currency(row.amount_cents)}
                      </td>
                      <td className="p-3 align-top">
                        {row.settlement_id ? (
                          <div className="grid gap-1">
                            <span className="flex items-center gap-1 whitespace-nowrap text-xs text-emerald-700">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Conciliada
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
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
                          <Button size="sm" variant="outline" onClick={() => setSelected(row)}>
                            Conciliar
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-6 text-sm text-muted-foreground">
              Nenhuma movimentação neste filtro. Para buscar um mês ainda não importado, clique em
              Atualizar extrato.
            </p>
          )}
          <div className="flex items-center justify-between gap-2 border-t p-3">
            <Button
              variant="outline"
              disabled={!pages.length || bank.isFetching}
              onClick={() => setPages((p) => p.slice(0, -1))}
            >
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground">Página {pages.length + 1}</span>
            <Button
              variant="outline"
              disabled={!hasNext || bank.isFetching}
              onClick={() => {
                const last = rows.at(-1);
                if (last) setPages((p) => [...p, { date: last.booked_on, id: last.id }]);
              }}
            >
              Próxima
            </Button>
          </div>
        </Card>
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
