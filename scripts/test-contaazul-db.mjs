import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { importContaAzul, rollbackContaAzul } from "./contaazul-import.mjs";
import { buildContaAzulPlan } from "./contaazul-plan.mjs";
import { contaAzulFixture } from "./contaazul-fixture.mjs";

export async function testContaAzul({ owner, admin, outsider, adminId }) {
  await assert.rejects(
    admin.query(
      "INSERT INTO office_finance_import_batches(id,source_system,fingerprint,status,summary,files) VALUES(gen_random_uuid(),'conta_azul','forged','applied','{}','[]')",
    ),
    /permission denied/,
  );
  const { books, audit } = contaAzulFixture(),
    plan = buildContaAzulPlan(books, audit);
  await owner.query("BEGIN");
  try {
    const first = await importContaAzul(owner, plan, { adminId });
    assert.equal(first.summary.entries, 3);
    assert.equal(first.summary.settlements, 3);
    assert.equal(
      (
        await owner.query("SELECT settled_cents FROM office_finance_entries WHERE id=$1", [
          plan.entries[0].id,
        ])
      ).rows[0].settled_cents,
      7000,
    );
    assert.equal((await importContaAzul(owner, plan, { adminId })).alreadyApplied, true);
    const ids = (await owner.query("SELECT id FROM office_finance_entries ORDER BY id")).rows;
    assert.equal(ids.length, 3);
    // No bank reconciliation is invented from an imported flag.
    assert.equal(
      (await owner.query("SELECT count(*)::int n FROM office_bank_reconciliations")).rows[0].n,
      0,
    );
    const connection = randomUUID(),
      transaction = randomUUID();
    await owner.query(
      "INSERT INTO office_bank_connections(id,bank_code,product,account_id,enabled) VALUES($1,'756','checking',$2,true)",
      [connection, plan.accounts[0].id],
    );
    await owner.query(
      "INSERT INTO office_bank_transactions(id,connection_id,external_id,booked_on,description,amount_cents) VALUES($1,$2,'synthetic-transfer','2026-04-07','Aplicação de exemplo',-10000)",
      [transaction, connection],
    );
    const candidates = (
      await owner.query("SELECT office_bank_candidates($1) AS data", [transaction])
    ).rows[0].data;
    assert(candidates.some((c) => c.target_type === "transfer" && c.id === plan.transfers[0].id));
    await owner.query("SELECT office_bank_reconcile_transfer($1,$2)", [
      transaction,
      plan.transfers[0].id,
    ]);
    await owner.query("SELECT office_bank_reconcile_transfer($1,$2)", [
      transaction,
      plan.transfers[0].id,
    ]);
    const view = (await owner.query("SELECT office_bank_overview('2026-04-01') AS data")).rows[0]
      .data;
    assert.equal(view.rows[0].transfer_id, plan.transfers[0].id);
    assert.equal(view.totals.pending, 0);
    await owner.query("SAVEPOINT mutation");
    await assert.rejects(
      owner.query("UPDATE office_finance_transfers SET amount_cents=9000 WHERE id=$1", [
        plan.transfers[0].id,
      ]),
      /Desfaça/,
    );
    await owner.query("ROLLBACK TO SAVEPOINT mutation");
    await owner.query("SELECT office_bank_unreconcile($1,$2)", [transaction, "Teste de reversão"]);
    await owner.query("DELETE FROM office_bank_transactions WHERE id=$1", [transaction]);
    await owner.query("DELETE FROM office_bank_connections WHERE id=$1", [connection]);
    await rollbackContaAzul(owner, plan.batchId, adminId);
    assert.equal(
      (await owner.query("SELECT count(*)::int n FROM office_finance_entries")).rows[0].n,
      0,
    );
    assert.equal(
      (await owner.query("SELECT count(*)::int n FROM office_finance_accounts")).rows[0].n,
      0,
    );
  } finally {
    await owner.query("ROLLBACK");
  }

  // Public insertion keeps backward compatibility, but rejects a forged net.
  await admin.query("BEGIN");
  try {
    const id = randomUUID();
    await admin.query(
      "INSERT INTO office_finance_entries(id,group_id,installment,installment_count,kind,description,category,competence_date,due_date,amount_cents) VALUES($1,$1,1,1,'income','Teste','Teste','2026-01-01','2026-01-01',10000)",
      [id],
    );
    const settlement = randomUUID();
    await admin.query(
      "INSERT INTO office_finance_settlements(id,entry_id,principal_cents,amount_cents,interest_cents,discount_cents,settled_on) VALUES($1,$2,10000,9500,500,1000,'2026-01-01')",
      [settlement, id],
    );
    assert.equal(
      (await admin.query("SELECT settled_cents FROM office_finance_entries WHERE id=$1", [id]))
        .rows[0].settled_cents,
      10000,
    );
    await admin.query("SELECT office_finance_reverse_settlement($1,$2)", [settlement, "Teste"]);
    assert.equal(
      (await admin.query("SELECT settled_cents FROM office_finance_entries WHERE id=$1", [id]))
        .rows[0].settled_cents,
      0,
    );
    await admin.query("SAVEPOINT invalid_net");
    await assert.rejects(
      admin.query(
        "INSERT INTO office_finance_settlements(entry_id,principal_cents,amount_cents,discount_cents,settled_on) VALUES($1,10000,10000,1000,'2026-01-01')",
        [id],
      ),
      /check constraint/,
    );
    await admin.query("ROLLBACK TO SAVEPOINT invalid_net");
  } finally {
    await admin.query("ROLLBACK");
  }
  assert.deepEqual((await outsider.query("SELECT * FROM office_finance_import_batches")).rows, []);
  await assert.rejects(
    outsider.query("SELECT office_bank_reconcile_transfer($1,$2)", [randomUUID(), randomUUID()]),
    /administradores/,
  );
  console.log(
    "Conta Azul DB: import, idempotency, rollback, principal/net, access control and transfer reconciliation OK",
  );
}
