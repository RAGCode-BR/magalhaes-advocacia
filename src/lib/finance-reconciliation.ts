import { differenceInCalendarDays, parseISO } from "date-fns";
import type { FinanceEntry } from "./office-finance";
import type { BankTransaction } from "./office-bank";

export function reconciliationEntries(
  entries: FinanceEntry[],
  transaction: BankTransaction,
  search = "",
) {
  const kind = transaction.amount_cents > 0 ? "income" : "expense";
  const amount = Math.abs(transaction.amount_cents);
  const query = search.toLocaleLowerCase("pt-BR").trim();
  return entries
    .filter(
      (entry) =>
        entry.kind === kind &&
        !entry.cancelled_at &&
        entry.amount_cents > entry.settled_cents &&
        (!query ||
          [entry.description, entry.supplier, entry.counterparty_name, entry.category]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("pt-BR")
            .includes(query)),
    )
    .sort((a, b) => {
      const exact = (entry: FinanceEntry) =>
        Number(entry.amount_cents - entry.settled_cents !== amount);
      return (
        exact(a) - exact(b) ||
        Math.abs(differenceInCalendarDays(parseISO(a.due_date), parseISO(transaction.booked_on))) -
          Math.abs(
            differenceInCalendarDays(parseISO(b.due_date), parseISO(transaction.booked_on)),
          ) ||
        a.id.localeCompare(b.id)
      );
    });
}
