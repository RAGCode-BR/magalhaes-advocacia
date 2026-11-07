import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FinanceRegister } from "@/lib/office-finance";
import { fieldClass, selectClass, financeRpc } from "@/lib/office-finance-data";

const labels = {
  supplier: "Fornecedores",
  category: "Categorias",
  cost_center: "Centros de custo",
};

export function FinanceRegisters({
  registers,
  refresh,
}: {
  registers: FinanceRegister[];
  refresh: () => Promise<void>;
}) {
  const [kind, setKind] = useState<FinanceRegister["kind"]>("supplier");
  const [editing, setEditing] = useState<(Partial<FinanceRegister> & { id: string }) | null>(null);
  const [search, setSearch] = useState("");
  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Cadastros financeiros</h2>
        <Button onClick={() => setEditing({ id: crypto.randomUUID(), kind, active: true })}>
          Novo cadastro
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Tipo de cadastro"
          className={selectClass + " sm:w-auto"}
          value={kind}
          onChange={(event) => setKind(event.target.value as FinanceRegister["kind"])}
        >
          {Object.entries(labels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <Input
          className="sm:max-w-xs"
          aria-label="Pesquisar cadastros"
          placeholder="Pesquisar"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <ul className="divide-y">
        {registers
          .filter(
            (item) =>
              item.kind === kind &&
              item.name.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")),
          )
          .map((item) => (
            <li className="flex items-center justify-between gap-3 py-3" key={item.id}>
              <div className="min-w-0">
                <p className="break-words font-medium">
                  {item.name}
                  {!item.active && " · Inativo"}
                </p>
                {item.contact && (
                  <p className="break-words text-sm text-muted-foreground">{item.contact}</p>
                )}
                {item.notes && (
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {item.notes}
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditing(item)}>
                Editar
              </Button>
            </li>
          ))}
      </ul>
      {registers.filter((item) => item.kind === kind).length === 0 && (
        <p className="py-5 text-sm text-muted-foreground">Nenhum cadastro neste grupo.</p>
      )}
      {editing && (
        <RegisterEditor
          key={editing.id}
          item={editing}
          close={() => setEditing(null)}
          refresh={refresh}
        />
      )}
    </Card>
  );
}

function RegisterEditor({
  item,
  close,
  refresh,
}: {
  item: Partial<FinanceRegister> & { id: string };
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const mutation = useMutation({
    mutationFn: async (form: FormData) =>
      financeRpc("office_finance_save_register", {
        target: item.id,
        register_kind: item.kind,
        data: {
          name: String(form.get("name")).trim(),
          contact: String(form.get("contact") ?? "").trim(),
          notes: String(form.get("notes") ?? "").trim(),
          active: form.get("active") === "yes",
        },
      }),
    onSuccess: async () => {
      await refresh();
      close();
      toast.success("Cadastro salvo.");
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
          <DialogTitle>{item.name ? "Editar cadastro" : "Novo cadastro"}</DialogTitle>
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
            <Input
              name="name"
              required
              maxLength={item.kind === "category" ? 100 : 160}
              defaultValue={item.name}
            />
          </label>
          {item.kind === "supplier" && (
            <label className={fieldClass}>
              Telefone ou e-mail
              <Input name="contact" maxLength={254} defaultValue={item.contact ?? ""} />
            </label>
          )}
          <label className={fieldClass}>
            Observações
            <Textarea name="notes" maxLength={2000} defaultValue={item.notes ?? ""} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" value="yes" defaultChecked={item.active} />{" "}
            Cadastro ativo
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
