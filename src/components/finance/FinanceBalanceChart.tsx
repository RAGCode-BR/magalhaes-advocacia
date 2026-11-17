import { useId, useState } from "react";
import { currency, displayDate } from "@/lib/office-finance-data";

/**
 * Single-series balance-over-time area chart (no legend: the title names it).
 * Hover/touch shows a crosshair with the day's balance.
 */
export function FinanceBalanceChart({
  points,
  label,
}: {
  points: { date: string; cents: number }[];
  label: string;
}) {
  const gradient = useId();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;
  const width = 640;
  const height = 168;
  const pad = { top: 12, bottom: 22 };
  const values = points.map((p) => p.cents);
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 1);
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) =>
    pad.top + (1 - (v - min) / (max - min || 1)) * (height - pad.top - pad.bottom);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cents).toFixed(1)}`);
  const area = `${line.join("")}L${width},${y(min)}L0,${y(min)}Z`;
  const active = hover ?? points.length - 1;
  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  return (
    <figure className="relative w-full min-w-0">
      <figcaption className="sr-only">{label}</figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-40 w-full touch-none overflow-visible"
        role="img"
        aria-label={`${label}: de ${currency(values[0])} em ${displayDate(points[0].date)} para ${currency(values.at(-1) ?? 0)} hoje`}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
          setHover(Math.round(ratio * (points.length - 1)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {min < 0 && (
          <line
            x1={0}
            x2={width}
            y1={y(0)}
            y2={y(0)}
            stroke="var(--border)"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path d={area} fill={`url(#${gradient})`} />
        <path
          d={line.join("")}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={x(active)}
          x2={x(active)}
          y1={pad.top}
          y2={height - pad.bottom}
          stroke="var(--muted-foreground)"
          strokeOpacity={hover === null ? 0 : 0.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* Marker drawn in HTML so it stays round with a non-uniform SVG scale. */}
      <span
        aria-hidden
        className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-primary"
        style={{
          left: `${(x(active) / width) * 100}%`,
          top: `${(y(points[active].cents) / height) * 10}rem`,
        }}
      />
      {hover !== null && (
        <div
          className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs shadow-sm"
          style={{ left: `${Math.min(88, Math.max(12, (x(active) / width) * 100))}%` }}
        >
          <span className="text-muted-foreground">{displayDate(points[active].date)}</span>{" "}
          <strong className="tabular-nums">{currency(points[active].cents)}</strong>
        </div>
      )}
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        {ticks.map((i) => (
          <span key={i}>{displayDate(points[i].date).slice(0, 5)}</span>
        ))}
      </div>
    </figure>
  );
}

const compact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Paired monthly bars: money in (green) and money out (red), with legend,
 * gridlines and a per-month tooltip that also shows the result.
 */
export function FinanceFlowChart({
  data,
  label,
  incomeLabel = "Entradas",
  expenseLabel = "Saídas",
}: {
  data: { key: string; label: string; income: number; expense: number }[];
  label: string;
  incomeLabel?: string;
  expenseLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  // Round the axis up to a clean value: 1, 2 or 5 × 10ⁿ, split in quarters.
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const top = ([1, 2, 5, 10].find((f) => f * magnitude >= max) ?? 10) * magnitude;
  const grid = [top, top * 0.75, top * 0.5, top * 0.25, 0];
  return (
    <figure className="min-w-0">
      <figcaption className="sr-only">{label}</figcaption>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600 dark:bg-emerald-400" />
          {incomeLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-destructive" />
          {expenseLabel}
        </span>
      </div>
      <div className="relative flex h-56 gap-2 pl-14" role="img" aria-label={label}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 left-14 flex flex-col justify-between"
        >
          {grid.map((value) => (
            <div
              key={value}
              className="relative border-t border-dashed border-border/70 first:border-transparent last:border-solid last:border-border"
            >
              <span className="absolute -left-14 -top-2 w-12 text-right text-[10px] tabular-nums text-muted-foreground">
                {compact.format(value / 100)}
              </span>
            </div>
          ))}
        </div>
        {data.map((d, i) => (
          <div
            key={d.key}
            className="relative flex min-w-0 flex-1 flex-col"
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
          >
            <div
              className={`flex flex-1 items-end justify-center gap-[2px] rounded-md transition-colors ${hover === i ? "bg-muted/60" : ""}`}
            >
              <span
                className="w-full max-w-4 rounded-t bg-emerald-600 dark:bg-emerald-400"
                style={{ height: `${(d.income / top) * 100}%` }}
              />
              <span
                className="w-full max-w-4 rounded-t bg-destructive"
                style={{ height: `${(d.expense / top) * 100}%` }}
              />
            </div>
            <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground">
              {d.label}
            </span>
            {hover === i && (
              <div
                className={`pointer-events-none absolute top-0 z-10 w-44 rounded-md border bg-popover p-2 text-xs shadow-md ${
                  i > data.length / 2 ? "right-full mr-1" : "left-full ml-1"
                }`}
              >
                <p className="mb-1 font-medium">{d.label}</p>
                <p className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{incomeLabel}</span>
                  <span className="tabular-nums">{currency(d.income)}</span>
                </p>
                <p className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{expenseLabel}</span>
                  <span className="tabular-nums">{currency(d.expense)}</span>
                </p>
                <p className="mt-1 flex justify-between gap-2 border-t pt-1 font-medium">
                  <span>Resultado</span>
                  <span className="tabular-nums">{currency(d.income - d.expense)}</span>
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="h-6" />
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>Período</th>
            <th>{incomeLabel}</th>
            <th>{expenseLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <td>{d.label}</td>
              <td>{currency(d.income)}</td>
              <td>{currency(d.expense)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Horizontal share bars for a breakdown (e.g. expenses by plan account). */
export function FinanceShareBars({
  rows,
  tone,
  empty,
  onSelect,
}: {
  rows: { name: string; cents: number }[];
  tone: "income" | "expense";
  empty: string;
  /** Opens the records behind a row. */
  onSelect?: (name: string) => void;
}) {
  const total = rows.reduce((sum, row) => sum + row.cents, 0);
  if (!rows.length || !total) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((row) => row.cents));
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li
          key={row.name}
          className="relative -mx-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted/50"
        >
          <div className="flex items-baseline justify-between gap-3">
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(row.name)}
                className="min-w-0 truncate text-left after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
              >
                {row.name}
              </button>
            ) : (
              <span className="min-w-0 truncate">{row.name}</span>
            )}
            <span className="shrink-0 tabular-nums">
              {currency(row.cents)}{" "}
              <span className="text-xs text-muted-foreground">
                {Math.round((row.cents / total) * 100)}%
              </span>
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${tone === "income" ? "bg-emerald-600 dark:bg-emerald-400" : "bg-destructive"}`}
              style={{ width: `${(row.cents / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
