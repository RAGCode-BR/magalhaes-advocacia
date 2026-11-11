import type { jsPDF as JsPdf } from "jspdf";
import goldLogoUrl from "@/assets/magalhaes-logo-gold.png";
import {
  proposalFileName,
  proposalInstallments,
  proposalPayments,
  proposalValidUntil,
  type ProposalDocument,
} from "./finance-proposal";

type Rgb = [number, number, number];
const wine: Rgb = [89, 27, 32];
const wineDeep: Rgb = [59, 16, 20];
const gold: Rgb = [221, 188, 112];
const goldInk: Rgb = [150, 112, 44];
const ink: Rgb = [48, 27, 29];
const muted: Rgb = [121, 98, 104];
const paper: Rgb = [251, 246, 240];
const hairline: Rgb = [231, 217, 211];

const page = { width: 210, height: 297, margin: 22, top: 50, bottom: 24 };
const firm = "Magalhães Advocacia & Assessoria Jurídica";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (cents: number) => money.format(cents / 100);
const date = (iso: string) => iso.split("-").reverse().join("/");

async function dataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Logo indisponível");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(binary)}`;
}

class Writer {
  y = page.top;
  constructor(
    readonly pdf: JsPdf,
    readonly doc: ProposalDocument,
    readonly logo: string | null,
  ) {
    this.letterhead(true);
  }
  get width() {
    return page.width - page.margin * 2;
  }
  color(rgb: Rgb) {
    this.pdf.setTextColor(...rgb);
  }
  font(style: "normal" | "bold" | "italic", size: number, family = "helvetica") {
    this.pdf.setFont(family, style);
    this.pdf.setFontSize(size);
  }
  letterhead(first: boolean) {
    const { pdf } = this;
    const band = first ? 38 : 22;
    pdf.setFillColor(...wineDeep);
    pdf.rect(0, 0, page.width, band, "F");
    pdf.setFillColor(...wine);
    pdf.rect(0, 0, page.width, band - 1.6, "F");
    pdf.setFillColor(...gold);
    pdf.rect(0, band - 0.6, page.width, 0.6, "F");
    if (this.logo) {
      const h = first ? 27 : 15;
      pdf.addImage(this.logo, "PNG", page.margin - 3, (band - h) / 2, h * (825 / 385), h);
    }
    this.font("normal", first ? 8.5 : 7.5);
    pdf.setTextColor(...gold);
    pdf.setCharSpace(0.6);
    pdf.text("PROPOSTA DE HONORÁRIOS", page.width - page.margin, first ? 17 : 10, {
      align: "right",
    });
    pdf.setCharSpace(0);
    this.font("bold", first ? 13 : 9);
    pdf.setTextColor(255, 249, 237);
    pdf.text(`Nº ${this.doc.number}`, page.width - page.margin, first ? 24.5 : 15.5, {
      align: "right",
    });
    this.y = first ? page.top : 34;
  }
  ensure(height: number) {
    if (this.y + height <= page.height - page.bottom) return;
    this.pdf.addPage();
    this.letterhead(false);
  }
  lines(text: string, size: number, width = this.width) {
    this.pdf.setFontSize(size);
    return this.pdf.splitTextToSize(text, width) as string[];
  }
  paragraph(text: string, options: { size?: number; color?: Rgb; gap?: number; x?: number } = {}) {
    const size = options.size ?? 10;
    const x = options.x ?? page.margin;
    const leading = size * 0.5;
    this.font("normal", size);
    this.color(options.color ?? ink);
    for (const line of this.lines(text, size, page.width - page.margin - x)) {
      this.ensure(leading);
      this.pdf.text(line, x, this.y);
      this.y += leading;
    }
    this.y += options.gap ?? 2;
  }
  heading(index: number, title: string) {
    // Keep the heading with at least two lines of its clause.
    this.ensure(34);
    this.y += 4;
    this.font("bold", 9, "times");
    this.color(goldInk);
    this.pdf.text(`CLÁUSULA ${index}`, page.margin, this.y);
    this.y += 5.6;
    this.font("bold", 13.5, "times");
    this.color(wine);
    this.pdf.text(title, page.margin, this.y);
    this.y += 2.6;
    this.pdf.setDrawColor(...gold);
    this.pdf.setLineWidth(0.35);
    this.pdf.line(page.margin, this.y, page.margin + 14, this.y);
    this.y += 6;
  }
  bullets(items: string[]) {
    for (const item of items) {
      const lines = this.lines(item, 10, this.width - 7);
      this.ensure(lines.length * 5 + 1);
      this.pdf.setFillColor(...gold);
      this.pdf.rect(page.margin + 1, this.y - 2.4, 1.6, 1.6, "F");
      this.font("normal", 10);
      this.color(ink);
      lines.forEach((line, i) => this.pdf.text(line, page.margin + 6, this.y + i * 5));
      this.y += lines.length * 5 + 1.4;
    }
    this.y += 1.5;
  }
}

function parties(w: Writer) {
  const { pdf, doc } = w;
  const gap = 6;
  const col = (w.width - gap) / 2;
  const client = doc.client;
  const left = [
    client.legal_name && client.legal_name !== client.name ? client.legal_name : null,
    client.document ? `CNPJ/CPF ${client.document}` : null,
    client.address,
    [doc.contact_email || client.email, doc.contact_phone || client.phone]
      .filter(Boolean)
      .join("  |  ") || null,
    client.responsible ? `Responsável: ${client.responsible}` : null,
  ].filter(Boolean) as string[];
  const right = ["Sociedade de advogados", "Atendimento consultivo e contencioso"];
  const measure = (name: string, rows: string[]) =>
    w.lines(name, 11.5, col - 10).length * 5.5 +
    rows.reduce((h, row) => h + w.lines(row, 8.8, col - 10).length * 4.2, 0);
  const height = Math.max(measure(client.name, left), measure(firm, right)) + 17;
  w.ensure(height);
  const box = (x: number, label: string, name: string, rows: string[]) => {
    pdf.setFillColor(...paper);
    pdf.setDrawColor(...hairline);
    pdf.setLineWidth(0.25);
    pdf.roundedRect(x, w.y, col, height, 1.5, 1.5, "FD");
    pdf.setFillColor(...gold);
    pdf.rect(x, w.y, 1.1, height, "F");
    let y = w.y + 7;
    w.font("bold", 7.5);
    w.color(goldInk);
    pdf.setCharSpace(0.5);
    pdf.text(label, x + 6, y);
    pdf.setCharSpace(0);
    y += 6;
    w.font("bold", 11.5, "times");
    w.color(wine);
    for (const line of w.lines(name, 11.5, col - 10)) {
      pdf.text(line, x + 6, y);
      y += 5.5;
    }
    w.font("normal", 8.8);
    w.color(muted);
    for (const row of rows)
      for (const line of w.lines(row, 8.8, col - 10)) {
        pdf.text(line, x + 6, y);
        y += 4.2;
      }
  };
  box(page.margin, "CONTRATANTE", client.name, left);
  box(page.margin + col + gap, "CONTRATADO", firm, right);
  w.y += height + 4;
}

function fees(w: Writer) {
  const { pdf, doc } = w;
  const installments = proposalInstallments(doc);
  const rows = Math.min(installments.length, 12);
  const height = 30 + rows * 6 + (installments.length > rows ? 6 : 0);
  w.ensure(height + 6);
  pdf.setFillColor(...wine);
  pdf.roundedRect(page.margin, w.y, w.width, 24, 1.5, 1.5, "F");
  w.font("normal", 8.5);
  pdf.setTextColor(...gold);
  pdf.text(
    doc.fee_model === "fixed_success"
      ? "Honorários iniciais (pro labore)"
      : "Honorários contratuais",
    page.margin + 7,
    w.y + 8.5,
  );
  w.font("bold", 21, "times");
  pdf.setTextColor(255, 249, 237);
  pdf.text(brl(doc.amount_cents), page.margin + 7, w.y + 18.5);
  w.font("normal", 9);
  pdf.setTextColor(244, 229, 205);
  const plan =
    doc.periods === 1
      ? `À vista, em ${date(doc.first_due)}`
      : `${doc.periods} parcelas mensais a partir de ${date(doc.first_due)}`;
  pdf.text(plan, page.width - page.margin - 7, w.y + 10.5, { align: "right" });
  pdf.text(proposalPayments[doc.payment_method], page.width - page.margin - 7, w.y + 16.5, {
    align: "right",
  });
  w.y += 30;
  if (doc.periods > 1) {
    w.font("bold", 8);
    w.color(muted);
    pdf.text("Parcela", page.margin, w.y);
    pdf.text("Vencimento", page.margin + 40, w.y);
    pdf.text("Valor", page.width - page.margin, w.y, { align: "right" });
    w.y += 2;
    for (const item of installments.slice(0, rows)) {
      pdf.setDrawColor(...hairline);
      pdf.setLineWidth(0.2);
      pdf.line(page.margin, w.y, page.width - page.margin, w.y);
      w.y += 4.6;
      w.font("normal", 9.5);
      w.color(ink);
      pdf.text(`${item.installment}ª`, page.margin, w.y);
      pdf.text(date(item.due_date), page.margin + 40, w.y);
      pdf.text(brl(item.amount_cents), page.width - page.margin, w.y, { align: "right" });
      w.y += 1.4;
    }
    if (installments.length > rows) {
      w.y += 4.6;
      w.font("italic", 8.5);
      w.color(muted);
      pdf.text(
        `Demais ${installments.length - rows} parcelas no mesmo dia dos meses seguintes.`,
        page.margin,
        w.y,
      );
    }
    w.y += 8;
  }
  if (doc.fee_model === "fixed_success" && doc.success_percent) {
    w.paragraph(
      `Honorários de êxito: ${String(doc.success_percent).replace(".", ",")}% sobre o proveito econômico efetivamente obtido pelo contratante, devidos quando do recebimento. Somados aos honorários de sucumbência, não excederão a vantagem obtida pelo contratante (Código de Ética e Disciplina da OAB, art. 50).`,
    );
  }
}

function signatures(w: Writer) {
  const { pdf, doc } = w;
  w.ensure(46);
  w.y += 8;
  w.font("normal", 9.5);
  w.color(muted);
  pdf.text("Local e data: ______________________________, ____/____/________", page.margin, w.y);
  w.y += 24;
  const col = (w.width - 16) / 2;
  for (const [i, label, name] of [
    [0, "Contratante", doc.client.name],
    [1, "Contratado", firm],
  ] as const) {
    const x = page.margin + i * (col + 16);
    pdf.setDrawColor(...ink);
    pdf.setLineWidth(0.3);
    pdf.line(x, w.y, x + col, w.y);
    w.font("bold", 9.5);
    w.color(ink);
    pdf.text(w.lines(name, 9.5, col)[0], x, w.y + 5);
    w.font("normal", 8.5);
    w.color(muted);
    pdf.text(label, x, w.y + 9.5);
  }
  w.y += 14;
}

function footers(pdf: JsPdf, doc: ProposalDocument) {
  const total = pdf.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    pdf.setPage(i);
    const y = page.height - 12;
    pdf.setDrawColor(...gold);
    pdf.setLineWidth(0.3);
    pdf.line(page.margin, y - 4.5, page.width - page.margin, y - 4.5);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(...muted);
    pdf.text(`${firm}  |  Proposta nº ${doc.number}`, page.margin, y);
    pdf.text(`Página ${i} de ${total}`, page.width - page.margin, y, { align: "right" });
  }
}

/** Monta a proposta timbrada. Exportada separadamente para testes. */
export async function buildProposalPdf(doc: ProposalDocument) {
  const [{ jsPDF }, logo] = await Promise.all([
    import("jspdf"),
    dataUrl(goldLogoUrl).catch(() => null),
  ]);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  pdf.setProperties({
    title: `Proposta de honorários nº ${doc.number}`,
    subject: doc.title,
    author: firm,
  });
  const w = new Writer(pdf, doc, logo);

  w.font("normal", 9);
  w.color(muted);
  pdf.text(
    `Emitida em ${date(doc.issued_on)}  |  Válida até ${date(proposalValidUntil(doc))}`,
    page.margin,
    w.y,
  );
  w.y += 8;
  w.font("bold", 20, "times");
  w.color(wine);
  for (const line of w.lines(doc.title, 20)) {
    pdf.text(line, page.margin, w.y);
    w.y += 8.5;
  }
  w.font("normal", 10);
  w.color(goldInk);
  pdf.text(
    `${doc.area}  |  ${doc.practice === "consultivo" ? "Atuação consultiva" : "Atuação contenciosa"}`,
    page.margin,
    w.y,
  );
  w.y += 9;
  parties(w);

  let clause = 1;
  w.heading(clause++, "Objeto");
  w.paragraph(
    `Prestação de serviços advocatícios na área ${doc.area.toLocaleLowerCase("pt-BR")}, referente a: ${doc.title}${doc.process_title ? ` (${doc.process_title})` : ""}.`,
  );
  if (doc.context) w.paragraph(doc.context, { color: muted });

  w.heading(clause++, "Escopo dos serviços");
  w.paragraph("Estão incluídas nesta proposta as seguintes atividades:", { gap: 3 });
  w.bullets(doc.scope);

  if (doc.exclusions.length) {
    w.heading(clause++, "O que não está incluído");
    w.paragraph(
      "Não fazem parte dos honorários abaixo e, quando necessários, serão informados previamente ao contratante:",
      { gap: 3 },
    );
    w.bullets(doc.exclusions);
  }

  w.heading(clause++, "Honorários e forma de pagamento");
  fees(w);

  w.heading(clause++, "Condições gerais");
  w.bullets(
    [
      "Os honorários de sucumbência fixados judicialmente pertencem exclusivamente aos advogados (Lei 8.906/1994, art. 23) e não se compensam com os valores desta proposta.",
      "A advocacia é atividade de meio: o escritório se compromete a empregar a melhor técnica e diligência, sem garantia de resultado.",
      "Custas e despesas processuais são de responsabilidade do contratante e serão pagas diretamente ou reembolsadas mediante comprovação.",
      "As informações compartilhadas são protegidas pelo sigilo profissional.",
    ].concat(doc.notes ? [doc.notes] : []),
  );

  w.heading(clause++, "Validade e aceite");
  w.paragraph(
    `Esta proposta é válida por ${doc.validity_days} dias, até ${date(proposalValidUntil(doc))}. O aceite autoriza o início dos trabalhos, que serão formalizados em contrato de prestação de serviços advocatícios (Código de Ética e Disciplina da OAB, art. 48).`,
  );
  signatures(w);
  footers(pdf, doc);
  return pdf;
}

export async function downloadProposalPdf(doc: ProposalDocument) {
  const pdf = await buildProposalPdf(doc);
  pdf.save(proposalFileName(doc));
}
