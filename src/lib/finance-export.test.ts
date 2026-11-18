import { expect, it } from "vitest";
import { escapeReport, printFinance } from "./finance-export";
it("escapes financial descriptions in printable reports", () => {
  expect(escapeReport('<script>"&')).toBe('&lt;script&gt;&quot;&amp;');
  let html = "";
  const popup = { document: { write: (text: string) => { html = text; }, close() {} }, focus() {}, print() {} };
  printFinance({ title: "Extrato", note: "Saldo atual, consulta 18/11", columns: ["Descrição", "Valor"], rows: [["<img onerror=alert(1)>", 12.34]] }, popup as unknown as Window);
  expect(html).toContain("&lt;img onerror=alert(1)&gt;");
  expect(html).toContain("12.34");
  expect(html).toContain("Saldo atual, consulta 18/11");
  expect(html).toContain("thead{display:table-header-group}");
});
