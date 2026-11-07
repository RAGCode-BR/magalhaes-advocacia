import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  financeCents,
  financeOrderTotal,
  type FinanceService,
  type FinanceOrder,
  type FinanceOrderItem,
  type FinanceRegister,
} from "@/lib/office-finance";
import {
  currency,
  displayDate,
  fieldClass,
  selectClass,
  isoToday,
  financeRpc,
  loadFinanceOrders,
} from "@/lib/office-finance-data";
import { FinanceActionDialog, type FinanceAction } from "./FinanceActionDialog";

const statuses = {
  draft: "Rascunho",
  in_progress: "Em andamento",
  completed: "Concluído",
  cancelled: "Cancelado",
};
const decimal = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
function cents(value: string) {
  if (!/^\d+([.,]\d{1,2})?$/.test(value.trim()) || Number(value.replace(",", ".")) > 21474836.47)
    throw new Error("Informe valores em reais, com até duas casas decimais.");
  return financeCents(value);
}

type Props = {
  userId: string;
  section: "services" | "service" | "purchase";
  registers: FinanceRegister[];
  refresh: () => Promise<void>;
};
export function FinanceOrders({ userId, section, registers, refresh }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ["office-finance-orders", userId];
  const query = useQuery({ queryKey, queryFn: loadFinanceOrders, retry: 1 });
  const { data: clients = [] } = useClients();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [service, setService] = useState<FinanceService | null>(null);
  const [order, setOrder] = useState<FinanceOrder | null>(null);
  const [details, setDetails] = useState<FinanceOrder | null>(null);
  const [action, setAction] = useState<FinanceAction | null>(null);
  const title =
    section === "services"
      ? "Catálogo de serviços"
      : section === "service"
        ? "Ordens de serviço"
        : "Compras";
  const reload = async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey }), refresh()]);
  };
  const prepare = (item: FinanceOrder, operation: string) => {
    const descriptions: Record<string, [string, string]> = {
      start: [
        "Iniciar pedido",
        "O pedido passará para Em andamento e seus dados ficarão bloqueados para edição.",
      ],
      complete: [
        "Concluir pedido",
        "Registrar a conclusão. Depois, você poderá gerar os lançamentos financeiros.",
      ],
      generate: [
        "Gerar financeiro",
        `Criar ${item.installments} parcela(s) em ${item.kind === "service" ? "Contas a receber" : "Contas a pagar"}, totalizando ${currency(item.total_cents)}. Esta operação não realiza pagamentos nem emite notas fiscais.`,
      ],
      cancel: [
        "Cancelar pedido",
        "O pedido e as parcelas geradas serão cancelados. Se houver baixas, estorne-as antes. O histórico será preservado.",
      ],
    };
    setAction({
      title: descriptions[operation][0],
      explanation: descriptions[operation][1],
      needsReason: operation === "cancel",
      run: (reason) =>
        financeRpc("office_finance_order_action", {
          target: item.id,
          action: operation,
          reason: reason || null,
        }),
    });
  };
  const term = search.trim().toLocaleLowerCase("pt-BR");
  const services = (query.data?.services ?? [])
    .filter((item) =>
      `${item.name} ${item.description ?? ""}`.toLocaleLowerCase("pt-BR").includes(term),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const orders = (query.data?.orders ?? [])
    .filter(
      (item) =>
        item.kind === section &&
        (status === "all" || status === item.status) &&
        `${item.description} ${item.supplier ?? ""} ${clients.find((c) => c.id === item.client_id)?.name ?? ""} ${item.responsible ?? ""}`
          .toLocaleLowerCase("pt-BR")
          .includes(term),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">
            {section === "services"
              ? "Organize os serviços e seus preços de referência."
              : "Registre os itens, acompanhe a execução e gere as parcelas ao concluir."}
          </p>
        </div>
        <Button
          disabled={!query.data}
          onClick={() => {
            if (section === "services")
              setService({
                id: crypto.randomUUID(),
                name: "",
                description: "",
                price_cents: 0,
                active: true,
              });
            else
              setOrder({
                id: crypto.randomUUID(),
                kind: section,
                status: "draft",
                description: "",
                client_id: null,
                process_id: null,
                supplier: null,
                category: section === "service" ? "Honorários" : "Despesas",
                cost_center: null,
                notes: null,
                total_cents: 0,
                discount_cents: 0,
                installments: 1,
                competence_date: isoToday(),
                first_due: isoToday(),
                start_date: isoToday(),
                expected_date: isoToday(),
                responsible: null,
                generated_at: null,
                cancellation_reason: null,
                created_at: "",
              });
          }}
        >
          {section === "services"
            ? "Novo serviço"
            : section === "service"
              ? "Nova ordem de serviço"
              : "Nova compra"}
        </Button>
      </div>
      {query.isPending && <p role="status">Carregando serviços e pedidos…</p>}
      {query.isError && (
        <div className="space-y-2" role="alert">
          <p>
            Não foi possível carregar serviços e pedidos. Os demais dados do financeiro continuam
            disponíveis.
          </p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {query.data && (
        <>
          <div className="flex flex-wrap gap-3">
            <Input
              className="min-w-0 flex-1"
              aria-label="Buscar serviços ou pedidos"
              placeholder="Buscar por descrição, cliente ou fornecedor"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {section !== "services" && (
              <select
                className={`${selectClass} sm:w-48`}
                aria-label="Situação do pedido"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">Todas as situações</option>
                {Object.entries(statuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </div>
          {section === "services" ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {!services.length && (
                <p className="py-4 text-sm text-muted-foreground">Nenhum serviço encontrado.</p>
              )}
              {services.map((item) => (
                <article key={item.id} className="min-w-0 space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap justify-between gap-2">
                    <h3 className="break-words font-semibold">{item.name}</h3>
                    <span className="text-sm">{item.active ? "Ativo" : "Inativo"}</span>
                  </div>
                  <p className="text-lg font-semibold">{currency(item.price_cents)}</p>
                  {item.description && (
                    <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  )}
                  <Button variant="outline" onClick={() => setService(item)}>
                    Editar serviço
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {!orders.length && (
                <p className="py-4 text-sm text-muted-foreground">Nenhum pedido encontrado.</p>
              )}
              {orders.map((item) => (
                <article key={item.id} className="min-w-0 space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="break-words font-semibold">{item.description}</h3>
                    <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">
                      {statuses[item.status]}
                    </span>
                  </div>
                  <p className="text-sm">
                    {item.kind === "service"
                      ? (clients.find((c) => c.id === item.client_id)?.name ??
                        "Cliente indisponível")
                      : item.supplier}
                  </p>
                  <p className="font-semibold">
                    {currency(item.total_cents)}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      · {item.installments} parcela(s)
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Previsão {displayDate(item.expected_date)}
                    {item.responsible ? ` · ${item.responsible}` : ""}
                  </p>
                  {item.generated_at && (
                    <p className="text-sm font-medium text-primary">
                      {item.status === "cancelled" ? "Financeiro cancelado" : "Financeiro gerado"}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setDetails(item)}>
                      Detalhes
                    </Button>
                    {item.status === "draft" && !item.generated_at && (
                      <>
                        <Button variant="outline" onClick={() => setOrder(item)}>
                          Editar
                        </Button>
                        <Button onClick={() => prepare(item, "start")}>Iniciar</Button>
                      </>
                    )}
                    {item.status === "in_progress" && (
                      <Button onClick={() => prepare(item, "complete")}>Concluir</Button>
                    )}
                    {item.status === "completed" && !item.generated_at && (
                      <Button onClick={() => prepare(item, "generate")}>Gerar financeiro</Button>
                    )}
                    {item.status !== "cancelled" && (
                      <Button variant="outline" onClick={() => prepare(item, "cancel")}>
                        Cancelar pedido
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
      {service && (
        <ServiceEditor
          key={service.id}
          service={service}
          close={() => setService(null)}
          refresh={reload}
        />
      )}
      {order && (
        <OrderEditor
          key={order.id}
          order={order}
          items={(query.data?.items ?? []).filter((i) => i.order_id === order.id)}
          services={query.data?.services ?? []}
          registers={registers}
          close={() => setOrder(null)}
          refresh={reload}
        />
      )}
      {details && (
        <OrderDetails
          order={details}
          items={(query.data?.items ?? []).filter((i) => i.order_id === details.id)}
          close={() => setDetails(null)}
        />
      )}
      {action && (
        <FinanceActionDialog action={action} close={() => setAction(null)} refresh={reload} />
      )}
    </Card>
  );
}

function ServiceEditor({
  service,
  close,
  refresh,
}: {
  service: FinanceService;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const value = (name: string) => String(form.get(name) ?? "").trim();
      await financeRpc("office_finance_save_service", {
        target: service.id,
        data: {
          name: value("name"),
          description: value("description"),
          price_cents: cents(value("price")),
          active: form.get("active") === "on",
        },
      });
    },
    onSuccess: async () => {
      await refresh();
      close();
      toast.success("Serviço salvo.");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível salvar o serviço."),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{service.name ? "Editar serviço" : "Novo serviço"}</DialogTitle>
          <DialogDescription>
            O preço do catálogo pode ser ajustado em cada pedido. Alterações não mudam pedidos
            anteriores.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending) save.mutate(new FormData(e.currentTarget));
          }}
        >
          <label className={fieldClass}>
            Nome
            <Input name="name" required maxLength={160} defaultValue={service.name} />
          </label>
          <label className={fieldClass}>
            Descrição
            <Textarea
              name="description"
              maxLength={2000}
              defaultValue={service.description ?? ""}
            />
          </label>
          <label className={fieldClass}>
            Preço de referência em R$
            <Input
              name="price"
              required
              inputMode="decimal"
              defaultValue={decimal(service.price_cents)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={service.active} />
            Serviço ativo para novos pedidos
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={close}>
              Voltar
            </Button>
            <Button disabled={save.isPending}>
              {save.isPending ? "Salvando…" : "Salvar serviço"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ItemDraft = {
  key: string;
  service_id: string;
  description: string;
  quantity: string;
  price: string;
};
const blankItem = (): ItemDraft => ({
  key: crypto.randomUUID(),
  service_id: "",
  description: "",
  quantity: "1",
  price: "0,00",
});
function OrderEditor({
  order,
  items,
  services,
  registers,
  close,
  refresh,
}: {
  order: FinanceOrder;
  items: FinanceOrderItem[];
  services: FinanceService[];
  registers: FinanceRegister[];
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const { data: clients = [] } = useClients();
  const { data: tasks = [] } = useTasks();
  const [clientId, setClientId] = useState(order.client_id ?? "");
  const [processId, setProcessId] = useState(order.process_id ?? "");
  const [lines, setLines] = useState<ItemDraft[]>(
    items.length
      ? items.map((item) => ({
          key: item.id,
          service_id: item.service_id ?? "",
          description: item.description,
          quantity: String(item.quantity),
          price: decimal(item.unit_cents),
        }))
      : [blankItem()],
  );
  const [discount, setDiscount] = useState(decimal(order.discount_cents));
  const parsedItems = () =>
    lines.map((line) => ({
      service_id: line.service_id || null,
      description: line.description.trim(),
      quantity: Number(line.quantity),
      unit_cents: cents(line.price),
    }));
  let summary: ReturnType<typeof financeOrderTotal> | null = null;
  try {
    summary = financeOrderTotal(parsedItems(), cents(discount));
  } catch {
    /* Show an incomplete total until the amounts are valid. */
  }
  const updateLine = (key: string, update: Partial<ItemDraft>) =>
    setLines((rows) => rows.map((line) => (line.key === key ? { ...line, ...update } : line)));
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const value = (name: string) => String(form.get(name) ?? "").trim();
      const items = parsedItems();
      const total = financeOrderTotal(items, cents(discount));
      const installments = Number(value("installments"));
      if (
        !Number.isInteger(installments) ||
        installments < 1 ||
        installments > 120 ||
        installments > total.total
      )
        throw new Error("Informe de 1 a 120 parcelas com pelo menos R$ 0,01 cada.");
      if (value("expected_date") < value("start_date"))
        throw new Error("A previsão de entrega deve ser igual ou posterior ao início.");
      await financeRpc("office_finance_save_order", {
        target: order.id,
        order_kind: order.kind,
        data: {
          description: value("description"),
          client_id: clientId || null,
          process_id: processId || null,
          supplier: value("supplier") || null,
          category: value("category"),
          cost_center: value("cost_center"),
          notes: value("notes"),
          responsible: value("responsible"),
          start_date: value("start_date"),
          expected_date: value("expected_date"),
          first_due: value("first_due"),
          competence_date: value("competence_date"),
          installments,
          discount_cents: total.discount,
          total_cents: total.total,
          items,
        },
      });
    },
    onSuccess: async () => {
      await refresh();
      close();
      toast.success("Pedido salvo em rascunho.");
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível salvar o pedido."),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {order.created_at ? "Editar" : "Nova"}{" "}
            {order.kind === "service" ? "ordem de serviço" : "compra"}
          </DialogTitle>
          <DialogDescription>
            Salve o rascunho, inicie e conclua o pedido. O financeiro só será criado ao escolher
            Gerar financeiro.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending) save.mutate(new FormData(e.currentTarget));
          }}
        >
          <fieldset disabled={save.isPending} className="min-w-0 space-y-4">
            <label className={fieldClass}>
              Descrição do pedido
              <Input name="description" required maxLength={200} defaultValue={order.description} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldClass}>
                Cliente{order.kind === "purchase" ? " (opcional)" : ""}
                <select
                  className={selectClass}
                  required={order.kind === "service"}
                  value={clientId}
                  onChange={(e) => {
                    setClientId(e.target.value);
                    setProcessId("");
                  }}
                >
                  <option value="">Selecione</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
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
                  onChange={(e) => setProcessId(e.target.value)}
                >
                  <option value="">Sem processo vinculado</option>
                  {tasks
                    .filter((t) => t.client_id === clientId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </label>
              {order.kind === "purchase" && (
                <label className={fieldClass}>
                  Fornecedor
                  <Input
                    name="supplier"
                    required
                    maxLength={160}
                    list="order-suppliers"
                    defaultValue={order.supplier ?? ""}
                  />
                  <datalist id="order-suppliers">
                    {registers
                      .filter((r) => r.kind === "supplier" && r.active)
                      .map((r) => (
                        <option key={r.id} value={r.name} />
                      ))}
                  </datalist>
                </label>
              )}
              <label className={fieldClass}>
                Responsável
                <Input name="responsible" maxLength={160} defaultValue={order.responsible ?? ""} />
              </label>
              <label className={fieldClass}>
                Data de início
                <Input type="date" name="start_date" required defaultValue={order.start_date} />
              </label>
              <label className={fieldClass}>
                Previsão de entrega
                <Input
                  type="date"
                  name="expected_date"
                  required
                  defaultValue={order.expected_date}
                />
              </label>
            </div>
            <section className="space-y-3" aria-label="Itens do pedido">
              <h3 className="font-semibold">Itens</h3>
              {lines.map((line, index) => (
                <div key={line.key} className="min-w-0 space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">Item {index + 1}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={lines.length === 1}
                      onClick={() => setLines((rows) => rows.filter((row) => row.key !== line.key))}
                      aria-label={`Remover item ${index + 1}`}
                    >
                      Remover
                    </Button>
                  </div>
                  {order.kind === "service" && (
                    <label className={fieldClass}>
                      Serviço do catálogo
                      <select
                        className={selectClass}
                        value={line.service_id}
                        onChange={(e) => {
                          const item = services.find((s) => s.id === e.target.value);
                          updateLine(
                            line.key,
                            item
                              ? {
                                  service_id: item.id,
                                  description: item.name,
                                  price: decimal(item.price_cents),
                                }
                              : { service_id: "" },
                          );
                        }}
                      >
                        <option value="">Informar manualmente</option>
                        {services
                          .filter((s) => s.active || s.id === line.service_id)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                              {s.active ? "" : " (inativo)"}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <label className={fieldClass}>
                    Descrição do item
                    <Input
                      required
                      maxLength={200}
                      value={line.description}
                      onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className={fieldClass}>
                      Quantidade
                      <Input
                        required
                        type="number"
                        min={1}
                        max={10000}
                        step={1}
                        value={line.quantity}
                        onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      />
                    </label>
                    <label className={fieldClass}>
                      Preço unitário em R$
                      <Input
                        required
                        inputMode="decimal"
                        value={line.price}
                        onChange={(e) => updateLine(line.key, { price: e.target.value })}
                      />
                    </label>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={lines.length >= 200}
                onClick={() => setLines((rows) => [...rows, blankItem()])}
              >
                Adicionar item
              </Button>
            </section>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldClass}>
                Desconto em R$
                <Input
                  required
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </label>
              <label className={fieldClass}>
                Parcelas
                <Input
                  name="installments"
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  required
                  defaultValue={order.installments}
                />
              </label>
              <label className={fieldClass}>
                Primeiro vencimento
                <Input name="first_due" type="date" required defaultValue={order.first_due} />
              </label>
              <label className={fieldClass}>
                Competência
                <Input
                  name="competence_date"
                  type="date"
                  required
                  defaultValue={order.competence_date}
                />
              </label>
              <label className={fieldClass}>
                Categoria
                <Input
                  name="category"
                  required
                  maxLength={100}
                  defaultValue={order.category}
                  list="order-categories"
                />
                <datalist id="order-categories">
                  {registers
                    .filter((r) => r.kind === "category" && r.active)
                    .map((r) => (
                      <option key={r.id} value={r.name} />
                    ))}
                </datalist>
              </label>
              <label className={fieldClass}>
                Centro de custo
                <Input
                  name="cost_center"
                  maxLength={160}
                  defaultValue={order.cost_center ?? ""}
                  list="order-cost-centers"
                />
                <datalist id="order-cost-centers">
                  {registers
                    .filter((r) => r.kind === "cost_center" && r.active)
                    .map((r) => (
                      <option key={r.id} value={r.name} />
                    ))}
                </datalist>
              </label>
            </div>
            <label className={fieldClass}>
              Descrição do serviço e observações internas
              <Textarea name="notes" maxLength={4000} defaultValue={order.notes ?? ""} />
            </label>
            <p className="rounded-lg bg-muted p-3 font-semibold" aria-live="polite">
              {summary
                ? `Subtotal ${currency(summary.gross)} · Desconto ${currency(summary.discount)} · Total ${currency(summary.total)}`
                : "Preencha os itens e o desconto para calcular o total."}
            </p>
          </fieldset>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={close}>
              Voltar
            </Button>
            <Button disabled={save.isPending || !summary}>
              {save.isPending ? "Salvando…" : "Salvar rascunho"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OrderDetails({
  order,
  items,
  close,
}: {
  order: FinanceOrder;
  items: FinanceOrderItem[];
  close: () => void;
}) {
  const { data: clients = [] } = useClients();
  const { data: tasks = [] } = useTasks();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="break-words">{order.description}</DialogTitle>
          <DialogDescription>
            {statuses[order.status]} · {order.kind === "service" ? "Ordem de serviço" : "Compra"}
          </DialogDescription>
        </DialogHeader>
        <dl className="grid gap-2 text-sm">
          <dt className="font-semibold">Cliente / fornecedor</dt>
          <dd>
            {order.kind === "service"
              ? (clients.find((c) => c.id === order.client_id)?.name ?? "Cliente indisponível")
              : order.supplier}
          </dd>
          {order.process_id && (
            <>
              <dt className="font-semibold">Processo</dt>
              <dd>
                {tasks.find((t) => t.id === order.process_id)?.title ?? "Processo indisponível"}
              </dd>
            </>
          )}
          <dt className="font-semibold">Prazo e responsável</dt>
          <dd>
            {displayDate(order.start_date)} a {displayDate(order.expected_date)} ·{" "}
            {order.responsible || "Sem responsável"}
          </dd>
          <dt className="font-semibold">Classificação</dt>
          <dd>
            {order.category} · {order.cost_center || "Sem centro de custo"}
          </dd>
        </dl>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="break-words rounded border p-3 text-sm">
              <p>{item.description}</p>
              <p className="mt-1 text-muted-foreground">
                {item.quantity} × {currency(item.unit_cents)} ={" "}
                {currency(item.quantity * item.unit_cents)}
              </p>
            </li>
          ))}
        </ul>
        <p className="text-sm">Desconto {currency(order.discount_cents)}</p>
        <p className="font-semibold">
          Total {currency(order.total_cents)} · {order.installments} parcela(s)
        </p>
        <p className="text-sm">
          Primeiro vencimento {displayDate(order.first_due)} · Competência{" "}
          {displayDate(order.competence_date)}
        </p>
        {order.notes && <p className="whitespace-pre-wrap break-words text-sm">{order.notes}</p>}
        {order.cancellation_reason && (
          <p className="break-words text-sm">Motivo do cancelamento: {order.cancellation_reason}</p>
        )}
        {order.generated_at && (
          <p className="text-sm font-medium text-primary">
            {order.status === "cancelled"
              ? "Parcelas financeiras canceladas"
              : "Parcelas disponíveis em Lançamentos"}
          </p>
        )}
        <Button variant="outline" onClick={close}>
          Fechar
        </Button>
      </DialogContent>
    </Dialog>
  );
}
