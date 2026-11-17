import { describe, it, expect, vi } from "vitest";
import { boletoPayer, boletoRequest, validDocument } from "../../src/lib/sicoob-boleto";
import { boletoResult, boletoPdf, issueBoleto } from "./boletos";
const payer = {
  nome: "Cliente Exemplo",
  numeroCpfCnpj: "52998224725",
  endereco: "Rua Exemplo 10",
  bairro: "Centro",
  cidade: "Cuiabá",
  cep: "78000000",
  uf: "MT",
};
const intent = {
  id: "id",
  lease: "lease",
  reference: "M12345678901234567",
  amount_cents: 10101,
  due_date: "2099-12-01",
  species: "RC",
  payer,
  bank_data: {},
  state: "issuing",
};
const result = {
  resultado: {
    numeroCliente: 1,
    codigoModalidade: 1,
    nossoNumero: 123,
    seuNumero: intent.reference,
    valor: 101.01,
    pagador: payer,
    linhaDigitavel: "1".repeat(47),
    codigoBarras: "2".repeat(44),
    situacaoBoleto: "Em Aberto",
  },
};
function env(response: () => Promise<Response>) {
  return {
    SICOOB_CLIENT_ID: crypto.randomUUID(),
    SICOOB_ACCOUNT: "42",
    SICOOB_BENEFICIARY: "1",
    BANK_CONNECTION_ID: "connection",
    BANK_DATABASE_URL: "unused",
    SICOOB_CERT: {
      fetch: vi.fn(async (url: string) =>
        url.includes("openid-connect")
          ? Response.json({
              access_token: "private-token",
              scope: "boletos_inclusao boletos_consulta",
              expires_in: 300,
            })
          : response(),
      ),
    },
  };
}
function db(claimed = true) {
  return {
    query: vi.fn(async (sql: string) =>
      sql.includes("_claim")
        ? { rows: [{ result: { claimed, state: "uncertain", boleto: intent } }] }
        : { rows: [] },
    ),
  } as any;
}
describe("Sicoob boletos", () => {
  it("validates CPF/CNPJ, address and document fields", () => {
    expect(validDocument("52998224725")).toBe(true);
    expect(validDocument("11222333000181")).toBe(true);
    expect(validDocument("11111111111")).toBe(false);
    expect(validDocument("52998224726")).toBe(false);
    expect(boletoPayer({ ...payer, numeroCpfCnpj: "529.982.247-25", cep: "78000-000" })).toEqual(
      payer,
    );
    expect(() => boletoPayer({ ...payer, uf: "XX" })).toThrow();
    expect(() => boletoPayer({ ...payer, endereco: "" })).toThrow();
  });
  it("builds v3 payload without optional nulls, penalty or bank distribution", () => {
    const body = boletoRequest(intent, "1", "42", "2026-11-17");
    expect(body.valor).toBe(101.01);
    expect(body.identificacaoDistribuicaoBoleto).toBe(2);
    expect(body.codigoProtesto).toBe(3);
    expect(body.codigoNegativacao).toBe(3);
    expect(body.tipoMulta).toBe(0);
    expect(body.tipoJurosMora).toBe(3);
    expect(body).not.toHaveProperty("numeroContratoCobranca");
    expect(body).not.toHaveProperty("nossoNumero");
    expect(body).not.toHaveProperty("email");
    expect(() =>
      boletoRequest({ ...intent, due_date: "2026-02-30" }, "1", "42", "2026-01-01"),
    ).toThrow();
    expect(() =>
      boletoRequest({ ...intent, amount_cents: 1.5 }, "1", "42", "2026-01-01"),
    ).toThrow();
  });
  it("matches the reference, beneficiary, payer and amount before linking", () => {
    expect(boletoResult(result, intent, "1").nossoNumero).toBe("123");
    for (const changed of [
      { numeroCliente: 2 },
      { valor: 100 },
      { seuNumero: "wrong" },
      { pagador: { numeroCpfCnpj: "11222333000181" } },
    ])
      expect(() =>
        boletoResult({ resultado: { ...result.resultado, ...changed } }, intent, "1"),
      ).toThrow();
  });
  it("accepts PDF only and rejects missing, oversized or HTML payloads", () => {
    expect(
      boletoPdf({ resultado: { pdfBoleto: btoa("%PDF-1.4\nExample") } }).length,
    ).toBeGreaterThan(5);
    expect(() => boletoPdf({ resultado: { pdfBoleto: btoa("<html>oops") } })).toThrow();
    expect(() => boletoPdf({})).toThrow();
  });
  it("never resends an intent that was already claimed", async () => {
    const e = env(async () => Response.json(result)),
      d = db(false);
    expect(await issueBoleto(d, e, "id")).toEqual({ state: "uncertain", repeated: true });
    expect(e.SICOOB_CERT.fetch.mock.calls.filter((c) => c[0].includes("/v3/boletos"))).toHaveLength(
      0,
    );
  });
  it("persists a successful issue once and omits PDF from database", async () => {
    const e = env(async () => Response.json({ ...result, extra: "private" })),
      d = db();
    expect(await issueBoleto(d, e, "id")).toEqual({ state: "issued" });
    const finish = d.query.mock.calls.find((c: any) => c[0].includes("_finish"));
    expect(finish[0]).toContain("'issued'");
    expect(finish[1][2]).not.toContain("pdfBoleto");
    const call = e.SICOOB_CERT.fetch.mock.calls.find((c) => c[0].includes("/v3/boletos"));
    expect(call).toBeTruthy();
  });
  it("keeps timeouts and 5xx uncertain; explicit validation refusal can be revised", async () => {
    for (const [response, state] of [
      [
        async () => {
          throw Error("network");
        },
        "uncertain",
      ],
      [async () => new Response("", { status: 500 }), "uncertain"],
      [async () => new Response("", { status: 400 }), "rejected"],
    ] as const) {
      const e = env(response),
        d = db();
      await expect(issueBoleto(d, e, "id")).rejects.toMatchObject({ code: state });
      expect(d.query.mock.calls.find((c: any) => c[0].includes("_finish"))[1][2]).toBe(state);
      expect(
        e.SICOOB_CERT.fetch.mock.calls.filter((c) => c[0].includes("/v3/boletos")),
      ).toHaveLength(1);
    }
  });
  it("does not mark ambiguous issuance as rejected when persistence fails", async () => {
    const e = env(async () => Response.json(result)),
      d = db();
    d.query.mockImplementation(async (sql: string) => {
      if (sql.includes("_claim")) return { rows: [{ result: { claimed: true, boleto: intent } }] };
      throw Error("database unavailable");
    });
    await expect(issueBoleto(d, e, "id")).rejects.toMatchObject({ code: "uncertain" });
  });
});
