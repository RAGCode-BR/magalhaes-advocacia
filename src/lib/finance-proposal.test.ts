import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultExclusions,
  defaultScope,
  proposalFileName,
  proposalFromAgreement,
  proposalLines,
  proposalNumber,
  proposalValidUntil,
  type ProposalDocument,
} from "./finance-proposal";
import { buildProposalPdf } from "./finance-proposal-pdf";

const sample: ProposalDocument = {
  version: 1,
  number: "2026-AB12C",
  issued_on: "2026-11-10",
  validity_days: 15,
  title: "Ação revisional de contrato bancário",
  area: "Cível",
  practice: "contencioso",
  process_title: null,
  context: "Cliente relata cobrança de juros acima da taxa média de mercado.",
  scope: defaultScope.contencioso,
  exclusions: defaultExclusions,
  fee_model: "fixed_success",
  amount_cents: 1250000,
  periods: 5,
  first_due: "2026-11-20",
  payment_method: "pix",
  success_percent: 15,
  notes: null,
  client: {
    name: "Empresa Exemplo Ltda.",
    document: "00.000.000/0001-00",
    email: "contato@exemplo.com",
  },
};

describe("proposta de honorários", () => {
  it("limpa marcadores e linhas vazias do escopo", () => {
    expect(proposalLines("- Análise\n\n2) Petição\n• Audiência\n  ")).toEqual([
      "Análise",
      "Petição",
      "Audiência",
    ]);
  });

  it("gera número e validade estáveis", () => {
    expect(proposalNumber("ab12cdef-0000-0000-0000-000000000000", "2026-11-10")).toBe("2026-AB12C");
    expect(proposalValidUntil(sample)).toBe("2026-11-25");
    expect(proposalFileName(sample)).toBe("proposta-2026-AB12C-empresa-exemplo-ltda.pdf");
  });

  it("usa a proposta salva ou monta uma padrão para orçamentos antigos", () => {
    const agreement = {
      id: "ab12cdef-0000",
      description: "Consulta",
      amount_cents: 50000,
      periods: 1,
      first_due: "2026-12-01",
      notes: null,
    };
    expect(proposalFromAgreement({ ...agreement, proposal: sample }, null, "2026-11-10")).toBe(
      sample,
    );
    const fallback = proposalFromAgreement(agreement, { name: "Cliente" }, "2026-11-10");
    expect(fallback.amount_cents).toBe(50000);
    expect(fallback.scope).toEqual(defaultScope.contencioso);
    expect(fallback.client.name).toBe("Cliente");
  });

  it("monta o PDF timbrado com várias páginas sem erro", async () => {
    if (process.env.PROPOSAL_PDF_OUT) {
      // Pré-visualização local: carrega o logo do disco no lugar do servidor Vite.
      const { readFileSync } = await import("node:fs");
      globalThis.fetch = (async (url: string) =>
        new Response(readFileSync(`.${String(url).split("?")[0]}`))) as typeof fetch;
    }
    const pdf = await buildProposalPdf({
      ...sample,
      periods: 18,
      scope: [...sample.scope, ...sample.scope],
    });
    expect(pdf.getNumberOfPages()).toBeGreaterThan(1);
    if (process.env.PROPOSAL_PDF_OUT)
      writeFileSync(process.env.PROPOSAL_PDF_OUT, Buffer.from(pdf.output("arraybuffer")));
  });
});
