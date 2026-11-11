import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileDown, KanbanSquare, Plus, Search, UserPlus } from "lucide-react";
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
import { useAuth } from "@/hooks/use-auth";
import { useClients, useTasks } from "@/hooks/use-data";
import { cn } from "@/lib/utils";
import { financeCents, type FinanceAgreement } from "@/lib/office-finance";
import {
  currency,
  displayDate,
  fieldClass,
  selectClass,
  isoToday,
  financeRpc,
} from "@/lib/office-finance-data";
import {
  defaultExclusions,
  defaultScope,
  proposalAreas,
  proposalFromAgreement,
  proposalLines,
  proposalNumber,
  proposalParty,
  proposalPayments,
  type ProposalDocument,
  type ProposalFeeModel,
  type ProposalPayment,
  type ProposalPractice,
} from "@/lib/finance-proposal";
import { supabase } from "@/integrations/supabase/client";
import { FinanceActionDialog, type FinanceAction } from "./FinanceActionDialog";

/** Contratante salvo na proposta (útil para orçamentos de novos contatos). */
function savedParty(item: FinanceAgreement) {
  const doc = item.proposal as Partial<ProposalDocument> | null | undefined;
  return doc?.client?.name ? doc.client : null;
}

const statuses: Record<FinanceAgreement["status"], { label: string; className: string }> = {
  draft: { label: "Aguardando resposta", className: "bg-secondary text-secondary-foreground" },
  approved: { label: "Aprovado", className: "bg-[#f3e4bd] text-[#5c4210]" },
  rejected: { label: "Recusado", className: "bg-muted text-muted-foreground" },
  active: { label: "Financeiro gerado", className: "bg-primary text-primary-foreground" },
  closed: { label: "Encerrado", className: "bg-muted text-muted-foreground" },
};

async function downloadProposal(doc: ProposalDocument) {
  const { downloadProposalPdf } = await import("@/lib/finance-proposal-pdf");
  await downloadProposalPdf(doc);
}

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
  const { data: tasks = [] } = useTasks();
  const [draftId, setDraftId] = useState<string | null>(null);
  const [action, setAction] = useState<FinanceAction | null>(null);
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [linking, setLinking] = useState<FinanceAgreement | null>(null);
  const isQuote = kind === "quote";
  const title = isQuote ? "Orçamentos" : "Contratos recorrentes";
  const clientOf = (item: FinanceAgreement) => clients.find((c) => c.id === item.client_id);
  const nameOf = (item: FinanceAgreement) =>
    clientOf(item)?.name ?? savedParty(item)?.name ?? "Cliente removido";
  const own = agreements.filter((item) => item.kind === kind);
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const filtered = own
    .filter((item) =>
      `${item.description} ${nameOf(item)}`.toLocaleLowerCase("pt-BR").includes(term),
    )
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const waiting = own.filter((item) => item.status === "draft");
  const approved = own.filter((item) => item.status === "approved" || item.status === "active");

  function prepare(item: FinanceAgreement, operation: string, explanation: string) {
    setAction({
      title:
        operation === "generate"
          ? "Gerar contas a receber"
          : operation === "close"
            ? "Encerrar contrato"
            : operation === "approve"
              ? "Aprovar orçamento"
              : "Recusar orçamento",
      explanation,
      run: () =>
        financeRpc("office_finance_agreement_action", { target: item.id, action: operation }),
    });
  }

  async function pdf(item: FinanceAgreement) {
    setDownloading(item.id);
    try {
      const issued = item.created_at?.slice(0, 10) ?? isoToday();
      const process = tasks.find((task) => task.id === item.process_id)?.title;
      await downloadProposal(proposalFromAgreement(item, clientOf(item), issued, process));
    } catch (error) {
      toast.error((error as Error).message || "Não foi possível gerar o PDF.");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <Card className="min-w-0 space-y-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {isQuote
              ? "Monte a proposta de honorários, envie o PDF ao cliente e acompanhe o lead no CRM."
              : "Gere as mensalidades do período contratado."}
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setDraftId(crypto.randomUUID())}>
          <Plus /> {isQuote ? "Novo orçamento" : "Novo contrato"}
        </Button>
      </div>

      {isQuote && own.length > 0 && (
        <dl className="grid grid-cols-3 divide-x rounded-lg border bg-muted/30">
          {[
            ["Aguardando resposta", String(waiting.length)],
            ["Aprovados", String(approved.length)],
            ["Em negociação", currency(waiting.reduce((sum, item) => sum + item.amount_cents, 0))],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 px-3 py-2.5 sm:px-4">
              <dt className="truncate text-xs text-muted-foreground">{label}</dt>
              <dd className="truncate text-base font-semibold tabular-nums sm:text-lg">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Buscar orçamento ou contrato"
          className="pl-9"
          placeholder="Buscar por descrição ou cliente"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {!filtered.length && (
        <div className="grid place-items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
          <p className="max-w-sm text-sm text-muted-foreground">
            {own.length
              ? "Nenhum resultado para essa busca."
              : isQuote
                ? "Nenhum orçamento ainda. Ao criar o primeiro, a proposta em PDF fica pronta e o lead entra em Novos Leads no CRM."
                : "Nenhum contrato recorrente cadastrado."}
          </p>
          {!own.length && (
            <Button variant="outline" onClick={() => setDraftId(crypto.randomUUID())}>
              <Plus /> {isQuote ? "Criar orçamento" : "Criar contrato"}
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {filtered.map((item) => {
          const status = statuses[item.status];
          return (
            <article
              className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card"
              key={item.id}
            >
              <div aria-hidden className="h-1 bg-[#ddbc70]" />
              <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {isQuote && (
                      <p className="text-xs text-muted-foreground">
                        Proposta nº{" "}
                        {proposalNumber(item.id, item.created_at?.slice(0, 10) ?? isoToday())}
                      </p>
                    )}
                    <h3 className="mt-0.5 break-words text-base font-semibold leading-snug">
                      {item.description}
                    </h3>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {nameOf(item)}
                      {!item.client_id && savedParty(item) && (
                        <span className="ml-2 rounded-full border px-1.5 py-px text-[10px]">
                          Sem cadastro
                        </span>
                      )}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
                      status.className,
                    )}
                  >
                    {status.label}
                  </span>
                </div>
                <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                  <p className="text-2xl font-semibold tabular-nums tracking-tight text-primary">
                    {currency(item.amount_cents)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {isQuote
                      ? item.periods === 1
                        ? `À vista em ${displayDate(item.first_due)}`
                        : `${item.periods} parcelas a partir de ${displayDate(item.first_due)}`
                      : `por mês, ${item.periods} meses desde ${displayDate(item.first_due)}`}
                  </p>
                </div>
                {item.notes && (
                  <p className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {item.notes}
                  </p>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
                  {isQuote && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={downloading === item.id}
                      onClick={() => void pdf(item)}
                    >
                      <FileDown /> {downloading === item.id ? "Gerando…" : "Baixar PDF"}
                    </Button>
                  )}
                  {isQuote && item.status === "draft" && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          prepare(item, "approve", "Registrar que o cliente aceitou esta proposta.")
                        }
                      >
                        Aprovar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          prepare(item, "reject", "Registrar que o cliente recusou esta proposta.")
                        }
                      >
                        Recusar
                      </Button>
                    </>
                  )}
                  {isQuote && item.status === "approved" && !item.client_id && (
                    <Button size="sm" onClick={() => setLinking(item)}>
                      <UserPlus /> Cadastrar cliente
                    </Button>
                  )}
                  {!item.generated_at &&
                    (item.status === "approved" || kind === "recurring") &&
                    item.status !== "closed" &&
                    (item.client_id || !isQuote) && (
                      <Button
                        size="sm"
                        onClick={() =>
                          prepare(
                            item,
                            "generate",
                            isQuote
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
                      size="sm"
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
                  {isQuote && item.crm_opportunity_id && (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <KanbanSquare className="h-3.5 w-3.5" /> Lead no CRM
                    </span>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {draftId &&
        (isQuote ? (
          <QuoteEditor id={draftId} close={() => setDraftId(null)} refresh={refresh} />
        ) : (
          <AgreementEditor id={draftId} close={() => setDraftId(null)} refresh={refresh} />
        ))}
      {action && (
        <FinanceActionDialog action={action} close={() => setAction(null)} refresh={refresh} />
      )}
      {linking && (
        <LinkClientDialog item={linking} close={() => setLinking(null)} refresh={refresh} />
      )}
    </Card>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold text-primary">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function ClientProcessFields({
  clientId,
  processId,
  setClientId,
  setProcessId,
}: {
  clientId: string;
  processId: string;
  setClientId: (value: string) => void;
  setProcessId: (value: string) => void;
}) {
  const { data: clients = [] } = useClients();
  const { data: tasks = [] } = useTasks();
  return (
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
    </div>
  );
}

function QuoteEditor({
  id,
  close,
  refresh,
}: {
  id: string;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const { activeWorkspace } = useAuth();
  const { data: clients = [] } = useClients();
  const { data: tasks = [] } = useTasks();
  const [clientMode, setClientMode] = useState<"registered" | "new">("registered");
  const [clientId, setClientId] = useState("");
  const [processId, setProcessId] = useState("");
  const [practice, setPractice] = useState<ProposalPractice>("contencioso");
  const [scope, setScope] = useState(defaultScope.contencioso.join("\n"));
  const [scopeEdited, setScopeEdited] = useState(false);
  const [exclusions, setExclusions] = useState(defaultExclusions.join("\n"));
  const [feeModel, setFeeModel] = useState<ProposalFeeModel>("fixed");
  const client = clients.find((item) => item.id === clientId);

  const mutation = useMutation({
    mutationFn: async (form: FormData) => {
      const value = (name: string) => String(form.get(name) ?? "").trim();
      const amount = financeCents(value("amount"));
      const periods = Number(value("periods"));
      if (!amount || amount < periods) throw new Error("Confira o valor e as parcelas.");
      const scopeItems = proposalLines(scope);
      if (!scopeItems.length) throw new Error("Descreva ao menos uma atividade no escopo.");
      const success =
        feeModel === "fixed_success" ? Number(value("success").replace(",", ".")) : null;
      if (success !== null && !(success > 0 && success <= 50))
        throw new Error("Informe o percentual de êxito entre 0,1% e 50%.");
      const issued = isoToday();
      const proposal: ProposalDocument = {
        version: 1,
        number: proposalNumber(id, issued),
        issued_on: issued,
        validity_days: Math.min(Math.max(Number(value("validity")) || 15, 1), 180),
        title: value("description"),
        area: value("area"),
        practice,
        process_title: tasks.find((task) => task.id === processId)?.title ?? null,
        context: value("context") || null,
        scope: scopeItems,
        exclusions: proposalLines(exclusions),
        fee_model: feeModel,
        amount_cents: amount,
        periods,
        first_due: value("due"),
        payment_method: value("payment") as ProposalPayment,
        success_percent: success,
        notes: value("notes") || null,
        client:
          clientMode === "new"
            ? {
                name: value("prospect_name"),
                document: value("prospect_document") || null,
                address: value("prospect_address") || null,
                email: value("contact_email") || null,
                phone: value("contact_phone") || null,
              }
            : proposalParty(client),
        contact_email: value("contact_email") || null,
        contact_phone: value("contact_phone") || null,
      };
      await financeRpc("office_finance_save_agreement", {
        target: id,
        agreement_kind: "quote",
        data: {
          description: proposal.title,
          client_id: clientMode === "new" ? "" : clientId,
          process_id: clientMode === "new" ? "" : processId,
          amount_cents: amount,
          periods,
          first_due: proposal.first_due,
          competence_date: value("competence"),
          category: value("category"),
          cost_center: value("cost_center"),
          notes: proposal.notes ?? "",
          workspace_id: activeWorkspace?.id ?? "",
          proposal,
        },
      });
      return proposal;
    },
    onSuccess: async (proposal) => {
      await refresh();
      close();
      toast.success("Orçamento criado e enviado para Novos Leads no CRM.", {
        action: { label: "Baixar PDF", onClick: () => void downloadProposal(proposal) },
      });
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
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo orçamento</DialogTitle>
          <DialogDescription>
            Os campos abaixo formam a proposta de honorários em PDF. Ao salvar, o cliente entra como
            lead em Novos Leads no CRM.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!mutation.isPending) mutation.mutate(new FormData(event.currentTarget));
          }}
        >
          <Section title="Cliente e objeto">
            <div
              role="radiogroup"
              aria-label="Cliente da proposta"
              className="grid h-10 grid-cols-2 rounded-md border p-0.5 sm:max-w-sm"
            >
              {(
                [
                  ["registered", "Cliente cadastrado"],
                  ["new", "Novo cliente"],
                ] as const
              ).map(([option, label]) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={clientMode === option}
                  className={cn(
                    "rounded-[5px] text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    clientMode === option
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => {
                    setClientMode(option);
                    setClientId("");
                    setProcessId("");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {clientMode === "registered" ? (
              <ClientProcessFields
                clientId={clientId}
                processId={processId}
                setClientId={setClientId}
                setProcessId={setProcessId}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={cn(fieldClass, "sm:col-span-2")}>
                  Nome ou razão social
                  <Input name="prospect_name" required maxLength={180} />
                </label>
                <label className={fieldClass}>
                  <span>
                    CPF ou CNPJ{" "}
                    <span className="font-normal text-muted-foreground">(opcional)</span>
                  </span>
                  <Input name="prospect_document" maxLength={20} inputMode="numeric" />
                </label>
                <label className={fieldClass}>
                  <span>
                    Endereço <span className="font-normal text-muted-foreground">(opcional)</span>
                  </span>
                  <Input name="prospect_address" maxLength={300} />
                </label>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  O cadastro não é criado agora. Se a proposta for aprovada, você cadastra o cliente
                  com esses dados antes de gerar o financeiro.
                </p>
              </div>
            )}
            <label className={fieldClass}>
              Objeto da proposta
              <Input
                name="description"
                required
                maxLength={180}
                placeholder="Ex.: Ação revisional de contrato bancário"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldClass}>
                Área do direito
                <select name="area" className={selectClass} defaultValue="Cível">
                  {proposalAreas.map((area) => (
                    <option key={area}>{area}</option>
                  ))}
                </select>
              </label>
              <div className={fieldClass}>
                <span id="quote-practice">Tipo de atuação</span>
                <div
                  role="radiogroup"
                  aria-labelledby="quote-practice"
                  className="grid h-10 grid-cols-2 rounded-md border p-0.5"
                >
                  {(["contencioso", "consultivo"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={practice === option}
                      className={cn(
                        "rounded-[5px] text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        practice === option
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => {
                        setPractice(option);
                        if (!scopeEdited) setScope(defaultScope[option].join("\n"));
                      }}
                    >
                      {option === "contencioso" ? "Contencioso" : "Consultivo"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <label className={fieldClass}>
              <span>
                Contexto do caso{" "}
                <span className="font-normal text-muted-foreground">(opcional)</span>
              </span>
              <Textarea
                name="context"
                rows={2}
                maxLength={1500}
                placeholder="Resumo do que o cliente relatou e do objetivo pretendido"
              />
            </label>
          </Section>

          <Section
            title="Escopo"
            hint="Uma atividade por linha. Os itens aparecem como lista no PDF."
          >
            <label className={fieldClass}>
              O que está incluído
              <Textarea
                rows={6}
                value={scope}
                onChange={(event) => {
                  setScope(event.target.value);
                  setScopeEdited(true);
                }}
              />
            </label>
            <label className={fieldClass}>
              O que não está incluído
              <Textarea
                rows={5}
                value={exclusions}
                onChange={(event) => setExclusions(event.target.value)}
              />
            </label>
          </Section>

          <Section title="Honorários e pagamento">
            <div
              role="radiogroup"
              aria-label="Modalidade de honorários"
              className="grid gap-2 sm:grid-cols-2"
            >
              {(
                [
                  ["fixed", "Valor fixo", "Honorários definidos, à vista ou parcelados."],
                  [
                    "fixed_success",
                    "Fixo + êxito",
                    "Valor inicial mais percentual sobre o resultado.",
                  ],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={feeModel === value}
                  onClick={() => setFeeModel(value)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    feeModel === value
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "hover:bg-muted/50",
                  )}
                >
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={fieldClass}>
                {feeModel === "fixed_success" ? "Valor inicial em R$" : "Valor total em R$"}
                <Input name="amount" required inputMode="decimal" placeholder="0,00" />
              </label>
              <label className={fieldClass}>
                Parcelas
                <Input name="periods" type="number" required min={1} max={120} defaultValue={1} />
              </label>
              <label className={fieldClass}>
                Primeiro vencimento
                <Input name="due" type="date" required defaultValue={isoToday()} />
              </label>
              {feeModel === "fixed_success" && (
                <label className={fieldClass}>
                  Êxito em %
                  <Input name="success" required inputMode="decimal" placeholder="Ex.: 20" />
                </label>
              )}
              <label className={fieldClass}>
                Forma de pagamento
                <select name="payment" className={selectClass} defaultValue="pix">
                  {Object.entries(proposalPayments).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Section>

          <Section title="Validade e contato">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={fieldClass}>
                Validade em dias
                <Input name="validity" type="number" min={1} max={180} defaultValue={15} />
              </label>
              <label className={fieldClass}>
                E-mail do contato
                <Input
                  key={`email-${clientId}`}
                  name="contact_email"
                  type="email"
                  defaultValue={client?.email ?? ""}
                />
              </label>
              <label className={fieldClass}>
                Telefone do contato
                <Input
                  key={`phone-${clientId}`}
                  name="contact_phone"
                  type="tel"
                  defaultValue={client?.phone ?? ""}
                />
              </label>
            </div>
            <label className={fieldClass}>
              <span>
                Condições adicionais{" "}
                <span className="font-normal text-muted-foreground">(opcional)</span>
              </span>
              <Textarea name="notes" rows={2} maxLength={2000} />
            </label>
            <details className="rounded-lg border px-3 py-2 text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Classificação financeira
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className={fieldClass}>
                  Categoria
                  <Input name="category" required maxLength={100} defaultValue="Honorários" />
                </label>
                <label className={fieldClass}>
                  Competência
                  <Input name="competence" type="date" required defaultValue={isoToday()} />
                </label>
                <label className={fieldClass}>
                  Centro de custo
                  <Input name="cost_center" maxLength={160} />
                </label>
              </div>
            </details>
          </Section>

          <div className="sticky -bottom-6 -mx-6 -mb-6 flex justify-end gap-2 border-t bg-background px-6 py-3">
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={close}>
              Cancelar
            </Button>
            <Button disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando…" : "Salvar orçamento"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AgreementEditor({
  id,
  close,
  refresh,
}: {
  id: string;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [clientId, setClientId] = useState("");
  const [processId, setProcessId] = useState("");
  const mutation = useMutation({
    mutationFn: async (form: FormData) => {
      const value = (name: string) => String(form.get(name) ?? "").trim();
      const amount = financeCents(value("amount"));
      const periods = Number(value("periods"));
      if (!amount) throw new Error("Confira o valor e as parcelas.");
      await financeRpc("office_finance_save_agreement", {
        target: id,
        agreement_kind: "recurring",
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
          <DialogTitle>Novo contrato recorrente</DialogTitle>
          <DialogDescription>
            Informe a mensalidade e quantos meses serão cobrados.
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
          <ClientProcessFields
            clientId={clientId}
            processId={processId}
            setClientId={setClientId}
            setProcessId={setProcessId}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={fieldClass}>
              Mensalidade em R$
              <Input name="amount" required inputMode="decimal" placeholder="0,00" />
            </label>
            <label className={fieldClass}>
              Meses contratados
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

function LinkClientDialog({
  item,
  close,
  refresh,
}: {
  item: FinanceAgreement;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: clients = [] } = useClients();
  const party = savedParty(item);
  const [mode, setMode] = useState<"create" | "existing">("create");
  const [existing, setExisting] = useState("");
  const mutation = useMutation({
    mutationFn: async () => {
      let target = existing;
      if (mode === "create") {
        if (!party?.name) throw new Error("A proposta não tem o nome do contratante.");
        const { data, error } = await supabase
          .from("clients")
          .insert({
            name: party.name,
            cnpj: party.document || null,
            legal_name: party.name,
            address: party.address || null,
            email: party.email || null,
            phone: party.phone || null,
            created_by: user?.id,
          })
          .select("id")
          .single();
        if (error) throw error;
        target = data.id;
      }
      if (!target) throw new Error("Selecione o cliente.");
      await financeRpc("office_finance_link_agreement_client", { target: item.id, client: target });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      await refresh();
      close();
      toast.success("Cliente vinculado. Agora você pode gerar o financeiro.");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível vincular o cliente."),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cadastrar cliente</DialogTitle>
          <DialogDescription>
            Para gerar as parcelas, o orçamento “{item.description}” precisa de um cliente
            cadastrado. O lead do CRM também passa a apontar para ele.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex items-start gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary">
            <input
              type="radio"
              name="link-mode"
              className="mt-1 accent-[#591b20]"
              checked={mode === "create"}
              onChange={() => setMode("create")}
            />
            <span>
              <span className="block font-medium">Cadastrar com os dados da proposta</span>
              <span className="block text-muted-foreground">
                {[party?.name, party?.document, party?.email, party?.phone]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary">
            <input
              type="radio"
              name="link-mode"
              className="mt-1 accent-[#591b20]"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
            />
            <span className="block flex-1 space-y-2">
              <span className="block font-medium">Usar um cliente já cadastrado</span>
              {mode === "existing" && (
                <select
                  aria-label="Cliente cadastrado"
                  className={selectClass}
                  value={existing}
                  onChange={(event) => setExisting(event.target.value)}
                >
                  <option value="">Selecione</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              )}
            </span>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={mutation.isPending} onClick={close}>
            Cancelar
          </Button>
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending
              ? "Salvando…"
              : mode === "create"
                ? "Cadastrar e vincular"
                : "Vincular cliente"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
