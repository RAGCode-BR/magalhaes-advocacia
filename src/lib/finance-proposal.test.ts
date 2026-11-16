import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultExclusions,
  defaultHighlights,
  defaultScope,
  proposalClients,
  proposalFeeCaption,
  proposalInstallments,
  proposalItem,
  proposalLedgerCents,
  proposalMoneyCents,
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

// Assessoria mensal para duas empresas, no formato das propostas reais do escritório.
const retainer: ProposalDocument = {
  ...sample,
  title: "Assessoria jurídica empresarial mensal",
  area: "Empresarial e societário",
  practice: "consultivo",
  context:
    "Esta proposta coloca uma advogada à disposição da empresa para que cada decisão seja tomada com segurança, antes de virar problema.",
  scope: [
    "Dúvidas e orientações do dia a dia: atendimento sempre que surgir uma demanda, sem limite de consultas",
    "Trabalhista: contratações, escalas, banco de horas, advertências, rescisões e acordos",
    "Contratos: elaboração e revisão de contratos com clientes, fornecedores e parceiros",
    "Reuniões: presenciais ou on-line, além de WhatsApp, e-mail e telefone",
  ],
  exclusions: ["Processos judiciais, cobrados à parte conforme a cláusula própria"],
  fee_model: "monthly",
  amount_cents: 324200,
  periods: 12,
  success_percent: null,
  issued_city: "Juara/MT",
  other_clients: [
    { name: "Empresa Exemplo Filial", document: "00.000.000/0002-00", address: "Juína/MT" },
  ],
  minimum_wages: 2,
  minimum_wage_cents: 162100,
  fee_note: "atende as duas empresas juntas",
  judicial_fees: [
    {
      title: "Cobrança judicial de dívidas",
      basis: "Somente se houver êxito, sobre o valor efetivamente recebido.",
      percent: 20,
    },
    { title: "Defesa em reclamação trabalhista", basis: "Somente se houver êxito.", percent: 20 },
  ],
  highlights: defaultHighlights,
  options: [
    { title: "Matriz", description: "Inclusão nas mesmas condições.", amount_cents: 220000 },
  ],
};

describe("proposta de honorários", () => {
  it("monta mensalidade em salários mínimos para várias empresas", () => {
    expect(proposalMoneyCents("3.242,00")).toBe(324200);
    expect(proposalMoneyCents("R$ 2200")).toBe(220000);
    expect(proposalFeeCaption(retainer)).toBe("2 salários mínimos por mês");
    expect(proposalLedgerCents(retainer)).toBe(324200 * 12);
    expect(proposalInstallments(retainer)[0].amount_cents).toBe(324200);
    expect(proposalClients(retainer).map((c) => c.name)).toEqual([
      "Empresa Exemplo Ltda.",
      "Empresa Exemplo Filial",
    ]);
    expect(proposalItem("Trabalhista: rescisões")).toEqual({
      title: "Trabalhista",
      text: "rescisões",
    });
    expect(proposalItem("Análise do caso")).toEqual({ title: null, text: "Análise do caso" });
  });

  it("gera o PDF da assessoria mensal com processos à parte e ampliação", async () => {
    const pdf = await buildProposalPdf(retainer);
    expect(pdf.getNumberOfPages()).toBeGreaterThan(1);
    if (process.env.PROPOSAL_RETAINER_OUT)
      writeFileSync(process.env.PROPOSAL_RETAINER_OUT, Buffer.from(pdf.output("arraybuffer")));
  });

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
