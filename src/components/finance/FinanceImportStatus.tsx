import { useQuery } from "@tanstack/react-query";
import { financeRows, type OfficeFinanceData } from "@/lib/office-finance-data";

type ImportBatch = {
  id: string;
  status: string;
  created_at: string;
  summary: {
    entries: number;
    settlements: number;
    transfers: number;
    source_reconciled: number;
    attachments_imported?: number;
  };
};

export function FinanceImportStatus({
  userId,
  ledger,
}: {
  userId: string;
  ledger: OfficeFinanceData;
}) {
  const query = useQuery({
    queryKey: ["office-finance-import", userId],
    queryFn: () =>
      financeRows<ImportBatch>("office_finance_import_batches", "id,status,created_at,summary"),
    staleTime: 60000,
  });
  const batch = query.data?.find((b) => b.status === "applied");
  if (!batch) return null;
  const unlinked = ledger.entries.filter(
    (e) => e.import_batch_id === batch.id && e.kind === "income" && !e.client_id,
  ).length;
  return (
    <details className="rounded-xl border bg-card px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Histórico importado do Conta Azul (sem sincronização automática) · {batch.summary.entries}{" "}
        lançamentos importados
      </summary>
      <div className="mt-3 space-y-2 text-muted-foreground">
        <p>
          {batch.summary.settlements} pagamentos e recebimentos preservados, incluindo baixas
          parciais. {batch.summary.transfers} transferências entre contas.
        </p>
        <p>
          As marcações de conciliação da origem estão no histórico das baixas. Confira e confirme os
          vínculos com o extrato atual na aba Sicoob.
        </p>
        {!!unlinked && (
          <p>
            {unlinked} receitas ainda precisam ser vinculadas ao cadastro de cliente. O nome
            original está preservado; abra os detalhes do lançamento para conferir o vínculo.
          </p>
        )}
        <p>
          {batch.summary.attachments_imported ?? 0} comprovante(s) de novembro importado(s). Abra
          Anexos no lançamento para visualizar ou adicionar arquivos. Documentos de outros meses não
          fazem parte desta coleta.
        </p>
      </div>
    </details>
  );
}
