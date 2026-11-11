import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FinanceAgreements } from "@/components/finance/FinanceAgreements";
import { financeRows } from "@/lib/office-finance-data";
import type { FinanceAgreement } from "@/lib/office-finance";

export const Route = createFileRoute("/_app/orcamentos")({ component: QuotesRoute });

// Quotes write to the office ledger, so they keep the Financeiro admin-only rule.
function QuotesRoute() {
  const { isAdmin, isClient, user } = useAuth();
  if (!isAdmin || isClient || !user) return <Navigate to="/settings" replace />;
  return <QuotesPage key={user.id} userId={user.id} />;
}

function QuotesPage({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  // Nested under the Financeiro key so both screens refresh each other.
  const agreements = useQuery({
    queryKey: ["office-finance", userId, "quotes"],
    queryFn: () => financeRows<FinanceAgreement>("office_finance_agreements"),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["office-finance"] });

  return (
    <section className="mx-auto w-full min-w-0 max-w-7xl space-y-5 p-4 md:p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          Magalhães Advocacia
        </p>
        <h1 className="text-2xl font-semibold">Orçamentos</h1>
        <p className="text-sm text-muted-foreground">
          Propostas de honorários em PDF, com o lead criado no CRM.
        </p>
      </header>
      {agreements.isPending && <p role="status">Carregando os orçamentos…</p>}
      {agreements.isError && (
        <Card className="flex flex-wrap items-center gap-3 p-4" role="alert">
          Não foi possível carregar os orçamentos.
          <Button variant="outline" onClick={() => void agreements.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      )}
      {agreements.data && (
        <FinanceAgreements agreements={agreements.data} kind="quote" refresh={refresh} />
      )}
    </section>
  );
}
