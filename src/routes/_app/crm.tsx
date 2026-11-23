import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronLeft,
  Eye,
  ChevronRight,
  FileDown,
  FileText,
  GripVertical,
  KanbanSquare,
  Lock,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { CrmReport } from "@/components/crm/CrmReport";
import { FinanceAgreements } from "@/components/finance/FinanceAgreements";
import type { FinanceAgreement } from "@/lib/office-finance";
import { financeRows, financeRpc } from "@/lib/office-finance-data";
import {
  FINAL_STAGE,
  newStageId,
  nextStagePosition,
  orderStages,
  type CrmStage,
} from "@/lib/crm-stages";
import { ProposalPdfViewer } from "@/components/finance/ProposalPdfViewer";
import { useAuth } from "@/hooks/use-auth";
import { useClients } from "@/hooks/use-data";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  proposalPayments,
  proposalValidUntil,
  type ProposalDocument,
} from "@/lib/finance-proposal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_app/crm")({ component: CrmPage });

type Opportunity = Database["public"]["Tables"]["crm_opportunities"]["Row"];
type StageSetting = Database["public"]["Tables"]["crm_pipeline_stages"]["Row"];
const EMPTY_OPPORTUNITIES: Opportunity[] = [];
type Stage = string;
// Leads criados por um orçamento do financeiro trazem a proposta completa.
function leadProposal(lead: Opportunity | null): ProposalDocument | null {
  const doc = lead?.proposal as Partial<ProposalDocument> | null | undefined;
  return doc && doc.version === 1 && Array.isArray(doc.scope) ? (doc as ProposalDocument) : null;
}
const brDate = (iso: string) => iso.split("-").reverse().join("/");
async function downloadLeadProposal(doc: ProposalDocument) {
  try {
    const { downloadProposalPdf } = await import("@/lib/finance-proposal-pdf");
    await downloadProposalPdf(doc);
  } catch (error) {
    toast.error((error as Error).message || "Não foi possível gerar o PDF.");
  }
}

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function CrmPage() {
  const { activeWorkspace, hasPermission, isClient, isAdmin, user } = useAuth();
  const clients = useClients();
  const queryClient = useQueryClient();
  const workspaceId = activeWorkspace?.id;
  const queryKey = ["crm-opportunities", workspaceId];
  const stagesQueryKey = ["crm-pipeline-stages", workspaceId];
  const [tab, setTab] = useState<"pipeline" | "origins" | "report">("pipeline");
  const [search, setSearch] = useState("");
  // Lead aberto no painel da proposta (por id, para fechar sozinho se o lead sair do CRM).
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  // "new" abre o editor para criar uma coluna.
  const [editingStage, setEditingStage] = useState<Stage | "new" | null>(null);
  const [stageForm, setStageForm] = useState({ label: "", color: "#3278d4" });
  const [deletingStage, setDeletingStage] = useState<CrmStage | null>(null);
  const [moveTo, setMoveTo] = useState("");

  const opportunities = useQuery({
    queryKey,
    enabled: !!workspaceId && hasPermission("crm") && !isClient,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_opportunities")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Opportunity[];
    },
  });

  const stageSettings = useQuery({
    queryKey: stagesQueryKey,
    enabled: !!workspaceId && hasPermission("crm") && !isClient,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_pipeline_stages")
        .select("*")
        .eq("workspace_id", workspaceId!);
      if (error) throw error;
      return (data ?? []) as StageSetting[];
    },
  });
  const stages = useMemo(() => orderStages(stageSettings.data ?? []), [stageSettings.data]);
  const openStages = stages.filter((stage) => !stage.fixed);
  const [draggingStage, setDraggingStage] = useState<Stage | null>(null);

  // Saves the order of the regular columns; the fixed closing column stays last.
  const reorderStages = useMutation({
    mutationFn: async (order: Stage[]) => {
      if (!workspaceId) throw new Error("Ambiente indisponível.");
      const rows = order.map((id, position) => {
        const stage = stages.find((item) => item.id === id)!;
        return {
          workspace_id: workspaceId,
          stage_id: id,
          label: stage.label,
          color: stage.color,
          position,
        };
      });
      const { error } = await supabase
        .from("crm_pipeline_stages")
        .upsert(rows, { onConflict: "workspace_id,stage_id" });
      if (error) throw error;
    },
    onMutate: async (order) => {
      await queryClient.cancelQueries({ queryKey: stagesQueryKey });
      const previous = queryClient.getQueryData<StageSetting[]>(stagesQueryKey);
      const fixed = previous?.filter((item) => item.stage_id === FINAL_STAGE) ?? [];
      queryClient.setQueryData<StageSetting[]>(stagesQueryKey, () => [
        ...fixed,
        ...order.map((id, position) => {
          const stage = stages.find((item) => item.id === id)!;
          const saved = previous?.find((item) => item.stage_id === id);
          return {
            workspace_id: workspaceId!,
            stage_id: id,
            label: stage.label,
            color: stage.color,
            position,
            updated_at: saved?.updated_at ?? new Date().toISOString(),
          };
        }),
      ]);
      return { previous };
    },
    onError: (error, _order, context) => {
      queryClient.setQueryData(stagesQueryKey, context?.previous);
      toast.error(`Não foi possível reordenar as colunas: ${error.message}`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: stagesQueryKey }),
  });
  function placeStage(id: Stage, targetIndex: number) {
    if (id === FINAL_STAGE) return;
    const order = openStages.map((stage) => stage.id).filter((stageId) => stageId !== id);
    const index = Math.max(0, Math.min(targetIndex, order.length));
    order.splice(index, 0, id);
    if (order.some((stageId, i) => stageId !== openStages[i].id)) reorderStages.mutate(order);
  }

  const saveStage = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !editingStage) throw new Error("Coluna indisponível.");
      const label = stageForm.label.trim();
      if (!label || label.length > 60) throw new Error("O título deve ter de 1 a 60 caracteres.");
      if (!/^#[0-9a-fA-F]{6}$/.test(stageForm.color)) throw new Error("Escolha uma cor válida.");
      const { error } =
        editingStage === "new"
          ? await supabase.from("crm_pipeline_stages").insert({
              workspace_id: workspaceId,
              stage_id: newStageId(),
              label,
              color: stageForm.color,
              position: nextStagePosition(stages),
            })
          : await supabase
              .from("crm_pipeline_stages")
              .update({ label, color: stageForm.color })
              .eq("workspace_id", workspaceId)
              .eq("stage_id", editingStage);
      if (error) throw error;
      return editingStage === "new";
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: stagesQueryKey });
      setEditingStage(null);
      toast.success(created ? "Coluna criada." : "Coluna atualizada.");
    },
    onError: (error) => toast.error(`Não foi possível atualizar a coluna: ${error.message}`),
  });

  const move = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: Stage }) => {
      if (!workspaceId) throw new Error("Ambiente indisponível.");
      const { data, error } = await supabase
        .from("crm_opportunities")
        .update({ stage })
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error) => toast.error(`Não foi possível mover o lead: ${error.message}`),
  });
  const deleteStage = useMutation({
    mutationFn: async ({ stage, target }: { stage: CrmStage; target: string }) => {
      if (!workspaceId) throw new Error("Ambiente indisponível.");
      await financeRpc("crm_delete_stage", {
        target_workspace: workspaceId,
        target_stage: stage.id,
        move_to: target,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stagesQueryKey });
      queryClient.invalidateQueries({ queryKey });
      setDeletingStage(null);
      setEditingStage(null);
      toast.success("Coluna excluída.");
    },
    onError: (error) => toast.error(`Não foi possível excluir a coluna: ${error.message}`),
  });

  const all: Opportunity[] = opportunities.data ?? EMPTY_OPPORTUNITIES;
  const editing = all.find((lead) => lead.id === openLeadId) ?? null;
  // Administradores veem a proposta completa, com os mesmos botões de Propostas.
  const agreements = useQuery({
    queryKey: ["office-finance", user?.id, "quotes"],
    enabled: !!user && isAdmin && !isClient,
    queryFn: () => financeRows<FinanceAgreement>("office_finance_agreements"),
  });
  const editingAgreement = editing?.finance_agreement_id
    ? agreements.data?.find((item) => item.id === editing.finance_agreement_id)
    : undefined;
  const refreshProposal = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["office-finance"] }),
      queryClient.invalidateQueries({ queryKey }),
    ]);
  };
  const clientNames = useMemo(
    () => new Map((clients.data ?? []).map((client) => [client.id, client.name])),
    [clients.data],
  );
  const filtered = useMemo(() => {
    const term = normalize(search.trim());
    return !term
      ? all
      : all.filter((lead) =>
          normalize(
            [
              lead.title,
              (lead.client_id && clientNames.get(lead.client_id)) || lead.company_name,
              lead.contact_email,
              lead.contact_phone,
            ]
              .filter(Boolean)
              .join(" "),
          ).includes(term),
        );
  }, [all, search, clientNames]);
  const activeValue = all
    .filter((lead) => lead.stage !== FINAL_STAGE)
    .reduce((sum, lead) => sum + (lead.amount ?? 0), 0);
  const finalized = all.filter((lead) => lead.stage === FINAL_STAGE).length;
  const completion = all.length ? Math.round((finalized / all.length) * 100) : 0;
  const origins = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of filtered)
      counts.set(
        lead.source?.trim() || "Não informada",
        (counts.get(lead.source?.trim() || "Não informada") ?? 0) + 1,
      );
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  function openEdit(lead: Opportunity) {
    setOpenLeadId(lead.id);
  }
  function openStageEditor(stage: CrmStage) {
    setStageForm({ label: stage.label, color: stage.color });
    setEditingStage(stage.id);
  }
  function openNewStage() {
    setStageForm({ label: "", color: "#3278d4" });
    setEditingStage("new");
  }
  function askDeleteStage(stage: CrmStage) {
    setMoveTo(openStages.find((item) => item.id !== stage.id)?.id ?? "");
    setDeletingStage(stage);
  }

  if (isClient || !hasPermission("crm")) return <Navigate to="/dashboard" replace />;
  return (
    <div className="flex min-h-full flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">CRM</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Acompanhe seus leads e negociações em {activeWorkspace?.name ?? "seu ambiente"}.
          </p>
        </div>
        {isAdmin && (
          <Button asChild className="gap-2">
            <Link to="/orcamentos">
              <Plus className="h-4 w-4" /> Nova proposta
            </Link>
          </Button>
        )}
      </header>
      <div className="flex gap-5 border-b text-sm font-medium">
        <button
          type="button"
          onClick={() => setTab("pipeline")}
          className={`flex items-center gap-2 border-b-2 px-1 pb-3 ${tab === "pipeline" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          <KanbanSquare className="h-4 w-4" /> Pipeline
        </button>
        <button
          type="button"
          onClick={() => setTab("origins")}
          className={`flex items-center gap-2 border-b-2 px-1 pb-3 ${tab === "origins" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          <MapPin className="h-4 w-4" /> Origem de Leads
        </button>
        <button
          type="button"
          onClick={() => setTab("report")}
          className={`flex items-center gap-2 border-b-2 px-1 pb-3 ${tab === "report" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
        >
          <BarChart3 className="h-4 w-4" /> Relatório
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-lg border bg-card px-3 py-2">
            Total Leads: <strong>{all.length}</strong>
          </span>
          <span className="rounded-lg border bg-card px-3 py-2">
            Pipeline: <strong>{money(activeValue)}</strong>
          </span>
          <span className="rounded-lg border bg-card px-3 py-2">
            {stages.find((stage) => stage.id === FINAL_STAGE)?.label ?? "Contrato fechado"}:{" "}
            <strong>{completion}%</strong>
          </span>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar leads"
            className="pl-9"
            placeholder="Buscar nome, e-mail, telefone…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {tab === "pipeline" && (
        <p className="text-xs text-muted-foreground sm:hidden">
          Deslize para os lados para ver as etapas do funil.
        </p>
      )}
      {opportunities.isLoading || stageSettings.isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Carregando leads…</p>
      ) : opportunities.isError || stageSettings.isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
          Não foi possível carregar o CRM:{" "}
          {opportunities.error?.message ?? stageSettings.error?.message}
          <Button
            variant="outline"
            size="sm"
            className="ml-3"
            onClick={() => {
              opportunities.refetch();
              stageSettings.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </div>
      ) : tab === "pipeline" ? (
        <div
          className="flex min-h-[55vh] w-full min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-4 sm:snap-none"
          aria-label="Funil de oportunidades"
        >
          {stages.map((stage) => {
            const leads = filtered.filter((lead) => lead.stage === stage.id);
            const value = leads.reduce((sum, lead) => sum + (lead.amount ?? 0), 0);
            return (
              <Fragment key={stage.id}>
                {stage.fixed && (
                  <button
                    type="button"
                    onClick={openNewStage}
                    className="flex w-[min(180px,calc(100vw-2rem))] min-w-[min(180px,calc(100vw-2rem))] snap-start flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <Plus className="h-5 w-5" /> Nova coluna
                  </button>
                )}
                <section
                  className="flex w-[min(272px,calc(100vw-2rem))] min-w-[min(272px,calc(100vw-2rem))] snap-start flex-col rounded-xl border bg-muted/25 sm:w-[272px] sm:min-w-[272px]"
                  style={{ borderTop: `4px solid ${stage.color}` }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggingStage) {
                      placeStage(
                        draggingStage,
                        stages.findIndex((item) => item.id === stage.id),
                      );
                      setDraggingStage(null);
                      return;
                    }
                    const id = event.dataTransfer.getData("text/plain");
                    if (id && all.some((lead) => lead.id === id && lead.stage !== stage.id))
                      move.mutate({ id, stage: stage.id });
                  }}
                >
                  <div
                    draggable={!stage.fixed}
                    onDragStart={(event) => {
                      if (stage.fixed) return;
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("application/x-crm-stage", stage.id);
                      setDraggingStage(stage.id);
                    }}
                    onDragEnd={() => setDraggingStage(null)}
                    title={
                      stage.fixed
                        ? "Coluna fixa: fica sempre no fim e conta como contrato fechado"
                        : "Arraste para mudar a ordem da coluna"
                    }
                    className={`flex items-start justify-between gap-2 px-3 py-3 ${stage.fixed ? "" : "cursor-grab active:cursor-grabbing"} ${draggingStage === stage.id ? "opacity-50" : ""}`}
                  >
                    <div className="flex min-w-0 items-start gap-1">
                      {stage.fixed ? (
                        <Lock
                          aria-label="Coluna fixa"
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70"
                        />
                      ) : (
                        <GripVertical
                          aria-hidden="true"
                          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60"
                        />
                      )}
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold">
                          {stage.label}{" "}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            {leads.length}
                          </span>
                        </h2>
                        <p className="mt-1 text-xs text-muted-foreground">{money(value)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5">
                      {!stage.fixed && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title={`Editar, mover ou excluir a coluna ${stage.label}`}
                          aria-label={`Editar, mover ou excluir a coluna ${stage.label}`}
                          onClick={() => openStageEditor(stage)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col gap-2 px-2 pb-3">
                    {leads.length ? (
                      leads.map((lead) => (
                        <article
                          key={lead.id}
                          draggable
                          onDragStart={(event) => event.dataTransfer.setData("text/plain", lead.id)}
                          className="rounded-xl border bg-card p-3 shadow-sm"
                          style={{ borderLeft: `3px solid ${stage.color}` }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <span
                                aria-hidden="true"
                                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
                                style={{ backgroundColor: stage.color }}
                              >
                                {lead.title
                                  .trim()
                                  .split(/\s+/)
                                  .slice(0, 2)
                                  .map((part) => part[0])
                                  .join("")
                                  .toUpperCase()}
                              </span>
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  className="text-left text-sm font-semibold hover:text-primary hover:underline"
                                  onClick={() => openEdit(lead)}
                                >
                                  {lead.title}
                                </button>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                  <Building2 className="mr-1 inline h-3 w-3" />
                                  {(lead.client_id && clientNames.get(lead.client_id)) ||
                                    lead.company_name ||
                                    "Sem empresa"}
                                </p>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              title="Editar lead"
                              onClick={() => openEdit(lead)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          {lead.contact_phone && (
                            <p className="mt-3 truncate text-xs text-muted-foreground">
                              <Phone className="mr-1 inline h-3 w-3" />
                              {lead.contact_phone}
                            </p>
                          )}
                          {lead.contact_email && (
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              <Mail className="mr-1 inline h-3 w-3" />
                              {lead.contact_email}
                            </p>
                          )}
                          <p className="mt-3 text-sm font-semibold">{money(lead.amount ?? 0)}</p>
                          {lead.expected_close_date && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              <CalendarDays className="mr-1 inline h-3 w-3" />
                              Previsão: {lead.expected_close_date.split("-").reverse().join("/")}
                            </p>
                          )}
                          {(lead.source || leadProposal(lead)) && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {leadProposal(lead) && (
                                <button
                                  type="button"
                                  onClick={() => openEdit(lead)}
                                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/15"
                                >
                                  <FileText className="h-3 w-3" /> Proposta nº{" "}
                                  {leadProposal(lead)!.number}
                                </button>
                              )}
                              {lead.source && (
                                <span className="inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                                  {lead.source}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="mt-3 border-t pt-2">
                            <Select
                              value={lead.stage}
                              onValueChange={(stageValue) =>
                                move.mutate({ id: lead.id, stage: stageValue as Stage })
                              }
                              disabled={move.isPending}
                            >
                              <SelectTrigger
                                className="h-8 text-xs"
                                aria-label={`Etapa de ${lead.title}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {stages.map((option) => (
                                  <SelectItem key={option.id} value={option.id}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="grid flex-1 place-items-center py-12 text-center text-xs text-muted-foreground">
                        <div>
                          <Users className="mx-auto mb-2 h-5 w-5" />
                          Sem leads neste estágio
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </Fragment>
            );
          })}
        </div>
      ) : tab === "report" ? (
        <CrmReport
          leads={all}
          stages={stages}
          clientNames={clientNames}
          today={new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(
            new Date(),
          )}
          openLead={(id) => {
            const lead = all.find((item) => item.id === id);
            if (lead) openEdit(lead);
          }}
        />
      ) : (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-lg font-semibold">Origem de Leads</h2>
          <p className="mb-5 text-sm text-muted-foreground">
            Quantidade de leads por origem no ambiente atual.
          </p>
          {origins.length ? (
            <div className="space-y-4">
              {origins.map(([source, count]) => (
                <div key={source}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{source}</span>
                    <strong>{count}</strong>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(count / filtered.length) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhum lead encontrado.
            </p>
          )}
        </div>
      )}

      <Dialog
        open={!!editingStage}
        onOpenChange={(open) => {
          if (!open) setEditingStage(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingStage === "new" ? "Nova coluna" : "Editar coluna"}</DialogTitle>
            <DialogDescription>
              {editingStage === "new"
                ? "A coluna entra antes de “Contrato fechado” e vale para todos neste ambiente."
                : "O título, a cor e a posição valem para todos neste ambiente."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveStage.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="crm-stage-label">Título da coluna</Label>
              <Input
                id="crm-stage-label"
                value={stageForm.label}
                maxLength={60}
                required
                onChange={(event) => setStageForm({ ...stageForm, label: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="crm-stage-color">Cor da coluna</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="crm-stage-color"
                  type="color"
                  className="h-11 w-16 cursor-pointer p-1"
                  value={stageForm.color}
                  onChange={(event) => setStageForm({ ...stageForm, color: event.target.value })}
                />
                <span className="text-sm text-muted-foreground">
                  {stageForm.color.toUpperCase()}
                </span>
              </div>
            </div>
            {editingStage &&
              editingStage !== "new" &&
              (() => {
                const index = openStages.findIndex((stage) => stage.id === editingStage);
                return (
                  <div className="space-y-1.5">
                    <Label>Posição no funil</Label>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={index <= 0 || reorderStages.isPending}
                        onClick={() => placeStage(editingStage, index - 1)}
                      >
                        <ChevronLeft className="h-4 w-4" /> Esquerda
                      </Button>
                      <span className="min-w-14 text-center text-sm tabular-nums text-muted-foreground">
                        {index + 1} de {openStages.length}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={index >= openStages.length - 1 || reorderStages.isPending}
                        onClick={() => placeStage(editingStage, index + 1)}
                      >
                        Direita <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      A posição muda na hora. Você também pode arrastar a coluna pelo título.
                    </p>
                  </div>
                );
              })()}
            <DialogFooter className="flex-row justify-between sm:justify-between">
              {editingStage && editingStage !== "new" ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  disabled={openStages.length <= 1}
                  title={
                    openStages.length <= 1
                      ? "Mantenha ao menos uma coluna além de Contrato fechado"
                      : undefined
                  }
                  onClick={() => {
                    const stage = openStages.find((item) => item.id === editingStage);
                    if (stage) askDeleteStage(stage);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Excluir
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingStage(null)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saveStage.isPending}>
                  {saveStage.isPending
                    ? "Salvando…"
                    : editingStage === "new"
                      ? "Criar coluna"
                      : "Salvar coluna"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setOpenLeadId(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.title}</DialogTitle>
            <DialogDescription>
              {(editing?.client_id && clientNames.get(editing.client_id)) ||
                editing?.company_name ||
                "Sem empresa"}
              . O lead vem da proposta: para aprovar, gerar o financeiro ou excluir, use os botões
              da proposta.
            </DialogDescription>
          </DialogHeader>
          {editing &&
            (editingAgreement ? (
              <FinanceAgreements
                embedded
                agreements={[editingAgreement]}
                kind="quote"
                refresh={refreshProposal}
              />
            ) : leadProposal(editing) ? (
              <ProposalPanel doc={leadProposal(editing)!} />
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Este lead não tem proposta vinculada.
              </p>
            ))}
          {editing && (
            <div className="space-y-1.5">
              <Label htmlFor="crm-lead-stage">Coluna no funil</Label>
              <Select
                value={editing.stage}
                onValueChange={(stageValue) => move.mutate({ id: editing.id, stage: stageValue })}
                disabled={move.isPending}
              >
                <SelectTrigger id="crm-lead-stage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deletingStage}
        onOpenChange={(open) => {
          if (!open) setDeletingStage(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a coluna “{deletingStage?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Os leads desta coluna vão para a coluna escolhida abaixo. Nenhum lead é excluído.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="crm-stage-move-to">Mover os leads para</Label>
            <Select value={moveTo} onValueChange={setMoveTo}>
              <SelectTrigger id="crm-stage-move-to">
                <SelectValue placeholder="Escolha a coluna" />
              </SelectTrigger>
              <SelectContent>
                {stages
                  .filter((stage) => stage.id !== deletingStage?.id)
                  .map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!moveTo || deleteStage.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deletingStage && moveTo)
                  deleteStage.mutate({ stage: deletingStage, target: moveTo });
              }}
            >
              {deleteStage.isPending ? "Excluindo…" : "Excluir coluna"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProposalPanel({ doc }: { doc: ProposalDocument }) {
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const plan =
    doc.fee_model === "monthly"
      ? `Mensal a partir de ${brDate(doc.first_due)}`
      : doc.periods === 1
        ? `À vista em ${brDate(doc.first_due)}`
        : `${doc.periods} parcelas a partir de ${brDate(doc.first_due)}`;
  return (
    <section
      aria-label="Proposta vinculada"
      className="overflow-hidden rounded-xl border bg-muted/30"
    >
      <div aria-hidden className="h-1 bg-[#ddbc70]" />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Proposta de honorários nº {doc.number}</p>
            <p className="font-semibold leading-snug">{doc.title}</p>
            <p className="text-xs text-muted-foreground">
              {doc.area}, {doc.practice === "consultivo" ? "consultivo" : "contencioso"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => setViewing(true)}>
              <Eye className="h-4 w-4" /> Visualizar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await downloadLeadProposal(doc);
                setBusy(false);
              }}
            >
              <FileDown className="h-4 w-4" /> {busy ? "Gerando…" : "Baixar PDF"}
            </Button>
          </div>
          {viewing && <ProposalPdfViewer doc={doc} close={() => setViewing(false)} />}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">
              {doc.fee_model === "fixed_success"
                ? "Valor inicial"
                : doc.fee_model === "monthly"
                  ? "Mensalidade"
                  : "Honorários"}
            </dt>
            <dd className="font-semibold tabular-nums text-primary">
              {money(doc.amount_cents / 100)}
              {doc.minimum_wages ? (
                <span className="block text-xs font-normal text-muted-foreground">
                  {String(doc.minimum_wages).replace(".", ",")} salário(s) mínimo(s)
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Pagamento</dt>
            <dd>
              {plan}, {proposalPayments[doc.payment_method]?.toLowerCase()}
            </dd>
          </div>
          {doc.fee_model === "fixed_success" && doc.success_percent ? (
            <div>
              <dt className="text-xs text-muted-foreground">Êxito</dt>
              <dd>{String(doc.success_percent).replace(".", ",")}% do proveito</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs text-muted-foreground">Válida até</dt>
            <dd>{brDate(proposalValidUntil(doc))}</dd>
          </div>
        </dl>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Escopo ({doc.scope.length} {doc.scope.length === 1 ? "atividade" : "atividades"})
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {doc.scope.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}
