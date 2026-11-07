import { useState } from "react";
import { addMonths, format, parseISO } from "date-fns";
import { useClients, useProfiles } from "@/hooks/use-data";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  financeCsv,
  financeDailyFlow,
  financeTotals,
  type FinanceEntry,
} from "@/lib/office-finance";
import {
  currency,
  displayDate,
  isoToday,
  selectClass,
  saveCsv,
  financeRows,
  type OfficeFinanceData,
  type FinanceHistory,
} from "@/lib/office-finance-data";

export function FinanceReports({ ledger }: { ledger: OfficeFinanceData }) {
  const [month, setMonth] = useState(isoToday().slice(0, 7));
  const [basis, setBasis] = useState<"cash" | "competence">("cash");
  const [group, setGroup] = useState<"category" | "cost_center" | "client_id">("category");
  const { data: clients = [] } = useClients();
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const months = Array.from({ length: 12 }, (_, index) =>
    format(addMonths(parseISO(month + "-01"), index - 11), "yyyy-MM"),
  );
  const monthly = months.map((period) => ({
    period,
    ...financeTotals(ledger.entries, ledger.settlements, period, basis),
  }));
  const daily = financeDailyFlow(ledger.entries, ledger.settlements, month);
  const entriesById = new Map(ledger.entries.map((entry) => [entry.id, entry]));
  const grouped = new Map<string, { income: number; expense: number }>();
  function accumulate(entry: FinanceEntry, amount: number) {
    const name =
      group === "client_id"
        ? (clientNames.get(entry.client_id ?? "") ?? "Sem cliente")
        : entry[group] || "Sem centro de custo";
    const totals = grouped.get(name) ?? { income: 0, expense: 0 };
    totals[entry.kind] += amount;
    grouped.set(name, totals);
  }
  if (basis === "competence") {
    ledger.entries
      .filter((entry) => !entry.cancelled_at && entry.competence_date.startsWith(month))
      .forEach((entry) => accumulate(entry, entry.amount_cents));
  } else {
    ledger.settlements
      .filter((settlement) => !settlement.reversed_at && settlement.settled_on.startsWith(month))
      .forEach((settlement) => {
        const entry = entriesById.get(settlement.entry_id);
        if (entry) accumulate(entry, settlement.amount_cents);
      });
  }
  const groupedRows = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  function exportReport() {
    saveCsv(
      financeCsv([
        ["Regime", basis === "cash" ? "Caixa" : "Competência"],
        ["Mês", "Receitas (R$)", "Despesas (R$)", "Resultado (R$)"],
        ...monthly.map((item) => [
          item.period,
          (item.income / 100).toFixed(2).replace(".", ","),
          (item.expense / 100).toFixed(2).replace(".", ","),
          (item.balance / 100).toFixed(2).replace(".", ","),
        ]),
        [],
        ["Detalhamento", month],
        ["Grupo", "Receitas (R$)", "Despesas (R$)", "Resultado (R$)"],
        ...groupedRows.map(([name, item]) => [
          name,
          (item.income / 100).toFixed(2).replace(".", ","),
          (item.expense / 100).toFixed(2).replace(".", ","),
          ((item.income - item.expense) / 100).toFixed(2).replace(".", ","),
        ]),
      ]),
      `financeiro-${month}.csv`,
    );
  }
  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Resultados e fluxo financeiro</h2>
        <Button variant="outline" onClick={exportReport}>
          Exportar relatório CSV
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          className="w-auto"
          type="month"
          aria-label="Mês final do relatório"
          value={month}
          onChange={(event) => {
            if (event.target.value) setMonth(event.target.value);
          }}
        />
        <select
          className={selectClass + " w-auto"}
          aria-label="Regime do relatório"
          value={basis}
          onChange={(event) => setBasis(event.target.value as "cash" | "competence")}
        >
          <option value="cash">Caixa</option>
          <option value="competence">Competência</option>
        </select>
        <select
          className={selectClass + " w-auto"}
          aria-label="Agrupar relatório"
          value={group}
          onChange={(event) => setGroup(event.target.value as typeof group)}
        >
          <option value="category">Categoria</option>
          <option value="cost_center">Centro de custo</option>
          <option value="client_id">Cliente</option>
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              {["Mês", "Receitas", "Despesas", "Resultado"].map((label) => (
                <th scope="col" className="p-2" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthly.map((item) => (
              <tr key={item.period} className="border-b last:border-0">
                <td className="p-2">{item.period.split("-").reverse().join("/")}</td>
                <td className="p-2 whitespace-nowrap">{currency(item.income)}</td>
                <td className="p-2 whitespace-nowrap">{currency(item.expense)}</td>
                <td className="p-2 whitespace-nowrap">{currency(item.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="font-medium">Fluxo diário de caixa</h3>
      <p className="text-sm text-muted-foreground">
        O resultado previsto soma as baixas e o saldo ainda em aberto nos vencimentos deste mês.
      </p>
      {daily.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                {["Data", "Recebido", "Pago", "A receber", "A pagar", "Resultado previsto"].map(
                  (label) => (
                    <th scope="col" key={label} className="p-2">
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {daily.map((day) => (
                <tr key={day.date} className="border-b last:border-0">
                  <td className="p-2 whitespace-nowrap">{displayDate(day.date)}</td>
                  {[
                    day.income,
                    day.expense,
                    day.pendingIncome,
                    day.pendingExpense,
                    day.projected,
                  ].map((amount, index) => (
                    <td key={index} className="p-2 whitespace-nowrap">
                      {currency(amount)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Sem movimentos ou vencimentos neste mês.</p>
      )}
      <h3 className="font-medium">Detalhamento de {month.split("-").reverse().join("/")}</h3>
      {groupedRows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                {["Grupo", "Receitas", "Despesas", "Resultado"].map((label) => (
                  <th scope="col" className="p-2" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupedRows.map(([name, totals]) => (
                <tr key={name} className="border-b last:border-0">
                  <td className="p-2">{name}</td>
                  <td className="p-2 whitespace-nowrap">{currency(totals.income)}</td>
                  <td className="p-2 whitespace-nowrap">{currency(totals.expense)}</td>
                  <td className="p-2 whitespace-nowrap">
                    {currency(totals.income - totals.expense)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum movimento neste mês.</p>
      )}
    </Card>
  );
}

export function FinanceStatement({ ledger }: { ledger: OfficeFinanceData }) {
  const [month, setMonth] = useState(isoToday().slice(0, 7));
  const [accountId, setAccountId] = useState("");
  const entries = new Map(ledger.entries.map((entry) => [entry.id, entry]));
  const accounts = new Map(ledger.accounts.map((account) => [account.id, account.name]));
  const movements = ledger.settlements
    .filter(
      (item) =>
        !item.reversed_at &&
        item.settled_on.startsWith(month) &&
        (!accountId || item.account_id === accountId),
    )
    .map((item) => {
      const entry = entries.get(item.entry_id);
      return {
        id: item.id,
        date: item.settled_on,
        description: entry?.description ?? "Lançamento",
        account: accounts.get(item.account_id ?? "") ?? "Sem conta informada",
        amount: (entry?.kind === "income" ? 1 : -1) * item.amount_cents,
      };
    });
  for (const transfer of ledger.transfers.filter((item) => item.transferred_on.startsWith(month))) {
    if (!accountId || transfer.from_account === accountId)
      movements.push({
        id: transfer.id + "-out",
        date: transfer.transferred_on,
        description: "Transferência · " + transfer.description,
        account: accounts.get(transfer.from_account) ?? "",
        amount: -transfer.amount_cents,
      });
    if (!accountId || transfer.to_account === accountId)
      movements.push({
        id: transfer.id + "-in",
        date: transfer.transferred_on,
        description: "Transferência · " + transfer.description,
        account: accounts.get(transfer.to_account) ?? "",
        amount: transfer.amount_cents,
      });
  }
  movements.sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Extrato de movimentações</h2>
        <Button
          variant="outline"
          onClick={() =>
            saveCsv(
              financeCsv([
                ["Data", "Descrição", "Conta", "Valor (R$)"],
                ...movements.map((item) => [
                  displayDate(item.date),
                  item.description,
                  item.account,
                  (item.amount / 100).toFixed(2).replace(".", ","),
                ]),
              ]),
              `extrato-${month}.csv`,
            )
          }
        >
          Exportar extrato CSV
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          className="w-auto"
          type="month"
          aria-label="Mês do extrato"
          value={month}
          onChange={(event) => {
            if (event.target.value) setMonth(event.target.value);
          }}
        />
        <select
          className={selectClass + " sm:w-auto"}
          aria-label="Conta do extrato"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
        >
          <option value="">Todas as contas</option>
          {ledger.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </div>
      <p className="font-medium">
        Movimento líquido no período ·{" "}
        {currency(movements.reduce((sum, item) => sum + item.amount, 0))}
      </p>
      <ul className="divide-y">
        {movements.map((item) => (
          <li className="flex flex-wrap justify-between gap-3 py-3 text-sm" key={item.id}>
            <div>
              <p>{item.description}</p>
              <p className="text-muted-foreground">
                {displayDate(item.date)} · {item.account}
              </p>
            </div>
            <strong className="tabular-nums">{currency(item.amount)}</strong>
          </li>
        ))}
      </ul>
      {!movements.length && (
        <p className="text-sm text-muted-foreground">Nenhuma movimentação no período.</p>
      )}
    </Card>
  );
}

const entityNames: Record<string, string> = {
  office_finance_entries: "Lançamento",
  office_finance_settlements: "Baixa",
  office_finance_accounts: "Conta",
  office_finance_registers: "Cadastro",
  office_finance_agreements: "Orçamento ou contrato",
  office_finance_transfers: "Transferência",
  office_finance_services: "Serviço",
  office_finance_orders: "Pedido de serviço ou compra",
  office_finance_order_items: "Item de pedido",
};

export function FinanceHistoryPanel({
  userId,
  ledger,
}: {
  userId: string;
  ledger: OfficeFinanceData;
}) {
  const { data: profiles = [] } = useProfiles();
  const users = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
  const descriptions = new Map([
    ...ledger.entries.map((entry) => [entry.id, entry.description] as const),
    ...ledger.accounts.map((account) => [account.id, account.name] as const),
    ...ledger.registers.map((register) => [register.id, register.name] as const),
    ...ledger.agreements.map((agreement) => [agreement.id, agreement.description] as const),
    ...ledger.transfers.map((transfer) => [transfer.id, transfer.description] as const),
  ]);
  for (const settlement of ledger.settlements)
    descriptions.set(settlement.id, descriptions.get(settlement.entry_id) ?? "Baixa financeira");
  const query = useQuery({
    queryKey: ["office-finance", userId, "history"],
    queryFn: () =>
      financeRows<FinanceHistory>(
        "office_finance_history",
        "id,entity_id,entity_type,action,created_at,created_by",
      ),
  });
  const [search, setSearch] = useState("");
  const rows = (query.data ?? [])
    .filter((item) =>
      (entityNames[item.entity_type] ?? item.entity_type)
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <Card className="space-y-4 p-4">
      <h2 className="text-lg font-semibold">Histórico financeiro</h2>
      <Input
        aria-label="Filtrar histórico"
        placeholder="Filtrar por lançamento, baixa, conta…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {query.isPending && <p role="status">Carregando histórico…</p>}
      {query.isError && (
        <div role="alert">
          Não foi possível carregar o histórico.{" "}
          <Button variant="outline" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      <ul className="divide-y text-sm">
        {rows.map((item) => (
          <li key={item.id} className="space-y-1 py-3">
            <p className="font-medium">
              {entityNames[item.entity_type] ?? "Registro"} ·{" "}
              {item.action === "INSERT" ? "Criação" : "Alteração"}
            </p>
            <p>
              {new Intl.DateTimeFormat("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "America/Sao_Paulo",
              }).format(new Date(item.created_at))}
            </p>
            <p className="break-all text-xs text-muted-foreground">
              {descriptions.get(item.entity_id) ?? "Registro financeiro"} ·{" "}
              {users.get(item.created_by) ?? "Administrador"}
            </p>
          </li>
        ))}
      </ul>
      {query.isSuccess && !rows.length && (
        <p className="text-sm text-muted-foreground">Nenhum evento encontrado.</p>
      )}
    </Card>
  );
}
