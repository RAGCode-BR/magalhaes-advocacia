import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { exportExcel, printFinance, type FinanceReport } from "@/lib/finance-export";

export function FinanceExport({
  report,
}: {
  report: () => FinanceReport | Promise<FinanceReport>;
}) {
  const [busy, setBusy] = useState(false);
  async function run(pdf: boolean) {
    // Open synchronously so browsers do not block the print window after loading all pages.
    const popup = pdf ? window.open("", "_blank") : null;
    if (pdf && !popup) {
      toast.error("Permita abrir a janela de impressão neste site.");
      return;
    }
    setBusy(true);
    try {
      const data = await report();
      if (pdf) printFinance(data, popup!);
      else await exportExcel(data);
    } catch (error) {
      popup?.close();
      toast.error(error instanceof Error ? error.message : "Não foi possível exportar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-2 py-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(false)}>
        Exportar Excel
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(true)}>
        Imprimir / salvar PDF
      </Button>
    </div>
  );
}

/** Exports exactly the rendered table/filter/page or indicator panel, never hidden records. */
export function FinanceExportRegion({ title, children }: { title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <FinanceExport
        report={() => {
          const element = ref.current!;
          const table = element.querySelector("table");
          const rows = table
            ? Array.from(table.querySelectorAll("tr")).map((row) =>
                Array.from(row.cells).map((cell) => cell.textContent?.trim() ?? ""),
              )
            : Array.from(element.querySelectorAll("dl > div")).map((item) => [
                item.querySelector("dt")?.textContent?.trim() ?? "",
                ...Array.from(item.querySelectorAll("dd")).map(
                  (dd) => dd.textContent?.trim() ?? "",
                ),
              ]);
          return {
            title,
            note: "Dados exibidos com os filtros e a página atuais. Valores em reais.",
            columns: table ? (rows.shift() ?? []) : ["Indicador", "Valor", "Observação"],
            rows,
          };
        }}
      />
      <div ref={ref}>{children}</div>
    </div>
  );
}
