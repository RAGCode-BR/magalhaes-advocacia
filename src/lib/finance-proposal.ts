import { addDays, format, parseISO } from "date-fns";
import { financeInstallments } from "./office-finance";

/**
 * Proposta de honorários advocatícios.
 *
 * A estrutura segue a praxe das propostas de escritório (Código de Ética e
 * Disciplina da OAB, arts. 48 a 50; Lei 8.906/1994, arts. 22 e 23): partes,
 * objeto, escopo, o que não está incluído, honorários e forma de pagamento,
 * condições gerais, validade e aceite. O documento é salvo como cópia no
 * orçamento e no lead do CRM, para que o PDF seja sempre o mesmo.
 */

export type ProposalPractice = "contencioso" | "consultivo";
export type ProposalFeeModel = "fixed" | "fixed_success";
export type ProposalPayment = "pix" | "boleto" | "transfer" | "card";

export type ProposalParty = {
  name: string;
  legal_name?: string | null;
  document?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  responsible?: string | null;
};

export type ProposalDocument = {
  version: 1;
  number: string;
  issued_on: string;
  validity_days: number;
  title: string;
  area: string;
  practice: ProposalPractice;
  process_title?: string | null;
  context?: string | null;
  scope: string[];
  exclusions: string[];
  fee_model: ProposalFeeModel;
  amount_cents: number;
  periods: number;
  first_due: string;
  payment_method: ProposalPayment;
  success_percent?: number | null;
  notes?: string | null;
  client: ProposalParty;
  contact_email?: string | null;
  contact_phone?: string | null;
};

export const proposalAreas = [
  "Cível",
  "Trabalhista",
  "Tributário",
  "Empresarial e societário",
  "Contratos",
  "Família e sucessões",
  "Previdenciário",
  "Consumidor",
  "Imobiliário",
  "Criminal",
  "Administrativo",
] as const;

export const proposalPayments: Record<ProposalPayment, string> = {
  pix: "Pix",
  boleto: "Boleto bancário",
  transfer: "Transferência bancária",
  card: "Cartão de crédito",
};

export const defaultScope: Record<ProposalPractice, string[]> = {
  contencioso: [
    "Análise dos documentos e estudo da estratégia do caso",
    "Elaboração e protocolo da peça inicial ou da defesa",
    "Acompanhamento do processo em primeira instância",
    "Participação nas audiências designadas",
    "Recursos e contrarrazões no tribunal de segunda instância",
    "Relatórios periódicos sobre o andamento do processo",
  ],
  consultivo: [
    "Reunião inicial para levantamento das necessidades",
    "Análise dos documentos e da situação apresentada",
    "Elaboração de parecer jurídico com recomendações",
    "Revisão ou redação das minutas necessárias",
    "Reunião de apresentação das conclusões",
  ],
};

export const defaultExclusions = [
  "Custas judiciais, taxas, emolumentos e demais despesas processuais",
  "Honorários de perito e de assistente técnico",
  "Deslocamentos fora da comarca, cópias, certidões e autenticações",
  "Recursos aos Tribunais Superiores (STJ e STF)",
  "Demandas, incidentes ou procedimentos não descritos no objeto",
];

/** Linhas de um campo de texto, sem marcadores e sem linhas vazias. */
export function proposalLines(value: string, max = 20) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, max)
    .map((line) => line.slice(0, 300));
}

/** Número curto e estável a partir do identificador do orçamento. */
export function proposalNumber(id: string, issuedOn: string) {
  return `${issuedOn.slice(0, 4)}-${id.replace(/-/g, "").slice(0, 5).toUpperCase()}`;
}

export function proposalValidUntil(doc: Pick<ProposalDocument, "issued_on" | "validity_days">) {
  return format(addDays(parseISO(doc.issued_on), doc.validity_days), "yyyy-MM-dd");
}

export function proposalInstallments(doc: ProposalDocument) {
  return financeInstallments(doc.amount_cents, doc.periods, doc.first_due);
}

type ClientLike = {
  name: string;
  legal_name?: string | null;
  cnpj?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  responsible?: string | null;
};

export function proposalParty(client: ClientLike | undefined | null): ProposalParty {
  return {
    name: client?.name ?? "Cliente",
    legal_name: client?.legal_name || null,
    document: client?.cnpj || null,
    address: client?.address || null,
    email: client?.email || null,
    phone: client?.phone || null,
    responsible: client?.responsible || null,
  };
}

/**
 * Orçamentos criados antes da proposta estruturada ainda geram PDF: os dados
 * do financeiro preenchem a proposta com o escopo e as exclusões padrão.
 */
export function proposalFromAgreement(
  agreement: {
    id: string;
    description: string;
    amount_cents: number;
    periods: number;
    first_due: string;
    notes: string | null;
    proposal?: unknown;
  },
  client: ClientLike | undefined | null,
  issuedOn: string,
  processTitle?: string | null,
): ProposalDocument {
  const saved = agreement.proposal as Partial<ProposalDocument> | null | undefined;
  if (saved && saved.version === 1 && Array.isArray(saved.scope)) return saved as ProposalDocument;
  return {
    version: 1,
    number: proposalNumber(agreement.id, issuedOn),
    issued_on: issuedOn,
    validity_days: 15,
    title: agreement.description,
    area: "Cível",
    practice: "contencioso",
    process_title: processTitle ?? null,
    context: null,
    scope: defaultScope.contencioso,
    exclusions: defaultExclusions,
    fee_model: "fixed",
    amount_cents: agreement.amount_cents,
    periods: agreement.periods,
    first_due: agreement.first_due,
    payment_method: "pix",
    success_percent: null,
    notes: agreement.notes,
    client: proposalParty(client),
  };
}

export function proposalFileName(doc: ProposalDocument) {
  const slug = doc.client.name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 40);
  return `proposta-${doc.number}${slug ? `-${slug}` : ""}.pdf`;
}
