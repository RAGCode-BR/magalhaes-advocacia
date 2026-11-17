export type BoletoPayer = {
  numeroCpfCnpj: string;
  nome: string;
  endereco: string;
  bairro: string;
  cidade: string;
  cep: string;
  uf: string;
};
export function validDocument(value: string): boolean {
  if (!/^\d{11}$|^\d{14}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const base = value.length - 2;
  const digit = (s: string) => {
    const sum = [...s].reduce(
      (total, n, i) =>
        total + Number(n) * (value.length === 11 ? s.length + 1 - i : ((s.length - 1 - i) % 8) + 2),
      0,
    );
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  return (
    digit(value.slice(0, base)) === Number(value[base]) &&
    digit(value.slice(0, base + 1)) === Number(value[base + 1])
  );
}
export function boletoPayer(input: unknown): BoletoPayer {
  const p = input as Partial<BoletoPayer> | null;
  const text = (key: keyof BoletoPayer, max: number, label: string) => {
    const value = typeof p?.[key] === "string" ? p[key]!.trim() : "";
    if (!value || value.length > max || /[\u0000-\u001f]/.test(value))
      throw new Error(`Revise ${label} do pagador (até ${max} caracteres).`);
    return value;
  };
  const document = text("numeroCpfCnpj", 18, "o CPF/CNPJ").replace(/[.\-/\s]/g, "");
  if (!validDocument(document)) throw new Error("Informe um CPF ou CNPJ válido do pagador.");
  const cep = text("cep", 9, "o CEP").replace("-", "");
  const uf = text("uf", 2, "a UF").toUpperCase();
  if (
    !/^\d{8}$/.test(cep) ||
    !"AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO"
      .split(" ")
      .includes(uf)
  )
    throw new Error("Revise o CEP e a UF do pagador.");
  return {
    numeroCpfCnpj: document,
    nome: text("nome", 50, "o nome"),
    endereco: text("endereco", 40, "o endereço"),
    bairro: text("bairro", 30, "o bairro"),
    cidade: text("cidade", 40, "a cidade"),
    cep,
    uf,
  };
}
export type BoletoIntent = {
  id: string;
  lease: string;
  reference: string;
  amount_cents: number;
  due_date: string;
  species: string;
  payer: BoletoPayer;
  bank_data: Record<string, unknown>;
  state: string;
};
export function boletoRequest(
  b: BoletoIntent,
  beneficiary: string,
  account: string,
  today: string,
) {
  if (
    !/^\d+$/.test(beneficiary) ||
    !/^\d+$/.test(account) ||
    !Number.isSafeInteger(Number(beneficiary)) ||
    !Number.isSafeInteger(Number(account))
  )
    throw new Error("Beneficiário Sicoob não configurado.");
  if (!Number.isInteger(b.amount_cents) || b.amount_cents <= 0 || b.amount_cents > 2147483647)
    throw new Error("Valor do boleto inválido.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(b.due_date) ||
    !Number.isFinite(Date.parse(b.due_date)) ||
    new Date(b.due_date).toISOString().slice(0, 10) !== b.due_date ||
    b.due_date < today
  )
    throw new Error("O vencimento precisa ser hoje ou uma data futura.");
  if (!/^[A-Za-z0-9]{1,18}$/.test(b.reference) || !["DS", "RC", "FAT", "OU"].includes(b.species))
    throw new Error("Identificação do boleto inválida.");
  return {
    numeroCliente: Number(beneficiary),
    codigoModalidade: 1,
    numeroContaCorrente: Number(account),
    codigoEspecieDocumento: b.species,
    seuNumero: b.reference,
    identificacaoEmissaoBoleto: 1,
    identificacaoDistribuicaoBoleto: 2,
    valor: b.amount_cents / 100,
    dataVencimento: b.due_date,
    tipoDesconto: 0,
    tipoMulta: 0,
    tipoJurosMora: 3,
    numeroParcela: 1,
    codigoNegativacao: 3,
    codigoProtesto: 3,
    gerarPdf: false,
    pagador: boletoPayer(b.payer),
  };
}
