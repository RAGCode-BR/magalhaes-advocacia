import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Layers, Pencil, Plus, Wallet } from "lucide-react";
import { FinanceBalanceChart } from "./FinanceBalanceChart";
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
  financeBalanceSeries,
  financeCents,
  financeAccountBalance,
  type FinanceAccount,
} from "@/lib/office-finance";
import {
  currency,
  displayDate,
  fieldClass,
  selectClass,
  isoToday,
  financeRpc,
  type OfficeFinanceData,
} from "@/lib/office-finance-data";
import { isSicoobAccount, loadBankOverview } from "@/lib/office-bank";
import { FinanceBank } from "./FinanceBank";
import { FinanceStatement } from "./FinanceReports";
import { SicoobLogo } from "./FinanceSheet";

export function FinanceAccounts({
  ledger,
  userId,
  refresh,
  openBank = false,
}: {
  ledger: OfficeFinanceData;
  userId: string;
  refresh: () => Promise<void>;
  /** Opens the Sicoob statement directly (from the dashboard). */
  openBank?: boolean;
}) {
  const [editing, setEditing] = useState<(Partial<FinanceAccount> & { id: string }) | null>(null);
  const [transferId, setTransferId] = useState<string | null>(null);
  const today = isoToday();
  // Same query key as the Sicoob view's first page, so this shares its cache.
  const month = today.slice(0, 7);
  const bank = useQuery({
    queryKey: ["office-bank", userId, month, "all", undefined],
    queryFn: () => loadBankOverview(month, "all"),
    staleTime: 30000,
  });
  const bankAccountId = bank.data?.connection?.account_id;
  const isBank = (account: FinanceAccount) =>
    account.id === bankAccountId || isSicoobAccount(account.name);
  const ordered = [...ledger.accounts].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      Number(isBank(b)) - Number(isBank(a)) ||
      a.name.localeCompare(b.name, "pt-BR"),
  );
  const [chosenId, setSelectedId] = useState<string | null>(null);
  // Until the person picks a card, follow the dashboard's request to open Sicoob.
  const bankDefault = openBank
    ? (ledger.accounts.find((account) => isBank(account))?.id ?? "")
    : "";
  const selectedId = chosenId ?? bankDefault;
  const selected = ledger.accounts.find((account) => account.id === selectedId);
  const [view, setView] = useState<"bank" | "system">("bank");
  const balances = new Map(
    ledger.accounts.map((account) => [
      account.id,
      financeAccountBalance(account, ledger.entries, ledger.settlements, ledger.transfers, today),
    ]),
  );
  const total = ledger.accounts
    .filter((account) => account.active)
    .reduce((sum, account) => sum + (balances.get(account.id) ?? 0), 0);
  const active = ledger.accounts.filter((account) => account.active);
  const series = financeBalanceSeries(
    ledger.accounts,
    ledger.entries,
    ledger.settlements,
    ledger.transfers,
    today,
  );
  const monthAgo = series[series.length - 31]?.cents ?? 0;
  const change = total - monthAgo;
  const bankBalance = bank.data?.balances?.ledger;
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden p-0">
        <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:p-6">
          <div className="flex min-w-0 flex-col justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Saldo consolidado</p>
              <p className="mt-1 break-words text-[2.5rem] font-semibold leading-none tracking-tight tabular-nums">
                {currency(total)}
              </p>
              <p className="mt-2 text-sm">
                <span
                  className={`font-medium tabular-nums ${change < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}
                >
                  {change >= 0 ? "+" : "−"}
                  {currency(Math.abs(change))}
                </span>{" "}
                <span className="text-muted-foreground">nos últimos 30 dias</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={active.length < 2}
                onClick={() => setTransferId(crypto.randomUUID())}
              >
                <ArrowLeftRight className="h-3.5 w-3.5" /> Transferir
              </Button>
              <Button
                size="sm"
                onClick={() => setEditing({ id: crypto.randomUUID(), active: true })}
              >
                <Plus className="h-3.5 w-3.5" /> Nova conta
              </Button>
            </div>
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-xs text-muted-foreground">Evolução do saldo · 90 dias</p>
            <FinanceBalanceChart points={series} label="Evolução do saldo consolidado" />
          </div>
        </div>
        <div className="grid gap-3 border-t bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-4 md:px-6">
          <button
            type="button"
            aria-pressed={!selectedId}
            onClick={() => setSelectedId("")}
            className={`flex min-h-28 flex-col justify-between rounded-xl border bg-card p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              !selectedId ? "ring-2 ring-primary" : "hover:border-foreground/20"
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Layers className="h-4 w-4 text-muted-foreground" /> Todas as contas
            </span>
            <span>
              <span className="block text-xs text-muted-foreground">
                {active.length} {active.length === 1 ? "conta ativa" : "contas ativas"}
              </span>
              <span className="text-lg font-semibold tabular-nums">{currency(total)}</span>
            </span>
          </button>
          {ordered.map((account) => {
            const balance = balances.get(account.id) ?? 0;
            const bankAccount = isBank(account);
            const isSelected = selectedId === account.id;
            return (
              <div key={account.id} className="group relative">
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelectedId(account.id);
                    setView(bankAccount ? "bank" : "system");
                  }}
                  className={`flex min-h-28 w-full flex-col justify-between rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    bankAccount
                      ? "border-transparent bg-[linear-gradient(135deg,#003641_0%,#00544f_55%,#00ae9d_130%)] text-white"
                      : "bg-card"
                  } ${isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "hover:border-foreground/20"} ${
                    account.active ? "" : "opacity-60"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2 pr-7 text-sm font-medium">
                    {bankAccount ? (
                      <SicoobLogo className="h-3.5" />
                    ) : (
                      <Wallet className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{account.name}</span>
                  </span>
                  <span>
                    <span
                      className={`block text-xs ${bankAccount ? "text-white/70" : "text-muted-foreground"}`}
                    >
                      {bankAccount && bankBalance
                        ? `No banco: ${currency(bankBalance.amount_cents)}`
                        : account.active
                          ? "Saldo no sistema"
                          : "Conta inativa"}
                    </span>
                    <span
                      className={`text-lg font-semibold tabular-nums ${balance < 0 && !bankAccount ? "text-destructive" : ""}`}
                    >
                      {currency(balance)}
                    </span>
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`absolute right-2 top-2 h-7 w-7 ${bankAccount ? "text-white hover:bg-white/15 hover:text-white" : ""}`}
                  aria-label={`Editar conta ${account.name}`}
                  onClick={() => setEditing(account)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
        {!ledger.accounts.length && (
          <p className="px-6 pb-5 text-sm text-muted-foreground">
            Cadastre a conta corrente ou o caixa do escritório para acompanhar os saldos.
          </p>
        )}
      </Card>
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">
            {selected ? `Extrato · ${selected.name}` : "Extrato de todas as contas"}
          </h3>
          {selected && isBank(selected) && (
            <div
              className="flex rounded-md border p-0.5"
              role="group"
              aria-label="Origem do extrato"
            >
              {(
                [
                  ["bank", "Extrato do banco"],
                  ["system", "Baixas no sistema"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={view === value}
                  onClick={() => setView(value)}
                  className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    view === value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {selected && isBank(selected) && view === "bank" ? (
          <FinanceBank userId={userId} />
        ) : (
          <FinanceStatement key={selectedId} ledger={ledger} accountId={selectedId} embedded />
        )}
      </Card>
      {editing && (
        <AccountEditor
          key={editing.id}
          item={editing}
          close={() => setEditing(null)}
          refresh={refresh}
        />
      )}
      {transferId && (
        <TransferEditor
          id={transferId}
          accounts={ledger.accounts}
          close={() => setTransferId(null)}
          refresh={refresh}
        />
      )}
    </div>
  );
}

function AccountEditor({
  item,
  close,
  refresh,
}: {
  item: Partial<FinanceAccount> & { id: string };
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const mutation = useMutation({
    mutationFn: async (form: FormData) => {
      const text = String(form.get("balance") ?? "0").trim();
      const cents = financeCents(text.replace(/^-/, ""));
      if (
        !/^[-]?\d+(?:[.,]\d{1,2})?$/.test(text) ||
        (Number(text.replace(",", ".")) !== 0 && !cents)
      )
        throw new Error("Confira o saldo de abertura.");
      await financeRpc("office_finance_save_register", {
        target: item.id,
        register_kind: "account",
        data: {
          name: String(form.get("name")).trim(),
          opening_cents: text.startsWith("-") ? -cents : cents,
          opening_date: String(form.get("date") ?? item.opening_date),
          active: form.get("active") === "yes",
        },
      });
    },
    onSuccess: async () => {
      await refresh();
      close();
      toast.success("Conta salva.");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível salvar."),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.name ? "Editar conta" : "Nova conta financeira"}</DialogTitle>
          <DialogDescription>
            {item.name
              ? "Atualize o nome ou inative a conta. O saldo de abertura é preservado."
              : "Informe o saldo inicial e a data a partir da qual os movimentos serão contabilizados."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!mutation.isPending) mutation.mutate(new FormData(event.currentTarget));
          }}
        >
          <label className={fieldClass}>
            Nome
            <Input name="name" required maxLength={100} defaultValue={item.name} />
          </label>
          {!item.name && (
            <>
              <label className={fieldClass}>
                Saldo de abertura em R$
                <Input name="balance" required inputMode="decimal" defaultValue="0,00" />
              </label>
              <label className={fieldClass}>
                Data de abertura
                <Input name="date" required type="date" defaultValue={isoToday()} />
              </label>
            </>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input name="active" value="yes" type="checkbox" defaultChecked={item.active} /> Conta
            ativa
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close} disabled={mutation.isPending}>
              Cancelar
            </Button>
            <Button disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TransferEditor({
  id,
  accounts,
  close,
  refresh,
}: {
  id: string;
  accounts: FinanceAccount[];
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const mutation = useMutation({
    mutationFn: async (form: FormData) => {
      const cents = financeCents(String(form.get("amount")));
      if (!cents) throw new Error("Informe um valor maior que zero.");
      await financeRpc("office_finance_transfer", {
        target: id,
        data: {
          from_account: form.get("from"),
          to_account: form.get("to"),
          amount_cents: cents,
          transferred_on: form.get("date"),
          description: String(form.get("description")).trim(),
        },
      });
    },
    onSuccess: async () => {
      await refresh();
      close();
      toast.success("Transferência registrada.");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível registrar."),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar transferência</DialogTitle>
          <DialogDescription>
            Este registro atualiza os saldos internos. A movimentação deve ser realizada no banco.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!mutation.isPending) mutation.mutate(new FormData(event.currentTarget));
          }}
        >
          {["from", "to"].map((name) => (
            <label key={name} className={fieldClass}>
              {name === "from" ? "Conta de origem" : "Conta de destino"}
              <select name={name} className={selectClass} required defaultValue="">
                <option value="">Selecione</option>
                {accounts
                  .filter((account) => account.active)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <label className={fieldClass}>
            Valor em R$
            <Input required name="amount" inputMode="decimal" />
          </label>
          <label className={fieldClass}>
            Data
            <Input required name="date" type="date" max={isoToday()} defaultValue={isoToday()} />
          </label>
          <label className={fieldClass}>
            Descrição
            <Input required name="description" maxLength={200} />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close} disabled={mutation.isPending}>
              Cancelar
            </Button>
            <Button disabled={mutation.isPending}>
              {mutation.isPending ? "Registrando…" : "Registrar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
