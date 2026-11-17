import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import {
  SUGGESTED_PLAN,
  financePlanDepth,
  financePlanSort,
  type FinanceRegister,
} from "@/lib/office-finance";
import { Sheet, SheetGutter, StatusChip } from "./FinanceSheet";
import { fieldClass, selectClass, financeRpc } from "@/lib/office-finance-data";

const labels = {
  category: "Plano de contas",
  cost_center: "Centros de custo",
  supplier: "Fornecedores",
};
const singular = {
  category: "Nova conta do plano",
  cost_center: "Novo centro de custo",
  supplier: "Novo fornecedor",
};

export function FinanceRegisters({
  registers,
  refresh,
}: {
  registers: FinanceRegister[];
  refresh: () => Promise<void>;
}) {
  const [kind, setKind] = useState<FinanceRegister["kind"]>("category");
  const [editing, setEditing] = useState<(Partial<FinanceRegister> & { id: string }) | null>(null);
  const [search, setSearch] = useState("");
  const [confirmPlan, setConfirmPlan] = useState(false);
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const items = registers
    .filter(
      (item) =>
        item.kind === kind &&
        [item.name, item.code, item.contact].some((v) =>
          v?.toLocaleLowerCase("pt-BR").includes(term),
        ),
    )
    .sort(kind === "category" ? financePlanSort : (a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const hasCodes = registers.some((item) => item.kind === "category" && item.code);
  const codes = registers
    .filter((item) => item.kind === "category" && item.code)
    .map((item) => item.code ?? "");
  const isGroup = (code?: string | null) =>
    !!code && codes.some((other) => other.startsWith(code + "."));
  const suggest = useMutation({
    mutationFn: async () => {
      const byName = new Map(
        registers
          .filter((item) => item.kind === "category")
          .map((item) => [item.name.trim().toLocaleLowerCase("pt-BR"), item]),
      );
      const usedCodes = new Set(registers.map((item) => item.code).filter(Boolean));
      for (const suggestion of SUGGESTED_PLAN) {
        const existing = byName.get(suggestion.name.toLocaleLowerCase("pt-BR"));
        if (existing?.code || usedCodes.has(suggestion.code)) continue;
        await financeRpc("office_finance_save_register", {
          target: existing?.id ?? crypto.randomUUID(),
          register_kind: "category",
          data: {
            name: existing?.name ?? suggestion.name,
            contact: existing?.contact ?? "",
            notes: existing?.notes ?? "",
            active: existing?.active ?? true,
            code: suggestion.code,
            nature: suggestion.nature,
          },
        });
      }
    },
    onSuccess: async () => {
      await refresh();
      setConfirmPlan(false);
      toast.success("Plano de contas sugerido criado. Edite ou inative o que não usar.");
    },
    onError: async (error: Error) => {
      await refresh();
      toast.error(error.message || "Não foi possível criar o plano sugerido.");
    },
  });
  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Plano de contas e cadastros</h2>
          <p className="text-sm text-muted-foreground">
            Classifique cada receita e despesa por conta do plano e, se quiser, por centro de custo
            (área, unidade ou sócio).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {kind === "category" && !hasCodes && (
            <Button variant="outline" onClick={() => setConfirmPlan(true)}>
              Usar plano sugerido
            </Button>
          )}
          <Button onClick={() => setEditing({ id: crypto.randomUUID(), kind, active: true })}>
            <Plus /> {singular[kind]}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Tipo de cadastro">
          {(Object.keys(labels) as FinanceRegister["kind"][]).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                kind === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {labels[value]}
            </button>
          ))}
        </div>
        <Input
          className="sm:max-w-xs"
          aria-label="Pesquisar cadastros"
          placeholder={kind === "category" ? "Pesquisar por código ou nome" : "Pesquisar"}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {items.length ? (
        <Sheet
          label={labels[kind]}
          columns={[
            ...(kind === "category" ? [{ label: "Código", className: "w-24" }] : []),
            { label: kind === "category" ? "Conta" : "Nome" },
            ...(kind === "category" ? [{ label: "Natureza" }] : []),
            ...(kind === "supplier" ? [{ label: "Contato" }] : []),
            { label: "Observações" },
            { label: "Situação" },
            { label: "" },
          ]}
        >
          {items.map((item, index) => {
            const depth = financePlanDepth(item.code);
            return (
              <tr key={item.id} className={item.active ? "" : "text-muted-foreground"}>
                <SheetGutter n={index + 1} />
                {kind === "category" && (
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {item.code ?? "—"}
                  </td>
                )}
                <td
                  className={`min-w-44 break-words ${kind === "category" && isGroup(item.code) ? "font-semibold" : ""}`}
                  style={kind === "category" ? { paddingLeft: `${0.6 + depth * 1.1}rem` } : {}}
                >
                  {item.name}
                </td>
                {kind === "category" && (
                  <td className="whitespace-nowrap">
                    {item.nature === "income" ? (
                      <span className="text-emerald-700 dark:text-emerald-400">Receita</span>
                    ) : item.nature === "expense" ? (
                      <span className="text-destructive">Despesa</span>
                    ) : (
                      <span className="text-muted-foreground">Ambas</span>
                    )}
                  </td>
                )}
                {kind === "supplier" && (
                  <td className="break-words text-muted-foreground">{item.contact}</td>
                )}
                <td className="max-w-xs truncate text-muted-foreground" title={item.notes ?? ""}>
                  {item.notes}
                </td>
                <td>
                  <StatusChip status={item.active ? "Ativo" : "Cancelado"} />
                </td>
                <td>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setEditing(item)}
                  >
                    Editar
                  </Button>
                </td>
              </tr>
            );
          })}
        </Sheet>
      ) : (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          {kind === "category"
            ? "Nenhuma conta no plano. Use o plano sugerido ou cadastre a primeira conta."
            : kind === "cost_center"
              ? "Nenhum centro de custo. Exemplos: Administrativo, Trabalhista, Cível, Filial."
              : "Nenhum fornecedor cadastrado."}
        </p>
      )}
      {editing && (
        <RegisterEditor
          key={editing.id}
          item={editing}
          close={() => setEditing(null)}
          refresh={refresh}
        />
      )}
      {confirmPlan && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !suggest.isPending) setConfirmPlan(false);
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Usar plano de contas sugerido</DialogTitle>
              <DialogDescription>
                Serão criadas {SUGGESTED_PLAN.length} contas para escritório de advocacia. Contas
                com o mesmo nome já cadastradas recebem o código; nada é apagado e os lançamentos
                existentes continuam iguais.
              </DialogDescription>
            </DialogHeader>
            <ul className="max-h-64 overflow-y-auto rounded-md border p-2 text-sm">
              {SUGGESTED_PLAN.map((item) => (
                <li
                  key={item.code}
                  style={{ paddingLeft: `${financePlanDepth(item.code) * 1}rem` }}
                  className={financePlanDepth(item.code) === 0 ? "font-semibold" : ""}
                >
                  <span className="mr-2 tabular-nums text-muted-foreground">{item.code}</span>
                  {item.name}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={suggest.isPending}
                onClick={() => setConfirmPlan(false)}
              >
                Cancelar
              </Button>
              <Button disabled={suggest.isPending} onClick={() => suggest.mutate()}>
                {suggest.isPending ? "Criando…" : "Criar plano"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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
          ...(item.kind === "category"
            ? {
                code: String(form.get("code") ?? "").trim(),
                nature: String(form.get("nature") ?? ""),
              }
            : {}),
        },
      }),
    onSuccess: async () => {
      await refresh();
      close();
      toast.success("Cadastro salvo.");
    },
    onError: (error: Error) =>
      toast.error(
        /register_code/.test(error.message)
          ? "Já existe uma conta com este código."
          : /check constraint|violates/.test(error.message)
            ? "Confira o código: use números separados por ponto, como 2.3.01."
            : error.message || "Não foi possível salvar.",
      ),
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
          <DialogTitle>
            {item.name ? "Editar cadastro" : singular[item.kind ?? "category"]}
          </DialogTitle>
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
          {item.kind === "category" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldClass}>
                Código
                <Input
                  name="code"
                  placeholder="Ex.: 2.3.01"
                  pattern="[0-9]{1,3}(\.[0-9]{1,3}){0,4}"
                  title="Números separados por ponto, como 2.3.01"
                  maxLength={24}
                  defaultValue={item.code ?? ""}
                />
              </label>
              <label className={fieldClass}>
                Natureza
                <select name="nature" className={selectClass} defaultValue={item.nature ?? ""}>
                  <option value="">Receita e despesa</option>
                  <option value="income">Receita</option>
                  <option value="expense">Despesa</option>
                </select>
              </label>
            </div>
          )}
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
