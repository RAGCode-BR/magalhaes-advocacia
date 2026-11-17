import { describe, expect, it } from "vitest";
import { buildContaAzulPlan, cents } from "./contaazul-plan.mjs";
import { contaAzulFixture } from "./contaazul-fixture.mjs";

describe("Conta Azul import plan", () => {
  it("preserves multiple payments, adjustments, a discarded title and both transfer legs without duplicate entries", () => {
    const { books, audit } = contaAzulFixture();
    const p = buildContaAzulPlan(books, audit);
    expect(p.entries).toHaveLength(3);
    expect(p.settlements).toHaveLength(3);
    expect(p.transfers).toHaveLength(1);
    expect(p.summary.totals.income).toEqual({
      count: 2,
      original: 15000,
      principal: 7000,
      cash: 7000,
      pending: 3000,
    });
    expect(p.summary.totals.expense).toEqual({
      count: 1,
      original: 2000,
      principal: 2000,
      cash: 1500,
      pending: 0,
    });
    expect(p.settlements[0]).toMatchObject({
      principal_cents: 4000,
      interest_cents: 500,
      amount_cents: 4500,
      source_reconciled: true,
    });
    expect(p.transfers[0]).toMatchObject({
      from_name: "Conta A",
      to_name: "Conta B",
      amount_cents: 10000,
      source_from_reconciled: true,
    });
    expect(buildContaAzulPlan(books, audit).batchId).toBe(p.batchId);
  });
  it("fails closed for changed files, unconsumed or reused rows, or money that does not balance", () => {
    {
      const { books, audit } = contaAzulFixture();
      books[0].sha256 = "changed";
      expect(() => buildContaAzulPlan(books, audit)).toThrow();
    }
    {
      const { books, audit } = contaAzulFixture();
      audit.statement.matching.receivable.row_mapping[2].push(4);
      expect(() => buildContaAzulPlan(books, audit)).toThrow();
    }
    {
      const { books, audit } = contaAzulFixture();
      books[2].rows[3].L = "44";
      expect(() => buildContaAzulPlan(books, audit)).toThrow();
    }
    {
      const { books, audit } = contaAzulFixture();
      audit.statement.matching.receivable.row_mapping[2].pop();
      expect(() => buildContaAzulPlan(books, audit)).toThrow();
    }
  });
  it("parses integer cents exactly and rejects excess precision and invalid dates", () => {
    expect(cents("1428.74")).toBe(142874);
    expect(cents("-0.01")).toBe(-1);
    expect(() => cents("1.001")).toThrow();
    const { books, audit } = contaAzulFixture();
    books[0].rows[1].E = "31/02/2026";
    expect(() => buildContaAzulPlan(books, audit)).toThrow();
  });
});
