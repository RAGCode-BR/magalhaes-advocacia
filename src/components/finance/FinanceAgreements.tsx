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
import { useClients, useTasks } from "@/hooks/use-data";
import { financeCents, type FinanceAgreement } from "@/lib/office-finance";
import {
  currency,
  displayDate,
  fieldClass,
  selectClass,
  isoToday,
  financeRpc,
} from "@/lib/office-finance-data";
import { FinanceActionDialog, type FinanceAction } from "./FinanceActionDialog";

const statuses = {
  draft: "Rascunho",
  approved: "Aprovado",
  rejected: "Recusado",
  active: "Financeiro gerado",
  closed: "Encerrado",
};

export function FinanceAgreements({
  agreements,
  kind,
  refresh,
}: {
  agreements: FinanceAgreement[];
  kind: "quote" | "recurring";
  refresh: () => Promise<void>;
}) {
  const { data: clients = [] } = useClients();
  const [draftId, setDraftId] = useState<string | null>(null);
  const [action, setAction] = useState<FinanceAction | null>(null);
  const [search, setSearch] = useState("");
  const title = kind === "quote" ? "Orçamentos" : "Contratos recorrentes";
  const filtered = agreements.filter(
    (item) =>
      item.kind === kind &&
      (item.description + " " + clients.find((client) => client.id === item.client_id)?.name)
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")),
  );
  function prepare(item: FinanceAgreement, operation: string, explanation: string) {
    setAction({
      title:
        operation === "generate"
          ? "Gerar contas a receber"
          : operation === "close"
            ? "Encerrar contrato"
            : "Atualizar orçamento",
      explanation,
      run: () =>
        financeRpc("office_finance_agreement_action", { target: item.id, action: operation }),
    });
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {kind === "quote"
              ? "Aprove a proposta e gere as parcelas de honorários."
              : "Gere as mensalidades do período contratado."}
          </p>
        </div>
        <Button onClick={() => setDraftId(crypto.randomUUID())}>
          {kind === "quote" ? "Novo orçamento" : "Novo contrato"}
        </Button>
      </div>
      <Input
        aria-label="Buscar orçamento ou contrato"
        placeholder="Buscar por descrição ou cliente"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {!filtered.length && (
        <p className="py-5 text-sm text-muted-foreground">Nenhum registro encontrado.</p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {filtered.map((item) => (
          <article className="space-y-3 rounded-lg border p-4" key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold">{item.description}</h3>
              <span className="text-sm text-primary">{statuses[item.status]}</span>
            </div>
            <p className="text-sm">
              {clients.find((client) => client.id === item.client_id)?.name ?? "Cliente removido"}
            </p>
            <p className="text-sm">
              {currency(item.amount_cents)}{" "}
              {kind === "recurring"
                ? `por mês · ${item.periods} meses`
                : `no total · ${item.periods} parcelas`}
            </p>
            <p className="text-sm text-muted-foreground">
              Primeiro vencimento {displayDate(item.first_due)} · {item.category}
            </p>
            {item.notes && <p className="whitespace-pre-wrap text-sm">{item.notes}</p>}
            <div className="flex flex-wrap gap-2">
              {kind === "quote" && item.status === "draft" && (
                <>
                  <Button
                    variant="outline"
                    onClick={() =>
                      prepare(
                        item,
                        "approve",
                        "Registrar a aprovação desta proposta no escritório.",
                      )
                    }
                  >
                    Aprovar
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => prepare(item, "reject", "Registrar a recusa desta proposta.")}
                  >
                    Recusar
                  </Button>
                </>
              )}
              {!item.generated_at &&
                (item.status === "approved" || kind === "recurring") &&
                item.status !== "closed" && (
                  <Button
                    onClick={() =>
                      prepare(
                        item,
                        "generate",
                        kind === "quote"
                          ? "Criar as parcelas em Contas a receber, vinculadas ao cliente e ao processo."
                          : "Criar uma receita mensal para cada mês contratado. A geração ocorre uma única vez.",
                      )
                    }
                  >
                    Gerar financeiro
                  </Button>
                )}
              {item.status === "active" && kind === "recurring" && (
                <Button
                  variant="outline"
                  onClick={() =>
                    prepare(
                      item,
                      "close",
                      "As mensalidades com vencimento a partir de hoje e sem baixas serão canceladas. Valores recebidos e mensalidades vencidas permanecem no histórico.",
                    )
                  }
                >
                  Encerrar contrato
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {draftId && (
        <AgreementEditor
          id={draftId}
          kind={kind}
          close={() => setDraftId(null)}
          refresh={refresh}
        />
      )}
      {action && (
        <FinanceActionDialog action={action} close={() => setAction(null)} refresh={refresh} />
      )}
    </Card>
  );
}

function AgreementEditor({
  id,
  kind,
  close,
  refresh,
}: {
  id: string;
  kind: "quote" | "recurring";
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const { data: clients = [] } = useClients();
  const { data: tasks = [] } = useTasks();
  const [clientId, setClientId] = useState("");
  const [processId, setProcessId] = useState("");
  const mutation = useMutation({
    mutationFn: async (form: FormData) => {
      const value = (name: string) => String(form.get(name) ?? "").trim();
      const amount = financeCents(value("amount"));
      const periods = Number(value("periods"));
      if (!amount || (kind === "quote" && amount < periods))
        throw new Error("Confira o valor e as parcelas.");
      await financeRpc("office_finance_save_agreement", {
        target: id,
        agreement_kind: kind,
        data: {
          description: value("description"),
          client_id: clientId,
          process_id: processId,
          amount_cents: amount,
          periods,
          first_due: value("due"),
          competence_date: value("competence"),
          category: value("category"),
          cost_center: value("cost_center"),
          notes: value("notes"),
        },
      });
    },
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {kind === "quote" ? "Novo orçamento" : "Novo contrato recorrente"}
          </DialogTitle>
          <DialogDescription>
            {kind === "quote"
              ? "Informe o valor total da proposta e a quantidade de parcelas."
              : "Informe a mensalidade e quantos meses serão cobrados."}
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
            <Input name="description" required maxLength={200} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={fieldClass}>
              Cliente
              <select
                required
                className={selectClass}
                value={clientId}
                onChange={(event) => {
                  setClientId(event.target.value);
                  setProcessId("");
                }}
              >
                <option value="">Selecione</option>
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
                value={processId}
                disabled={!clientId}
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
              {kind === "quote" ? "Valor total em R$" : "Mensalidade em R$"}
              <Input name="amount" required inputMode="decimal" placeholder="0,00" />
            </label>
            <label className={fieldClass}>
              {kind === "quote" ? "Parcelas" : "Meses contratados"}
              <Input name="periods" type="number" required min={1} max={120} defaultValue={1} />
            </label>
            <label className={fieldClass}>
              Primeiro vencimento
              <Input name="due" type="date" required defaultValue={isoToday()} />
            </label>
            <label className={fieldClass}>
              Competência inicial
              <Input name="competence" type="date" required defaultValue={isoToday()} />
            </label>
            <label className={fieldClass}>
              Categoria
              <Input name="category" required maxLength={100} defaultValue="Honorários" />
            </label>
            <label className={fieldClass}>
              Centro de custo
              <Input name="cost_center" maxLength={160} />
            </label>
          </div>
          <label className={fieldClass}>
            Condições e observações
            <Textarea name="notes" maxLength={4000} />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={close}>
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
