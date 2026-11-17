import { describe, expect, it, vi } from "vitest";
import { bankCents, bankMonth, bankRows, bankBalances, bankJson } from "./sicoob";

const movement = {
  transactionId: "bank-id-1",
  tipo: "CREDITO",
  valor: "120.25",
  data: "2026-11-04T10:32",
  descricao: "Recebimento",
  descInfComplementar: "",
};
describe("Sicoob import", () => {
  it("rejects redirects instead of forwarding credentials to another host", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://other.example.test" },
      }),
    );
    await expect(bankJson({ fetch }, "https://bank.example.test", {})).rejects.toMatchObject({
      code: "http_302",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].redirect).toBe("manual");
  });
  it("uses exact integer cents and preserves two payments with equal date and amount", () => {
    const rows = bankRows(
      { resultado: { transacoes: [movement, { ...movement, transactionId: "bank-id-2" }] } },
      "2026-11",
    );
    expect(rows.map((r) => r.amount_cents)).toEqual([12025, 12025]);
    expect(
      bankRows({ resultado: { transacoes: [{ ...movement, tipo: "DEBITO" }] } }, "2026-11")[0]
        .amount_cents,
    ).toBe(-12025);
    expect(bankCents("0.29")).toBe(29);
    expect(bankCents("-12.01")).toBe(-1201);
  });
  it("rejects incomplete responses, unknown directions, duplicate IDs and invalid dates", () => {
    for (const rows of [
      [movement, movement],
      [{ ...movement, tipo: "UNKNOWN" }],
      [{ ...movement, data: "2026-11-31" }],
      [{ ...movement, data: "2026-10-01" }],
      [{ ...movement, valor: "0" }],
    ])
      expect(() => bankRows({ resultado: { transacoes: rows } }, "2026-11")).toThrow();
    expect(() => bankRows({}, "2026-11")).toThrow();
    expect(bankRows({ resultado: { transacoes: [] } }, "2026-11")).toEqual([]);
    for (const value of [undefined, "1,25", "1.001", "NaN", "90071992547409.92"])
      expect(() => bankCents(value)).toThrow();
  });
  it("keeps credit limit and blocked values separate from the reported balance", () => {
    expect(
      bankBalances({ resultado: { saldo: "50.10", saldoLimite: "1000", saldoBloqueado: "5" } }),
    ).toEqual([
      { kind: "ledger", amount_cents: 5010 },
      { kind: "blocked", amount_cents: 500 },
      { kind: "credit_limit", amount_cents: 100000 },
    ]);
    expect(() => bankBalances({ resultado: { saldo: "50" } })).toThrow();
  });
  it("uses São Paulo's calendar and the proper end of a closed month", () => {
    expect(bankMonth("2026-11", new Date("2026-11-18T01:00:00Z"))).toEqual({
      from: "2026-11-01",
      through: "2026-11-17",
    });
    expect(bankMonth("2024-02", new Date("2026-11-17T12:00:00Z")).through).toBe("2024-02-29");
    expect(() => bankMonth("2026-12", new Date("2026-11-17"))).toThrow();
  });
});
