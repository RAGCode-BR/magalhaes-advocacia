import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  currency,
  displayDate,
  financeRpc,
  isoToday,
  loadOfficeFinance,
  selectClass,
} from "@/lib/office-finance-data";
import {
  loadBankOverview,
  synchronizeBank,
  bankDescriptionParts,
  type BankTransaction,
  type BankOverview,
  type BankCursor,
} from "@/lib/office-bank";
import { reconciliationEntries } from "@/lib/finance-reconciliation";
import { FinanceActionDialog, type FinanceAction } from "./FinanceActionDialog";
import { ReconcileDialog } from "./FinanceBank";
import { Amount, StatusChip } from "./FinanceSheet";

export async function loadReconciliationMonth(month: string) {
  let cursor: BankCursor | undefined;
  let overview: BankOverview | undefined;
  const rows: BankTransaction[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < 200; page++) {
    const data = await loadBankOverview(month, "all", cursor);
    overview ??= data;
    for (const row of data.rows.slice(0, 50))
      if (!seen.has(row.id)) {
        rows.push(row);
        seen.add(row.id);
      }
    if (data.rows.length <= 50) return { ...overview, rows };
    const last = data.rows[49];
    if (cursor?.id === last.id)
      throw new Error("A paginação do extrato não avançou. Atualize e tente novamente.");
    cursor = { date: last.booked_on, id: last.id };
  }
  throw new Error(
    "O mês ultrapassa 10.000 movimentações. Use o extrato paginado em Contas e extratos.",
  );
}

export function FinanceReconciliation({
  userId,
  ledger,
  refreshLedger,
}: {
  userId: string;
  ledger: Awaited<ReturnType<typeof loadOfficeFinance>>;
  refreshLedger: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(isoToday().slice(0, 7));
  const [day, setDay] = useState("");
  const [status, setStatus] = useState("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [dialog, setDialog] = useState<BankTransaction | null>(null);
  const [action, setAction] = useState<FinanceAction | null>(null);
  const bank = useQuery({
    queryKey: ["office-bank-reconciliation", userId, month],
    queryFn: () => loadReconciliationMonth(month),
    staleTime: 30000,
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["office-bank-reconciliation", userId] }),
      queryClient.invalidateQueries({ queryKey: ["office-bank", userId] }),
      queryClient.invalidateQueries({ queryKey: ["office-bank-report-rows", userId] }),
      refreshLedger(),
    ]);
  };
  const sync = useMutation({
    mutationFn: () => synchronizeBank(month),
    onSuccess: async (result) => {
      await refresh();
      toast[result.busy ? "info" : "success"](result.busy ? result.message : "Extrato atualizado.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const periodRows = (bank.data?.rows ?? []).filter((row) => !day || row.booked_on === day);
  const isReconciled = (row: BankTransaction) => Boolean(row.settlement_id || row.transfer_id);
  const visible = periodRows.filter(
    (row) => status === "all" || (status === "reconciled" ? isReconciled(row) : !isReconciled(row)),
  );
  const selected = visible.find((row) => row.id === selectedId) ?? visible[0];
  const candidates = selected ? reconciliationEntries(ledger.entries, selected, search) : [];
  const account = ledger.accounts.find((item) => item.id === bank.data?.connection?.account_id);
  const totals = periodRows.reduce(
    (acc, row) => ({
      credits: acc.credits + Math.max(0, row.amount_cents),
      debits: acc.debits + Math.max(0, -row.amount_cents),
      pending: acc.pending + Number(!isReconciled(row)),
    }),
    { credits: 0, debits: 0, pending: 0 },
  );
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Conciliação bancária</h2>
          <p className="text-sm text-muted-foreground">
            Compare o extrato com as receitas e despesas. Cada vínculo precisa da sua confirmação.
          </p>
          {bank.data?.connection?.last_success_at && (
            <p className="mt-1 text-xs text-muted-foreground">
              Última consulta ao banco:{" "}
              {new Date(bank.data.connection.last_success_at).toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo",
              })}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          disabled={sync.isPending || !bank.data?.connection}
          onClick={() => sync.mutate()}
        >
          {sync.isPending ? "Consultando banco…" : "Atualizar extrato"}
        </Button>
      </div>
      <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          Mês
          <Input
            type="month"
            value={month}
            onChange={(event) => {
              if (event.target.value) {
                setMonth(event.target.value);
                setDay("");
                setSelectedId(null);
              }
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Dia (opcional)
          <Input
            type="date"
            value={day}
            onChange={(event) => {
              setDay(event.target.value);
              if (event.target.value) setMonth(event.target.value.slice(0, 7));
              setSelectedId(null);
            }}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Mostrar
          <select
            className={selectClass}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setSelectedId(null);
            }}
          >
            <option value="pending">Pendentes</option>
            <option value="reconciled">Conciliadas</option>
            <option value="all">Todas</option>
          </select>
        </label>
        {day && (
          <Button variant="ghost" size="sm" onClick={() => setDay("")}>
            Ver mês inteiro
          </Button>
        )}
      </div>
      {bank.isPending ? (
        <p role="status">Carregando extrato do mês…</p>
      ) : bank.isError ? (
        <div role="alert" className="rounded-xl border p-4">
          <p>Não foi possível carregar o extrato: {(bank.error as Error).message}</p>
          <Button onClick={() => bank.refetch()}>Tentar novamente</Button>
        </div>
      ) : !bank.data?.connection ? (
        <p>Vincule a conta Sicoob em Contas e extratos para começar.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Entradas no banco", currency(totals.credits)],
              ["Saídas no banco", currency(totals.debits)],
              ["Pendentes de conciliação", String(totals.pending)],
              ["Conciliadas", `${periodRows.length - totals.pending} de ${periodRows.length}`],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-xl border bg-card p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words text-lg font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <section className="min-w-0 rounded-xl border bg-card p-3">
              <h3 className="mb-3 font-semibold">
                Extrato · {account?.name ?? bank.data.connection.name}
              </h3>
              <div className="max-h-[65vh] space-y-2 overflow-y-auto">
                {!visible.length && (
                  <p className="p-4 text-sm text-muted-foreground">
                    Nenhuma movimentação neste filtro. Para consultar o banco, use Atualizar
                    extrato.
                  </p>
                )}
                {visible.map((row) => (
                  <button
                    type="button"
                    key={row.id}
                    aria-pressed={selected?.id === row.id}
                    onClick={() => {
                      setSelectedId(row.id);
                      setSearch("");
                      setShowMore(false);
                    }}
                    className={`block w-full min-w-0 rounded-lg border p-3 text-left ${selected?.id === row.id ? "border-primary bg-primary/5" : "hover:bg-muted/30"}`}
                  >
                    <div className="flex flex-wrap justify-between gap-2 text-sm">
                      <span>{displayDate(row.booked_on)}</span>
                      <strong>
                        <Amount cents={row.amount_cents} />
                      </strong>
                    </div>
                    <p className="mt-1 break-words text-sm">
                      {bankDescriptionParts(row.description).title}
                    </p>
                    <p className="break-words text-xs text-muted-foreground">
                      {bankDescriptionParts(row.description).detail}
                    </p>
                    <div className="mt-2">
                      <StatusChip status={isReconciled(row) ? "Conciliada" : "Pendente"} />
                    </div>
                  </button>
                ))}
              </div>
            </section>
            <section className="min-w-0 space-y-3 rounded-xl border bg-card p-3">
              <h3 className="font-semibold">Lançamentos do sistema</h3>
              {!selected ? (
                <p className="text-sm text-muted-foreground">
                  Selecione uma movimentação do extrato.
                </p>
              ) : (
                <>
                  <div className="rounded-lg bg-muted/40 p-3 text-sm">
                    <p className="break-words">
                      {bankDescriptionParts(selected.description).title} ·{" "}
                      {displayDate(selected.booked_on)}
                    </p>
                    <strong>
                      <Amount cents={selected.amount_cents} />
                    </strong>
                  </div>
                  {isReconciled(selected) ? (
                    <>
                      <p className="text-sm">Esta movimentação já está vinculada ao financeiro.</p>
                      <Button
                        variant="outline"
                        onClick={() =>
                          setAction({
                            title: "Desfazer conciliação",
                            explanation:
                              "Remove somente o vínculo com o banco. A baixa permanece no financeiro.",
                            needsReason: true,
                            run: (reason) =>
                              financeRpc("office_bank_unreconcile", {
                                p_transaction: selected.id,
                                p_reason: reason,
                              }),
                          })
                        }
                      >
                        Desfazer vínculo
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {selected.amount_cents > 0 ? "Receitas a receber" : "Despesas a pagar"} em
                        aberto. Valores iguais aparecem primeiro, seguidos pela proximidade do
                        vencimento. Confira a pessoa e a descrição antes de vincular.
                      </p>
                      <Input
                        aria-label="Buscar lançamento para conciliar"
                        placeholder="Buscar descrição, fornecedor ou cliente"
                        value={search}
                        onChange={(event) => {
                          setSearch(event.target.value);
                          setShowMore(false);
                        }}
                      />
                      <div className="max-h-[45vh] space-y-2 overflow-y-auto">
                        {!candidates.length && (
                          <p className="p-3 text-sm text-muted-foreground">
                            Nenhum lançamento em aberto correspondente à busca.
                          </p>
                        )}
                        {candidates.slice(0, showMore ? candidates.length : 20).map((entry) => {
                          const remaining = entry.amount_cents - entry.settled_cents,
                            amount = Math.abs(selected.amount_cents),
                            allowed = amount <= remaining;
                          return (
                            <div
                              key={entry.id}
                              className="min-w-0 space-y-2 rounded-lg border p-3 text-sm"
                            >
                              <p className="break-words font-medium">{entry.description}</p>
                              <p className="break-words text-xs text-muted-foreground">
                                {entry.supplier || entry.counterparty_name || ""} · {entry.category}
                              </p>
                              <div className="flex flex-wrap justify-between gap-2">
                                <span>Vence {displayDate(entry.due_date)}</span>
                                <strong>Em aberto {currency(remaining)}</strong>
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs text-muted-foreground">
                                  {amount === remaining
                                    ? "Mesmo valor · conferir correspondência"
                                    : allowed
                                      ? `Baixa parcial · restará ${currency(remaining - amount)}`
                                      : "Valor bancário maior que o saldo"}
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!allowed}
                                  onClick={() => {
                                    const settlement = crypto.randomUUID();
                                    setAction({
                                      title: "Confirmar baixa e conciliação",
                                      explanation: `Registrar ${currency(amount)} em “${entry.description}”, na conta ${account?.name ?? "vinculada ao Sicoob"}, em ${displayDate(selected.booked_on)}. ${amount < remaining ? `Restará ${currency(remaining - amount)} em aberto.` : "O lançamento ficará quitado."} Isso registra um movimento que já ocorreu no banco; não executa um pagamento.`,
                                      run: () =>
                                        financeRpc("office_bank_settle_existing", {
                                          p_transaction: selected.id,
                                          p_entry: entry.id,
                                          p_settlement: settlement,
                                        }),
                                    });
                                  }}
                                >
                                  Vincular lançamento
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {candidates.length > 20 && !showMore && (
                        <Button variant="ghost" onClick={() => setShowMore(true)}>
                          Mostrar os {candidates.length} lançamentos
                        </Button>
                      )}
                      <div className="border-t pt-3">
                        <p className="mb-2 text-xs text-muted-foreground">
                          Se já houve baixa no sistema, vincule o pagamento existente para não
                          duplicá-lo. Se falta o lançamento, cadastre a receita ou despesa a partir
                          do extrato.
                        </p>
                        <Button
                          className="h-auto whitespace-normal"
                          variant="outline"
                          onClick={() => setDialog(selected)}
                        >
                          Vincular baixa existente ou cadastrar lançamento
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}
      {dialog && (
        <ReconcileDialog
          key={dialog.id}
          transaction={dialog}
          userId={userId}
          close={() => setDialog(null)}
          refresh={refresh}
        />
      )}
      {action && (
        <FinanceActionDialog action={action} close={() => setAction(null)} refresh={refresh} />
      )}
    </div>
  );
}
