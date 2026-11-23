// Aba "Propostas" da Lixeira (somente administradores). Restaurar traz a
// proposta e o lead dela de volta ao CRM; excluir de vez apaga os dois.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useClients } from "@/hooks/use-data";
import { financeRpc } from "@/lib/office-finance-data";

type TrashedProposal = {
  id: string;
  description: string;
  client_id: string | null;
  amount_cents: number;
  proposal: { number?: string | number; client?: { name?: string } } | null;
  deleted_at: string;
  lead_title: string | null;
};

const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function ProposalTrash() {
  const queryClient = useQueryClient();
  const { data: clients = [] } = useClients();
  const trashed = useQuery({
    queryKey: ["office-finance", "proposal-trash"],
    queryFn: async () =>
      ((await financeRpc("office_finance_trashed_proposals", {})) ?? []) as TrashedProposal[],
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["office-finance"] });
    void queryClient.invalidateQueries({ queryKey: ["crm-opportunities"] });
  };
  const run = async (name: string, id: string, success: string) => {
    try {
      await financeRpc(name, { target: id });
      toast.success(success);
      refresh();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const clientName = (item: TrashedProposal) =>
    clients.find((client) => client.id === item.client_id)?.name ??
    item.proposal?.client?.name ??
    "—";

  if (trashed.isPending) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (trashed.isError)
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm" role="alert">
        Não foi possível carregar as propostas excluídas.
        <Button variant="outline" size="sm" onClick={() => void trashed.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  if (!trashed.data.length)
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        Nenhuma proposta na lixeira.
      </div>
    );
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Proposta</th>
            <th className="px-3 py-2 text-left">Cliente</th>
            <th className="px-3 py-2 text-right">Valor</th>
            <th className="px-3 py-2 text-left">Excluída em</th>
            <th className="px-3 py-2 text-right">Ações</th>
          </tr>
        </thead>
        <tbody>
          {trashed.data.map((item) => (
            <tr key={item.id} className="border-t">
              <td className="px-3 py-2">
                <p className="font-medium">{item.description}</p>
                {item.proposal?.number != null && (
                  <p className="text-xs text-muted-foreground">Nº {item.proposal.number}</p>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{clientName(item)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(item.amount_cents)}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {format(new Date(item.deleted_at), "dd/MM/yyyy HH:mm")}
              </td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      run(
                        "office_finance_restore_proposal",
                        item.id,
                        "Proposta restaurada. O lead voltou ao CRM.",
                      )
                    }
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Restaurar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    aria-label={`Excluir de vez a proposta ${item.description}`}
                    title="Excluir de vez"
                    onClick={() => {
                      if (
                        confirm(
                          `Excluir de vez a proposta “${item.description}” e o lead dela? Esta ação não pode ser desfeita.`,
                        )
                      )
                        void run(
                          "office_finance_purge_proposal",
                          item.id,
                          "Proposta excluída de vez.",
                        );
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
