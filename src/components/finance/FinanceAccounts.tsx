import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { financeCents, financeAccountBalance, type FinanceAccount } from "@/lib/office-finance";
import {
  currency,
  displayDate,
  fieldClass,
  selectClass,
  isoToday,
  financeRpc,
  type OfficeFinanceData,
} from "@/lib/office-finance-data";

export function FinanceAccounts({
  ledger,
  refresh,
}: {
  ledger: OfficeFinanceData;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<(Partial<FinanceAccount> & { id: string }) | null>(null);
  const [transferId, setTransferId] = useState<string | null>(null);
  const names = new Map(ledger.accounts.map((account) => [account.id, account.name]));
  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Contas financeiras</h2>
          <p className="text-sm text-muted-foreground">
            Saldos calculados pelos registros manuais do escritório.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={ledger.accounts.filter((account) => account.active).length < 2}
            onClick={() => setTransferId(crypto.randomUUID())}
          >
            Registrar transferência
          </Button>
          <Button onClick={() => setEditing({ id: crypto.randomUUID(), active: true })}>
            Nova conta
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ledger.accounts.map((account) => (
          <article className="space-y-2 rounded-lg border p-4" key={account.id}>
            <h3 className="font-medium">
              {account.name}
              {!account.active && " · Inativa"}
            </h3>
            <p className="text-2xl font-semibold tabular-nums">
              {currency(
                financeAccountBalance(
                  account,
                  ledger.entries,
                  ledger.settlements,
                  ledger.transfers,
                  isoToday(),
                ),
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              Abertura {displayDate(account.opening_date)} ·{" "}
              {currency(Number(account.opening_cents))}
            </p>
            <Button variant="outline" size="sm" onClick={() => setEditing(account)}>
              Editar conta
            </Button>
          </article>
        ))}
      </div>
      {!ledger.accounts.length && (
        <p className="py-5 text-sm text-muted-foreground">
          Cadastre a conta corrente ou o caixa do escritório.
        </p>
      )}
      <h3 className="font-medium">Transferências registradas</h3>
      <ul className="divide-y text-sm">
        {[...ledger.transfers]
          .sort((a, b) => b.transferred_on.localeCompare(a.transferred_on))
          .map((transfer) => (
            <li className="py-3" key={transfer.id}>
              {displayDate(transfer.transferred_on)} · {names.get(transfer.from_account)} →{" "}
              {names.get(transfer.to_account)} · {currency(transfer.amount_cents)}
              <p className="text-muted-foreground">{transfer.description}</p>
            </li>
          ))}
      </ul>
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
    </Card>
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
