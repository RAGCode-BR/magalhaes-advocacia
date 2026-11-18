import type { SheetData } from "write-excel-file/browser";
export type FinanceReport = {
  title: string;
  note: string;
  columns: string[];
  rows: (string | number)[][];
};
export function escapeReport(value: string | number) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
export async function exportExcel(report: FinanceReport) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const text = (value: string) => ({ type: String, value });
  await writeXlsxFile(
    [
      [{ ...text(report.title), fontWeight: "bold" as const }],
      [text(report.note)],
      [text(`Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`)],
      report.columns.map((value) => ({ ...text(value), fontWeight: "bold" as const })),
      ...report.rows.map((row) =>
        row.map((value) =>
          typeof value === "number" ? { type: Number, value, format: "#,##0.00" } : text(value),
        ),
      ),
    ] as SheetData,
    { columns: report.columns.map(() => ({ width: 28 })) },
  ).toFile("magalhaes-financeiro.xlsx");
}
export function printFinance(report: FinanceReport, popup: Window) {
  const cells = (row: (string | number)[], tag: string) =>
    row.map((value) => `<${tag}>${escapeReport(value)}</${tag}>`).join("");
  popup.document.write(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeReport(report.title)}</title><style>@page{size:A4 landscape;margin:12mm}body{font:11px Arial;color:#222}h1{font-size:18px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #ccc;padding:6px;overflow-wrap:anywhere;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}@media print{button{display:none}}</style></head><body><h1>Magalhães Advocacia · ${escapeReport(report.title)}</h1><p>${escapeReport(report.note)}</p><p>Gerado em ${escapeReport(new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }))}</p><button onclick="window.print()">Imprimir / salvar PDF</button><table><thead><tr>${cells(report.columns, "th")}</tr></thead><tbody>${report.rows.map((row) => `<tr>${cells(row, "td")}</tr>`).join("")}</tbody></table></body></html>`,
  );
  popup.document.close();
  popup.focus();
  popup.print();
}
