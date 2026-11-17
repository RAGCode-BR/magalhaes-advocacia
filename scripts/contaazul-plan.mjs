import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const stableId = (value) => {
  const h = hash(`magalhaes/contaazul/v1/${value}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export const clean = (v) => (!v || v === "null" ? "" : String(v).trim());
export function cents(value) {
  const v = clean(value) || "0";
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v);
  assert(m, `Valor monetário inválido: ${v}`);
  assert(!m[3] || !/[1-9]/.test(m[3].slice(2)), "Valor com fração de centavo");
  const result =
    (Number(m[2]) * 100 + Number((m[3] || "").slice(0, 2).padEnd(2, "0"))) * (m[1] ? -1 : 1);
  assert(Number.isSafeInteger(result) && Math.abs(result) <= 2147483647, "Valor fora do limite");
  return result;
}
export function date(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(clean(value));
  assert(m, "Data ausente ou inválida no export");
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  assert.equal(new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10), iso);
  return iso;
}
const paymentMethod = (text) =>
  /pix|instantâneo/i.test(text)
    ? "pix"
    : /boleto/i.test(text)
      ? "boleto"
      : /cartão/i.test(text)
        ? "card"
        : /dinheiro/i.test(text)
          ? "cash"
          : /transferência/i.test(text)
            ? "transfer"
            : "other";
const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);

/** The audit mapping is bound to all three original file hashes. Every mapped
 * source row and every principal/net/open total is revalidated before DB access.
 */
export function buildContaAzulPlan(books, audit) {
  const [receivable, payable, statement] = books;
  for (const [key, book] of Object.entries({ receivable, payable, statement })) {
    assert.equal(book.sha256, audit[key].sha256, `O arquivo ${key} mudou desde a auditoria`);
    assert.equal(book.rows.length, audit[key].count + 1);
  }
  assert.equal(receivable.rows[0].M, "Valor original da parcela (R$)");
  assert.equal(payable.rows[0].M, "Valor original da parcela (R$)");
  assert.equal(statement.rows[0].A, "Data movimento");
  const fingerprint = hash(books.map((b) => b.sha256).join(":"));
  const batchId = stableId(fingerprint);
  const sourceRows = new Map(statement.rows.slice(1).map((r) => [r.row, r]));
  const used = new Set();
  const entries = [],
    settlements = [],
    accounts = [],
    transfers = [];
  const registers = new Map();
  const addRegister = (kind, name, nature = null) => {
    if (!clean(name)) return;
    const key = `${kind}:${clean(name).toLocaleLowerCase("pt-BR")}:${nature || ""}`;
    const old = registers.get(key);
    registers.set(key, {
      id: stableId(`${fingerprint}/register/${key}`),
      kind,
      name: clean(name),
      nature: old && old.nature !== nature ? null : nature,
    });
  };
  for (const [side, book, kind] of [
    ["receivable", receivable, "income"],
    ["payable", payable, "expense"],
  ]) {
    for (const row of book.rows.slice(1)) {
      const key = `${side}:${row.row}`;
      const id = stableId(`${fingerprint}/${key}`);
      const source = audit.statement.matching[side].row_mapping[row.row];
      assert(source?.length, `Título sem movimentos: ${key}`);
      const parts = /^(\d+)\/(\d+)\s*[-–]/.exec(clean(row.I));
      const entry = {
        id,
        group_id: id,
        installment: parts ? Number(parts[1]) : 1,
        installment_count: parts ? Number(parts[2]) : 1,
        kind,
        description: clean(row.I),
        category: clean(row.AC),
        supplier: kind === "expense" ? clean(row.B) || null : null,
        counterparty_name: clean(row.B) || null,
        counterparty_document: clean(row.A) || null,
        competence_date: date(row.D),
        due_date: date(row.E),
        amount_cents: cents(row.M),
        cost_center: clean(row.AE) || null,
        notes: clean(row.AB) || null,
        source_status: row.K,
        source_key: key,
        source_data: { title: row, movements: source.map((n) => sourceRows.get(n)) },
        expected_principal: cents(row.O),
        expected_cash: cents(row.S),
        expected_pending: cents(row.X),
        discarded: row.K === "Perdido/Desconsiderado",
      };
      assert(
        entry.amount_cents > 0 &&
          entry.installment > 0 &&
          entry.installment <= entry.installment_count &&
          entry.installment_count <= 120,
      );
      assert.equal(
        cents(row.T),
        entry.expected_pending,
        "Ajustes previstos exigem análise adicional",
      );
      for (const c of ["U", "V", "W"])
        assert.equal(cents(row[c]), 0, "Ajuste previsto não suportado por este lote");
      addRegister("category", entry.category, kind);
      addRegister("cost_center", entry.cost_center);
      if (kind === "expense") addRegister("supplier", entry.supplier);
      let pending = 0;
      const paid = [];
      for (const sourceRow of source) {
        const m = sourceRows.get(sourceRow);
        assert(m && !used.has(sourceRow), `Movimento ausente/duplicado: ${sourceRow}`);
        used.add(sourceRow);
        assert.equal(clean(m.C), clean(row.B), "Contraparte divergente");
        assert.equal(clean(m.F), entry.description, "Descrição divergente");
        assert.equal(date(m.T), entry.competence_date);
        assert.equal(date(m.U), entry.due_date);
        assert.equal(m.H, kind === "income" ? "Receita" : "Despesa");
        assert.equal(clean(m.Y), entry.category);
        assert.equal(clean(m.AA), clean(entry.cost_center));
        if (["Quitado", "Conciliado"].includes(m.N)) {
          const s = {
            id: stableId(`${fingerprint}/movement:${sourceRow}`),
            entry_id: id,
            amount_cents: Math.abs(cents(m.L)),
            principal_cents: Math.abs(cents(m.O)),
            interest_cents: Math.abs(cents(m.P)),
            fine_cents: Math.abs(cents(m.Q)),
            discount_cents: Math.abs(cents(m.R)),
            settled_on: date(m.A),
            account_name: clean(m.J) || null,
            payment_method: paymentMethod(clean(m.K)),
            source_reconciled: m.N === "Conciliado",
            source_key: `movement:${sourceRow}`,
            source_data: m,
          };
          assert.equal(cents(m.S), 0, "Tarifa na baixa exige análise adicional");
          assert(s.principal_cents > 0 && s.amount_cents > 0);
          assert.equal(
            s.amount_cents,
            s.principal_cents + s.interest_cents + s.fine_cents - s.discount_cents,
          );
          paid.push(s);
          settlements.push(s);
        } else if (["Atrasado", "Em aberto"].includes(m.N)) pending += Math.abs(cents(m.L));
        else assert.equal(m.N, "Perdido/Desconsiderado", "Situação não reconhecida");
      }
      assert.equal(
        sum(paid, "principal_cents"),
        entry.expected_principal,
        `Principal divergente: ${key}`,
      );
      assert.equal(sum(paid, "amount_cents"), entry.expected_cash, `Líquido divergente: ${key}`);
      assert.equal(pending, entry.expected_pending, `Pendente divergente: ${key}`);
      assert.equal(
        entry.amount_cents,
        entry.expected_principal +
          entry.expected_pending +
          (entry.discarded ? entry.amount_cents : 0),
      );
      if (entry.discarded)
        assert.equal(paid.length, 0, "Perda parcial exige tratamento específico");
      entries.push(entry);
    }
  }
  for (const opening of audit.statement.opening_balance_rows) {
    const row = sourceRows.get(opening.row);
    assert.equal(row.I, "Saldo Conta Bancária");
    assert(!used.has(row.row));
    used.add(row.row);
    accounts.push({
      id: stableId(`${fingerprint}/account:${row.J}`),
      name: row.J,
      opening_date: date(row.A),
      opening_cents: cents(row.L),
      source_key: `opening:${row.row}`,
      source_data: row,
    });
  }
  for (const pair of audit.statement.transfers.pairs) {
    const from = sourceRows.get(pair.out_row),
      to = sourceRows.get(pair.in_row);
    assert(!used.has(from.row) && !used.has(to.row));
    used.add(from.row);
    used.add(to.row);
    assert.equal(from.I, "Transferência");
    assert.equal(to.I, "Transferência");
    assert(cents(from.L) < 0 && cents(to.L) > 0);
    assert.equal(cents(from.L), -cents(to.L));
    assert.equal(from.A, to.A);
    assert.notEqual(from.J, to.J);
    transfers.push({
      id: stableId(`${fingerprint}/transfer:${from.row}:${to.row}`),
      from_name: from.J,
      to_name: to.J,
      amount_cents: cents(to.L),
      transferred_on: date(to.A),
      description: to.F,
      source_from_reconciled: from.N === "Conciliado",
      source_to_reconciled: to.N === "Conciliado",
      source_key: `transfer:${from.row}:${to.row}`,
      source_data: { from, to },
    });
  }
  assert.equal(used.size, statement.rows.length - 1, "Linhas do extrato não aproveitadas");
  const summary = {
    entries: entries.length,
    settlements: settlements.length,
    transfers: transfers.length,
    accounts: accounts.length,
    categories: [...registers.values()].filter((r) => r.kind === "category").length,
    cost_centers: [...registers.values()].filter((r) => r.kind === "cost_center").length,
    suppliers: [...registers.values()].filter((r) => r.kind === "supplier").length,
    source_reconciled:
      settlements.filter((s) => s.source_reconciled).length +
      transfers.reduce(
        (n, t) => n + Number(t.source_from_reconciled) + Number(t.source_to_reconciled),
        0,
      ),
    discarded: entries.filter((e) => e.discarded).length,
    totals: Object.fromEntries(
      ["income", "expense"].map((kind) => {
        const rows = entries.filter((e) => e.kind === kind);
        return [
          kind,
          {
            count: rows.length,
            original: sum(rows, "amount_cents"),
            principal: sum(rows, "expected_principal"),
            cash: sum(rows, "expected_cash"),
            pending: sum(rows, "expected_pending"),
          },
        ];
      }),
    ),
  };
  return {
    fingerprint,
    batchId,
    summary,
    entries,
    settlements,
    transfers,
    accounts,
    registers: [...registers.values()],
    files: books.map((b) => ({ filename: b.filename, sha256: b.sha256, rows: b.rows.length - 1 })),
  };
}
