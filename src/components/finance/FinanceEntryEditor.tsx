import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { financeCents, type FinanceEntry, type FinanceRegister } from "@/lib/office-finance";
import { fieldClass, financeRpc } from "@/lib/office-finance-data";

export function FinanceEntryEditor({
  entry,
  registers,
  close,
  refresh,
}: {
  entry: FinanceEntry;
  registers: FinanceRegister[];
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const mutation = useMutation({
    mutationFn: async (form: FormData) => {
      const value = (key: string) => String(form.get(key) ?? "").trim();
      const amount = financeCents(value("amount"));
      if (!amount || amount < entry.settled_cents)
        throw new Error("O valor deve ser positivo e cobrir as baixas registradas.");
      await financeRpc("office_finance_edit_entry", {
        target: entry.id,
        data: {
          description: value("description"),
          category: value("category"),
          supplier: value("supplier"),
          notes: value("notes"),
          cost_center: value("cost_center"),
          amount_cents: amount,
          due_date: value("due"),
          competence_date: value("competence"),
        },
      });
    },
    onSuccess: async () => {
      await refresh();
      close();
      toast.success("Lançamento atualizado.");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível atualizar."),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar lançamento</DialogTitle>
          <DialogDescription>
            A alteração será aplicada somente a esta parcela e ficará registrada no histórico.
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
            Descrição
            <Input name="description" required maxLength={200} defaultValue={entry.description} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={fieldClass}>
              Valor em R$
              <Input
                name="amount"
                inputMode="decimal"
                required
                defaultValue={(entry.amount_cents / 100).toFixed(2).replace(".", ",")}
              />
            </label>
            <label className={fieldClass}>
              Categoria
              <Input
                name="category"
                list="edit-categories"
                required
                maxLength={100}
                defaultValue={entry.category}
              />
            </label>
            <label className={fieldClass}>
              Vencimento
              <Input type="date" name="due" required defaultValue={entry.due_date} />
            </label>
            <label className={fieldClass}>
              Competência
              <Input type="date" name="competence" required defaultValue={entry.competence_date} />
            </label>
            <label className={fieldClass}>
              Centro de custo
              <Input
                name="cost_center"
                list="edit-centers"
                maxLength={160}
                defaultValue={entry.cost_center ?? ""}
              />
            </label>
            {entry.kind === "expense" && (
              <label className={fieldClass}>
                Fornecedor
                <Input
                  name="supplier"
                  list="edit-suppliers"
                  maxLength={160}
                  defaultValue={entry.supplier ?? ""}
                />
              </label>
            )}
          </div>
          <label className={fieldClass}>
            Observações
            <Textarea name="notes" maxLength={4000} defaultValue={entry.notes ?? ""} />
          </label>
          {(["category", "cost_center", "supplier"] as const).map((kind) => (
            <datalist
              key={kind}
              id={
                kind === "category"
                  ? "edit-categories"
                  : kind === "cost_center"
                    ? "edit-centers"
                    : "edit-suppliers"
              }
            >
              {registers
                .filter((item) => item.kind === kind && item.active)
                .map((item) => (
                  <option key={item.id} value={item.name} />
                ))}
            </datalist>
          ))}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={close}>
              Cancelar
            </Button>
            <Button disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar alterações"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
