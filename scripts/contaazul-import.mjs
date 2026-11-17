import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectNeon } from "./neon-db.mjs";
import { buildContaAzulPlan } from "./contaazul-plan.mjs";

const tables = new Set([
  "office_finance_entries",
  "office_finance_settlements",
  "office_finance_transfers",
  "office_finance_accounts",
  "office_finance_registers",
]);
async function insert(db, table, row) {
  assert(tables.has(table));
  const keys = Object.keys(row);
  assert(keys.every((k) => /^[a-z_]+$/.test(k)));
  const values = keys.map((k) => row[k]);
  await db.query(
    `INSERT INTO public.${table}(${keys.join(",")}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(",")})`,
    values,
  );
}
async function insertMany(db, table, rows) {
  if (!rows.length) return;
  assert(tables.has(table));
  const keys = Object.keys(rows[0]);
  assert(keys.every((k) => /^[a-z_]+$/.test(k)));
  assert(rows.every((r) => JSON.stringify(Object.keys(r)) === JSON.stringify(keys)));
  await db.query(
    `INSERT INTO public.${table}(${keys.join(",")}) SELECT ${keys.join(",")} FROM jsonb_populate_recordset(NULL::public.${table},$1::jsonb)`,
    [JSON.stringify(rows)],
  );
}
const snapshot = async (db, table, id) => {
  assert(tables.has(table));
  return (
    (await db.query(`SELECT to_jsonb(t) AS data FROM public.${table} t WHERE id=$1`, [id])).rows[0]
      ?.data ?? null
  );
};
const doc = (value) => String(value ?? "").replace(/\D/g, "");

/** Caller owns the transaction. Default CLI behavior rolls this entire operation
 * back, exercising constraints/triggers and validating totals on the real target.
 */
export async function importContaAzul(db, plan, { reuseAccountId = null, adminId }) {
  await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: adminId }),
  ]);
  await db.query("SELECT public.office_finance_require_admin()");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('magalhaes-contaazul-import'))");
  const existing = (
    await db.query(
      "SELECT status,fingerprint,summary FROM public.office_finance_import_batches WHERE id=$1",
      [plan.batchId],
    )
  ).rows[0];
  if (existing?.status === "applied") {
    assert.equal(existing.fingerprint, plan.fingerprint);
    return { alreadyApplied: true, batchId: plan.batchId, summary: existing.summary };
  }
  assert(!existing, "Lote revertido: revisão explícita necessária antes de reaplicar");
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM public.office_finance_import_batches WHERE status='applied'",
      )
    ).rows[0].n,
    0,
    "Já existe uma importação Conta Azul; não reaplicar outro snapshot",
  );
  // Initial migration only. An incremental import needs stable original IDs.
  await db.query(
    "LOCK TABLE office_finance_entries,office_finance_settlements,office_finance_transfers,office_finance_accounts,office_finance_registers IN SHARE ROW EXCLUSIVE MODE",
  );
  for (const table of [
    "office_finance_entries",
    "office_finance_settlements",
    "office_finance_transfers",
  ])
    assert.equal(
      (await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,
      0,
      `${table} já contém dados: revisar sobreposição antes de importar`,
    );
  await db.query(
    "INSERT INTO office_finance_import_batches(id,source_system,fingerprint,status,summary,files) VALUES($1,'conta_azul',$2,'applied',$3,$4)",
    [plan.batchId, plan.fingerprint, plan.summary, JSON.stringify(plan.files)],
  );
  const records = [];
  const record = (table, id, key, source, before = null) =>
    records.push({ table, id, key, source, before });
  const accountIds = new Map();
  const accountChanges = [];
  for (const a of plan.accounts) {
    let reuse = null;
    if (reuseAccountId && a.name === "BANCO SICOOB PJ")
      reuse = await snapshot(db, "office_finance_accounts", reuseAccountId);
    if (!reuse)
      reuse = (
        await db.query(
          "SELECT to_jsonb(a) AS data FROM office_finance_accounts a WHERE lower(trim(name))=lower(trim($1))",
          [a.name],
        )
      ).rows[0]?.data;
    const id = reuse?.id ?? a.id;
    if (reuse) {
      if (reuse.opening_date !== a.opening_date || Number(reuse.opening_cents) !== a.opening_cents)
        accountChanges.push({
          account_id: id,
          from_date: reuse.opening_date,
          from_cents: Number(reuse.opening_cents),
          to_date: a.opening_date,
          to_cents: a.opening_cents,
        });
      await db.query(
        "UPDATE office_finance_accounts SET opening_date=$2,opening_cents=$3,active=true WHERE id=$1",
        [id, a.opening_date, a.opening_cents],
      );
    } else
      await insert(db, "office_finance_accounts", {
        id,
        name: a.name,
        opening_date: a.opening_date,
        opening_cents: a.opening_cents,
        active: true,
      });
    accountIds.set(a.name, id);
    record("office_finance_accounts", id, a.source_key, a.source_data, reuse);
  }
  const existingRegisters = (
    await db.query("SELECT kind,name,nature FROM office_finance_registers")
  ).rows;
  const newRegisters = plan.registers.filter(
    (r) =>
      !existingRegisters.some(
        (old) =>
          old.kind === r.kind &&
          old.name.trim().toLocaleLowerCase("pt-BR") === r.name.trim().toLocaleLowerCase("pt-BR") &&
          old.nature === r.nature,
      ),
  );
  await insertMany(db, "office_finance_registers", newRegisters);
  for (const r of newRegisters) record("office_finance_registers", r.id, `register:${r.id}`, r);
  const clients = (await db.query("SELECT id,cnpj FROM public.clients")).rows;
  const clientsByDocument = new Map();
  for (const c of clients) {
    const key = doc(c.cnpj);
    if (![11, 14].includes(key.length)) continue;
    clientsByDocument.set(key, [...(clientsByDocument.get(key) || []), c.id]);
  }
  let linkedClients = 0;
  const unlinked = new Set();
  const entryRows = [];
  for (const e of plan.entries) {
    const matches = clientsByDocument.get(doc(e.counterparty_document)) ?? [];
    const client_id = e.kind === "income" && matches.length === 1 ? matches[0] : null;
    if (client_id) linkedClients++;
    else if (e.kind === "income") unlinked.add(e.counterparty_document || e.counterparty_name);
    entryRows.push({
      id: e.id,
      group_id: e.group_id,
      installment: e.installment,
      installment_count: e.installment_count,
      kind: e.kind,
      description: e.description,
      category: e.category,
      supplier: e.supplier,
      notes: e.notes,
      client_id,
      counterparty_name: e.counterparty_name,
      counterparty_document: e.counterparty_document,
      competence_date: e.competence_date,
      due_date: e.due_date,
      amount_cents: e.amount_cents,
      cost_center: e.cost_center,
      import_batch_id: plan.batchId,
      source_status: e.source_status,
      cancelled_at: e.discarded ? new Date().toISOString() : null,
      cancellation_reason: e.discarded
        ? "Perdido/desconsiderado no Conta Azul. Histórico original preservado."
        : null,
    });
    record("office_finance_entries", e.id, e.source_key, e.source_data);
  }
  await insertMany(db, "office_finance_entries", entryRows);
  const settlementRows = [];
  for (const s of plan.settlements) {
    const account_id = s.account_name ? accountIds.get(s.account_name) : null;
    assert(!s.account_name || account_id, "Conta da baixa não mapeada");
    settlementRows.push({
      id: s.id,
      entry_id: s.entry_id,
      amount_cents: s.amount_cents,
      principal_cents: s.principal_cents,
      interest_cents: s.interest_cents,
      fine_cents: s.fine_cents,
      discount_cents: s.discount_cents,
      settled_on: s.settled_on,
      account_id,
      payment_method: s.payment_method,
      source_reconciled: s.source_reconciled,
      import_batch_id: plan.batchId,
    });
    record("office_finance_settlements", s.id, s.source_key, s.source_data);
  }
  await insertMany(db, "office_finance_settlements", settlementRows);
  const transferRows = [];
  for (const t of plan.transfers) {
    const from_account = accountIds.get(t.from_name),
      to_account = accountIds.get(t.to_name);
    assert(from_account && to_account);
    transferRows.push({
      id: t.id,
      from_account,
      to_account,
      amount_cents: t.amount_cents,
      transferred_on: t.transferred_on,
      description: t.description,
      import_batch_id: plan.batchId,
      source_from_reconciled: t.source_from_reconciled,
      source_to_reconciled: t.source_to_reconciled,
    });
    record("office_finance_transfers", t.id, t.source_key, t.source_data);
  }
  await insertMany(db, "office_finance_transfers", transferRows);
  const saved = (
    await db.query(
      "SELECT id,settled_cents,amount_cents,cancelled_at FROM office_finance_entries WHERE import_batch_id=$1",
      [plan.batchId],
    )
  ).rows;
  assert.equal(saved.length, plan.entries.length);
  const sourceEntries = new Map(plan.entries.map((e) => [e.id, e]));
  for (const e of saved) {
    const expected = sourceEntries.get(e.id);
    assert.equal(e.settled_cents, expected.expected_principal, `Principal incorreto ${e.id}`);
    assert.equal(
      e.cancelled_at ? 0 : e.amount_cents - e.settled_cents,
      expected.expected_pending,
      `Pendente incorreto ${e.id}`,
    );
  }
  for (const kind of ["income", "expense"]) {
    const actual = (
      await db.query(
        "SELECT coalesce(sum(s.amount_cents),0)::bigint amount FROM office_finance_settlements s JOIN office_finance_entries e ON e.id=s.entry_id WHERE s.import_batch_id=$1 AND e.kind=$2",
        [plan.batchId, kind],
      )
    ).rows[0];
    assert.equal(Number(actual.amount), plan.summary.totals[kind].cash);
  }
  for (const table of tables) {
    const group = records.filter((r) => r.table === table);
    if (!group.length) continue;
    await db.query(
      `INSERT INTO office_finance_import_items(batch_id,entity_table,entity_id,source_key,source_data,before_data,after_data)
      SELECT $1,$2,x.id,x.key,x.source,x.before,to_jsonb(t)
      FROM jsonb_to_recordset($3::jsonb) AS x(id uuid,key text,source jsonb,before jsonb)
      JOIN public.${table} t ON t.id=x.id`,
      [plan.batchId, table, JSON.stringify(group)],
    );
  }
  const summary = {
    ...plan.summary,
    linked_client_entries: linkedClients,
    unlinked_client_parties: unlinked.size,
    account_changes: accountChanges,
    bank_reconciliations_applied: 0,
    attachments_imported: 0,
  };
  await db.query("UPDATE office_finance_import_batches SET summary=$2 WHERE id=$1", [
    plan.batchId,
    summary,
  ]);
  return { batchId: plan.batchId, summary };
}

export async function rollbackContaAzul(db, batchId, adminId) {
  await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: adminId }),
  ]);
  await db.query("SELECT public.office_finance_require_admin()");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('magalhaes-contaazul-import'))");
  await db.query(
    "LOCK TABLE office_finance_entries,office_finance_settlements,office_finance_transfers,office_finance_accounts,office_finance_registers IN SHARE ROW EXCLUSIVE MODE",
  );
  const batch = (
    await db.query("SELECT * FROM office_finance_import_batches WHERE id=$1 FOR UPDATE", [batchId])
  ).rows[0];
  assert(batch?.status === "applied", "Lote não está aplicado");
  const items = (
    await db.query("SELECT * FROM office_finance_import_items WHERE batch_id=$1", [batchId])
  ).rows;
  for (const table of [
    "office_finance_entries",
    "office_finance_settlements",
    "office_finance_transfers",
  ])
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int n FROM ${table} WHERE import_batch_id IS DISTINCT FROM $1`,
          [batchId],
        )
      ).rows[0].n,
      0,
      "Há movimentações posteriores; reversão exige revisão manual",
    );
  for (const item of items)
    assert.deepEqual(
      await snapshot(db, item.entity_table, item.entity_id),
      item.after_data,
      "Há alterações posteriores; revisão manual necessária antes de desfazer",
    );
  const refs = (
    await db.query(
      `SELECT
    (SELECT count(*) FROM office_finance_documents d JOIN office_finance_entries e ON e.id=d.entry_id WHERE e.import_batch_id=$1)+
    (SELECT count(*) FROM office_finance_settlements s JOIN office_finance_entries e ON e.id=s.entry_id WHERE e.import_batch_id=$1 AND s.import_batch_id IS DISTINCT FROM $1)+
    (SELECT count(*) FROM office_bank_reconciliations r LEFT JOIN office_finance_settlements s ON s.id=r.settlement_id LEFT JOIN office_finance_transfers t ON t.id=r.transfer_id WHERE s.import_batch_id=$1 OR t.import_batch_id=$1) AS n`,
      [batchId],
    )
  ).rows[0];
  assert.equal(Number(refs.n), 0, "Há documentos, baixas ou conciliações posteriores no lote");
  for (const table of [
    "office_finance_settlements",
    "office_finance_entries",
    "office_finance_transfers",
    "office_finance_registers",
    "office_finance_accounts",
  ]) {
    for (const item of items.filter((i) => i.entity_table === table)) {
      if (item.before_data) {
        assert.equal(table, "office_finance_accounts");
        const a = item.before_data;
        await db.query(
          "UPDATE office_finance_accounts SET opening_cents=$2,opening_date=$3,active=$4 WHERE id=$1",
          [a.id, a.opening_cents, a.opening_date, a.active],
        );
      } else await db.query(`DELETE FROM ${table} WHERE id=$1`, [item.entity_id]);
    }
  }
  await db.query("UPDATE office_finance_import_batches SET status='reverted' WHERE id=$1", [
    batchId,
  ]);
  return { batchId, status: "reverted" };
}

async function main() {
  const args = process.argv.slice(2);
  const val = (key) => {
    const i = args.indexOf(key);
    return i < 0 ? null : args[i + 1];
  };
  const folder = val("--folder");
  const rollback = val("--rollback");
  const apply = args.includes("--apply");
  const report = val("--report");
  assert(
    folder || rollback,
    "Use --folder <pacote auditado> [--apply --fingerprint <hash>] [--report <arquivo privado>]",
  );
  let plan;
  if (folder) {
    const audit = JSON.parse(await readFile(resolve(folder, "auditoria-dados.json"), "utf8"));
    const files = ["receivable", "payable", "statement"].map((k) =>
      resolve(folder, "originais", audit[k].file.split("/").pop()),
    );
    const books = JSON.parse(
      execFileSync(
        "python3",
        [fileURLToPath(new URL("./contaazul-xlsx.py", import.meta.url)), ...files],
        { maxBuffer: 20_000_000 },
      ),
    );
    plan = buildContaAzulPlan(books, audit);
    if (apply)
      assert.equal(val("--fingerprint"), plan.fingerprint, "Confirme o fingerprint da prévia");
  }
  const db = await connectNeon();
  try {
    await db.query("BEGIN");
    const admin = (
      await db.query(
        "SELECT p.id FROM profiles p JOIN user_roles r ON r.user_id=p.id WHERE lower(p.email)='reinangrupoahouse@gmail.com' AND r.role='admin'",
      )
    ).rows;
    assert.equal(admin.length, 1, "Administrador de destino não confirmado");
    const connections = (
      await db.query(
        "SELECT account_id FROM office_bank_connections WHERE product='checking' AND enabled",
      )
    ).rows;
    assert.equal(connections.length, 1, "Conta corrente Sicoob de destino ambígua");
    const result = rollback
      ? await rollbackContaAzul(db, rollback, admin[0].id)
      : await importContaAzul(db, plan, {
          adminId: admin[0].id,
          reuseAccountId: connections[0].account_id,
        });
    const output = {
      mode: apply ? "applied" : "dry-run-rolled-back",
      fingerprint: plan?.fingerprint,
      ...result,
    };
    // Save a private execution receipt before commit; stdout contains aggregates only.
    if (report) {
      await mkdir(dirname(resolve(report)), { recursive: true, mode: 0o700 });
      await writeFile(report, JSON.stringify({ ...output, committed: false }, null, 2), {
        mode: 0o600,
      });
    }
    await db.query(apply ? "COMMIT" : "ROLLBACK");
    if (report)
      await writeFile(report, JSON.stringify({ ...output, committed: apply }, null, 2), {
        mode: 0o600,
      });
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    await db.end();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
