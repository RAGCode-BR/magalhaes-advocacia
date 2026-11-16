import { addDays, format, parseISO } from "date-fns";
import { financeCents, financeInstallments } from "./office-finance";

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
export type ProposalFeeModel = "fixed" | "fixed_success" | "monthly";
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

/** Processo judicial cobrado à parte (ex.: cobrança judicial, 20% no êxito). */
export type ProposalJudicialFee = { title: string; basis: string; percent: number | null };
/** Argumento de venda em destaque (ex.: Proximidade, Com nota fiscal). */
export type ProposalHighlight = { title: string; text: string };
/** Ampliação opcional que o cliente pode incluir (ex.: outra unidade). */
export type ProposalOption = { title: string; description: string; amount_cents: number };

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
  /** Campos opcionais acrescentados depois; propostas antigas não os têm. */
  issued_city?: string | null;
  other_clients?: ProposalParty[];
  /** Mensalidade expressa em salários mínimos (ex.: 2), com o valor do salário usado. */
  minimum_wages?: number | null;
  minimum_wage_cents?: number | null;
  fee_caption?: string | null;
  fee_note?: string | null;
  judicial_fees?: ProposalJudicialFee[];
  highlights_title?: string | null;
  highlights?: ProposalHighlight[];
  options?: ProposalOption[];
};

/** Salário mínimo nacional de 2026, usado como sugestão no formulário. */
export const minimumWageCents = 162100;

export const proposalFeeModels: Record<ProposalFeeModel, { label: string; hint: string }> = {
  fixed: { label: "Valor fixo", hint: "Honorários definidos, à vista ou parcelados." },
  fixed_success: {
    label: "Fixo + êxito",
    hint: "Valor inicial mais percentual sobre o resultado.",
  },
  monthly: {
    label: "Mensalidade",
    hint: "Assessoria com valor mensal fixo, inclusive em salários mínimos.",
  },
};

export const defaultHighlights: ProposalHighlight[] = [
  {
    title: "Proximidade",
    text: "Escritório em Juara: reuniões presenciais, documentos analisados com agilidade e resposta rápida pelo WhatsApp.",
  },
  {
    title: "Advogada e contadora",
    text: "OAB/MT 37.449 e CRC/MT 020747/O-5: cada orientação já considera o efeito jurídico, trabalhista e tributário.",
  },
  {
    title: "Com nota fiscal",
    text: "Honorários faturados com nota fiscal, dedutíveis como despesa operacional no Lucro Real (Decreto nº 9.580/2018, art. 311).",
  },
];

/** Valor digitado em reais; aceita separador de milhar ("3.242,00"). */
export function proposalMoneyCents(value: string) {
  const clean = value.replace(/^\s*R\$\s*/i, "").trim();
  return financeCents(clean.includes(",") ? clean.replace(/\./g, "") : clean);
}

/** Todas as contratantes: a principal e as demais empresas ou unidades. */
export function proposalClients(doc: Pick<ProposalDocument, "client" | "other_clients">) {
  return [doc.client, ...(doc.other_clients ?? []).filter((party) => party.name?.trim())];
}

/** "Título: descrição" vira serviço com nome em destaque; sem dois-pontos, só texto. */
export function proposalItem(line: string): { title: string | null; text: string } {
  const match = /^([^:]{2,70}):\s+(.+)$/.exec(line.trim());
  return match
    ? { title: match[1].trim(), text: match[2].trim() }
    : { title: null, text: line.trim() };
}

/** Valor mensal da proposta (na mensalidade, amount_cents já é o valor de um mês). */
export function proposalMonthlyCents(doc: Pick<ProposalDocument, "fee_model" | "amount_cents">) {
  return doc.fee_model === "monthly" ? doc.amount_cents : null;
}

/** Total lançado no financeiro: na mensalidade, valor do mês vezes os meses previstos. */
export function proposalLedgerCents(
  doc: Pick<ProposalDocument, "fee_model" | "amount_cents" | "periods">,
) {
  return doc.fee_model === "monthly" ? doc.amount_cents * doc.periods : doc.amount_cents;
}

export function proposalFeeCaption(
  doc: Pick<ProposalDocument, "fee_model" | "fee_caption" | "minimum_wages">,
) {
  if (doc.fee_caption?.trim()) return doc.fee_caption.trim();
  if (doc.minimum_wages) {
    const n = String(doc.minimum_wages).replace(".", ",");
    const unit = doc.minimum_wages === 1 ? "salário mínimo" : "salários mínimos";
    return `${n} ${unit}${doc.fee_model === "monthly" ? " por mês" : ""}`;
  }
  return null;
}

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
  return financeInstallments(proposalLedgerCents(doc), doc.periods, doc.first_due);
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
