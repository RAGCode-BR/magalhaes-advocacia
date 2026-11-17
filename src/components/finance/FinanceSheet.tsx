import { Children, cloneElement, isValidElement, useState, type ReactNode, type ReactElement } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export type KpiItem = {
  label: string;
  value: ReactNode;
  tone: Tone;
  hint?: ReactNode;
  /** One or two sentences: how the figure is calculated. */
  summary?: ReactNode;
  /** Records behind the figure, shown in the summary window. */
  detail?: () => ReactNode;
  /** Navigation to the full list (e.g. Lançamentos filtered). */
  onClick?: () => void;
  actionLabel?: string;
};

/**
 * One continuous indicator panel: hairline dividers instead of separate boxes, a
 * colored dot naming the indicator's meaning and a large figure. Every indicator
 * with a summary or action is clickable; the summary opens in a window that lists
 * the records behind the number.
 */
export function KpiStrip({ items, className = "" }: { items: KpiItem[]; className?: string }) {
  const [open, setOpen] = useState<KpiItem | null>(null);
  return (
    <>
      <dl
        className={`grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-[0_1px_2px_rgb(0_0_0/0.04)] [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1 ${
          items.length >= 4 ? "lg:grid-cols-4" : "sm:grid-cols-3"
        } ${className}`}
      >
        {items.map((item) => {
          const clickable = !!(item.detail || item.summary || item.onClick);
          const activate = () => (item.detail || item.summary ? setOpen(item) : item.onClick?.());
          return (
            <div
              key={item.label}
              className={`relative min-w-0 bg-card px-4 py-4 md:px-5 ${clickable ? "transition-colors hover:bg-muted/40" : ""}`}
            >
              <dt className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${toneDot[item.tone]}`}
                />
                {clickable ? (
                  <button
                    type="button"
                    onClick={activate}
                    aria-haspopup={item.detail || item.summary ? "dialog" : undefined}
                    className="truncate text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                  >
                    {item.label}
                  </button>
                ) : (
                  <span className="truncate">{item.label}</span>
                )}
                {clickable && (
                  <ChevronRight aria-hidden className="ml-auto h-3.5 w-3.5 shrink-0 opacity-50" />
                )}
              </dt>
              <dd
                className={`mt-2 break-words text-lg font-semibold leading-none tracking-tight tabular-nums sm:text-2xl ${toneText[item.tone]}`}
              >
                {item.value}
              </dd>
              {item.hint && (
                <dd className="mt-2 text-xs leading-snug text-muted-foreground">{item.hint}</dd>
              )}
            </div>
          );
        })}
      </dl>
      {open && (
        <Dialog open onOpenChange={(next) => !next && setOpen(null)}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${toneDot[open.tone]}`} />
                {open.label}
              </DialogTitle>
              <DialogDescription asChild>
                <div>
                  <p
                    className={`mt-1 text-3xl font-semibold tracking-tight tabular-nums ${toneText[open.tone]}`}
                  >
                    {open.value}
                  </p>
                  {open.hint && <p className="mt-1 text-sm text-muted-foreground">{open.hint}</p>}
                  {open.summary && (
                    <p className="mt-3 text-sm text-foreground/80">{open.summary}</p>
                  )}
                </div>
              </DialogDescription>
            </DialogHeader>
            {open.detail?.()}
            {open.onClick && (
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    setOpen(null);
                    open.onClick?.();
                  }}
                >
                  {open.actionLabel ?? "Ver lançamentos"} <ChevronRight />
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export type DetailRow = {
  key: string;
  date?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  value: ReactNode;
};

/** The records behind an indicator, as a compact sheet with an optional total. */
export function DetailRows({
  rows,
  total,
  empty = "Nenhum registro neste período.",
  limit = 200,
}: {
  rows: DetailRow[];
  total?: ReactNode;
  empty?: string;
  limit?: number;
}) {
  if (!rows.length)
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        {empty}
      </p>
    );
  const hasDate = rows.some((row) => row.date);
  return (
    <div className="space-y-1">
      <Sheet
        label="Registros do indicador"
        maxHeight="max-h-[50vh]"
        columns={[
          ...(hasDate ? [{ label: "Data" }] : []),
          { label: "Descrição" },
          { label: "Valor", align: "right" as const },
        ]}
        footer={
          total !== undefined ? (
            <tr>
              <td className="fin-sheet-gutter">Σ</td>
              <td colSpan={hasDate ? 2 : 1}>
                Total · {rows.length} {rows.length === 1 ? "registro" : "registros"}
              </td>
              <td className="whitespace-nowrap text-right">{total}</td>
            </tr>
          ) : undefined
        }
      >
        {rows.slice(0, limit).map((row, index) => (
          <tr key={row.key}>
            <SheetGutter n={index + 1} />
            {hasDate && (
              <td className="whitespace-nowrap">
                {row.date ? row.date.slice(0, 10).split("-").reverse().join("/") : ""}
              </td>
            )}
            <td className="min-w-48">
              <p>{row.title}</p>
              {row.subtitle && <p className="text-xs text-muted-foreground">{row.subtitle}</p>}
            </td>
            <td className="whitespace-nowrap text-right font-medium">{row.value}</td>
          </tr>
        ))}
      </Sheet>
      {rows.length > limit && (
        <p className="text-xs text-muted-foreground">
          Mostrando {limit} de {rows.length} registros.
        </p>
      )}
    </div>
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
  fit = false,
}: {
  columns: { label: string; align?: "right" | "center"; className?: string }[];
  children: ReactNode;
  footer?: ReactNode;
  label: string;
  maxHeight?: string;
  fit?: boolean;
}) {
  return (
    <div className={`fin-sheet ${fit ? "fin-sheet-fit" : "overflow-auto"} rounded-xl border ${maxHeight}`}>
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
        <tbody>{fit ? Children.map(children, row => {
          if (!isValidElement<{ children: ReactNode }>(row)) return row;
          return cloneElement(row, {}, Children.map(row.props.children, (cell, index) =>
            isValidElement(cell) ? cloneElement(cell as ReactElement<Record<string, unknown>>, { "data-label": index ? columns[index - 1]?.label : "Linha" }) : cell));
        }) : children}</tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

export function SheetGutter({ n }: { n: number | string }) {
  return <td className="fin-sheet-gutter">{n}</td>;
}
