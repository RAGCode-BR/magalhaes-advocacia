import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import sicoobLogo from "@/assets/brand/sicoob.svg";
import { currency } from "@/lib/office-finance-data";

// Shared spreadsheet-like building blocks for the finance area: gridded tables,
// colored indicators and signed amounts. Visual only — no data access here.

export type Tone = "income" | "expense" | "balance" | "alert" | "neutral";

const toneDot: Record<Tone, string> = {
  income: "bg-emerald-600 dark:bg-emerald-400",
  expense: "bg-destructive",
  balance: "bg-primary",
  alert: "bg-amber-500",
  neutral: "bg-muted-foreground/40",
};
const toneText: Record<Tone, string> = {
  income: "text-emerald-700 dark:text-emerald-400",
  expense: "text-destructive",
  balance: "text-foreground",
  alert: "text-amber-700 dark:text-amber-300",
  neutral: "text-foreground",
};

export function SicoobLogo({ className = "h-5" }: { className?: string }) {
  // The wordmark has dark-green letters, so it always sits on a white chip to stay
  // legible in dark mode.
  return (
    <span className="inline-flex shrink-0 items-center rounded-md bg-white px-2 py-1 ring-1 ring-black/5">
      <img src={sicoobLogo} alt="Sicoob" className={`${className} w-auto`} />
    </span>
  );
}

/**
 * One continuous indicator panel: hairline dividers instead of separate boxes, a
 * colored dot naming the indicator's meaning and a large figure.
 */
export function KpiStrip({
  items,
  className = "",
}: {
  items: {
    label: string;
    value: ReactNode;
    tone: Tone;
    hint?: ReactNode;
    /** Makes the indicator open the records behind it. */
    onClick?: () => void;
  }[];
  className?: string;
}) {
  return (
    <dl
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-[0_1px_2px_rgb(0_0_0/0.04)] [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1 ${
        items.length >= 4 ? "lg:grid-cols-4" : "sm:grid-cols-3"
      } ${className}`}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className={`relative min-w-0 bg-card px-4 py-4 md:px-5 ${item.onClick ? "transition-colors hover:bg-muted/40" : ""}`}
        >
          <dt className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${toneDot[item.tone]}`} />
            {item.onClick ? (
              <button
                type="button"
                onClick={item.onClick}
                className="truncate text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
              >
                {item.label}
              </button>
            ) : (
              <span className="truncate">{item.label}</span>
            )}
            {item.onClick && (
              <ChevronRight aria-hidden className="ml-auto h-3.5 w-3.5 shrink-0 opacity-50" />
            )}
          </dt>
          <dd
            className={`mt-2 break-words text-lg font-semibold sm:text-2xl leading-none tracking-tight tabular-nums ${toneText[item.tone]}`}
          >
            {item.value}
          </dd>
          {item.hint && (
            <dd className="mt-2 text-xs leading-snug text-muted-foreground">{item.hint}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

/** Amount colored by direction. `abs` drops the sign where the column already says it. */
export function Amount({ cents, abs = false }: { cents: number; abs?: boolean }) {
  if (!cents) return <span className="tabular-nums text-muted-foreground">{currency(0)}</span>;
  const positive = cents > 0;
  return (
    <span className={`tabular-nums ${positive ? toneText.income : toneText.expense}`}>
      {abs ? currency(Math.abs(cents)) : `${positive ? "+" : "−"}${currency(Math.abs(cents))}`}
    </span>
  );
}

const statusStyles: Record<string, string> = {
  Confere:
    "bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300",
  Diferença:
    "bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-400/10 dark:text-amber-300",
  Ativo:
    "bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300",
  Quitado:
    "bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300",
  Conciliada:
    "bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300",
  "Em aberto": "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-400/10 dark:text-sky-300",
  Parcial: "bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-400/10 dark:text-amber-300",
  Pendente: "bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-400/10 dark:text-amber-300",
  Vencido: "bg-red-50 text-red-800 ring-red-600/20 dark:bg-red-400/10 dark:text-red-300",
  "Parcial em atraso":
    "bg-red-50 text-red-800 ring-red-600/20 dark:bg-red-400/10 dark:text-red-300",
  Cancelado: "bg-muted text-muted-foreground ring-border line-through",
};

export function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        statusStyles[status] ?? "bg-muted text-foreground ring-border"
      }`}
    >
      {status}
    </span>
  );
}

/**
 * Gridded table in the spirit of a spreadsheet: a numbered row gutter, hairline
 * cell borders, sticky header and an optional totals row with a double rule.
 */
export function Sheet({
  columns,
  children,
  footer,
  label,
  maxHeight = "max-h-[65vh]",
}: {
  columns: { label: string; align?: "right" | "center"; className?: string }[];
  children: ReactNode;
  footer?: ReactNode;
  label: string;
  maxHeight?: string;
}) {
  return (
    <div className={`fin-sheet overflow-auto rounded-xl border ${maxHeight}`}>
      <table className="w-full border-collapse text-left text-[13px]" aria-label={label}>
        <thead>
          <tr>
            <th scope="col" className="fin-sheet-gutter">
              <span className="sr-only">Linha</span>
            </th>
            {columns.map((column) => (
              <th
                scope="col"
                key={column.label}
                className={`${column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : ""} ${column.className ?? ""}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

export function SheetGutter({ n }: { n: number | string }) {
  return <td className="fin-sheet-gutter">{n}</td>;
}
