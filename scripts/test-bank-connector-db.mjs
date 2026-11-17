import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function testBankConnector({ owner, admin, other, outsider, connection, clientId }) {
  const account = randomUUID(),
    id = randomUUID();
  await admin.query("SELECT public.office_finance_save_register($1,'account',$2)", [
    account,
    { name: "Conta para conector", opening_cents: 0, opening_date: "2020-01-01", active: true },
  ]);
  await owner.query(
    "INSERT INTO public.office_bank_connections(id,account_id,product,enabled) VALUES($1,$2,'checking',true)",
    [id, account],
  );
  const importer = await connection(null);
  await importer.query("SET ROLE magalhaes_sicoob");
  await assert.rejects(importer.query("SELECT * FROM public.clients"), { code: "42501" });
  await assert.rejects(importer.query("SELECT * FROM public.office_bank_transactions"), {
    code: "42501",
  });
  await assert.rejects(admin.query("SELECT public.office_bank_sync_claim($1)", [id]), {
    code: "42501",
  });
  await assert.rejects(outsider.query("SELECT public.office_bank_sync_authorize()"), {
    code: "42501",
  });
  await assert.rejects(outsider.query("SELECT public.office_bank_overview('2026-11-01')"), {
    code: "42501",
  });
  const claim = async () =>
    (await importer.query("SELECT public.office_bank_sync_claim($1) lease", [id])).rows[0].lease;
  const release = () =>
    owner.query("UPDATE public.office_bank_connections SET last_attempt_at=NULL WHERE id=$1", [id]);
  const balances = [
    { kind: "ledger", amount_cents: 100000 },
    { kind: "blocked", amount_cents: 0 },
    { kind: "credit_limit", amount_cents: 50000 },
  ];
  const rows = Array.from({ length: 53 }, (_, i) => ({
    external_id: `connector-${i}`,
    booked_on: "2026-11-02",
    description: "Movimentação de teste",
    amount_cents: 10000,
  }));
  const finish = (lease, list = rows, values = balances) =>
    importer.query("SELECT public.office_bank_sync_finish($1,$2,'2026-11-01',$3,$4,NULL) n", [
      id,
      lease,
      JSON.stringify(list),
      JSON.stringify(values),
    ]);
  let lease = await claim();
  assert.ok(lease);
  assert.equal(await claim(), null, "one lease per bank connection");
  await assert.rejects(finish(randomUUID()), /substituída/);
  await assert.rejects(finish(lease, rows, []), /incompleta/);
  assert.equal((await finish(lease)).rows[0].n, 53);
  await release();
  lease = await claim();
  assert.equal(
    (await finish(lease)).rows[0].n,
    0,
    "retry does not duplicate or rewrite unchanged rows",
  );
  const overview = (await admin.query("SELECT public.office_bank_overview('2026-11-01') data"))
    .rows[0].data;
  assert.equal(overview.rows.length, 51);
  assert.equal(overview.totals.count, 53);
  assert.equal(overview.totals.credits, 530000);
  const cursor = overview.rows[49];
  const next = (
    await admin.query("SELECT public.office_bank_overview('2026-11-01','all',$1,$2) data", [
      cursor.booked_on,
      cursor.id,
    ])
  ).rows[0].data;
  assert.equal(next.rows.length, 3);
  assert.equal(new Set([...overview.rows.slice(0, 50), ...next.rows].map((r) => r.id)).size, 53);
  async function settle(amount = 10000, kind = "income") {
    const entry = randomUUID(),
      settlement = randomUUID();
    await admin.query(
      `INSERT INTO public.office_finance_entries(id,group_id,installment,installment_count,kind,description,category,competence_date,due_date,amount_cents,client_id)
      VALUES($1,$2,1,1,$3,'Teste conciliação','Teste','2026-11-01','2026-11-01',$4,$5)`,
      [entry, randomUUID(), kind, amount, clientId],
    );
    await admin.query(
      "INSERT INTO public.office_finance_settlements(id,entry_id,amount_cents,settled_on,account_id) VALUES($1,$2,$3,'2026-11-02',$4)",
      [settlement, entry, amount, account],
    );
    return settlement;
  }
  const settlement = await settle(),
    wrongAmount = await settle(5000),
    wrongKind = await settle(10000, "expense");
  const target = overview.rows[0].id;
  const candidates = (await admin.query("SELECT public.office_bank_candidates($1) data", [target]))
    .rows[0].data;
  assert.deepEqual(
    candidates.map((x) => x.id),
    [settlement],
  );
  for (const wrong of [wrongAmount, wrongKind])
    await assert.rejects(
      admin.query("SELECT public.office_bank_reconcile($1,$2)", [target, wrong]),
      /mesma conta/,
    );
  await assert.rejects(
    outsider.query("SELECT public.office_bank_reconcile($1,$2)", [target, settlement]),
    { code: "42501" },
  );
  await admin.query("SELECT public.office_bank_reconcile($1,$2)", [target, settlement]);
  await other.query("SELECT public.office_bank_reconcile($1,$2)", [target, settlement]);
  await assert.rejects(
    admin.query("SELECT public.office_finance_reverse_settlement($1,'Teste')", [settlement]),
    /Desfaça a conciliação/,
  );
  await assert.rejects(
    owner.query("UPDATE public.office_bank_transactions SET amount_cents=9000 WHERE id=$1", [
      target,
    ]),
    /banco alterou/,
  );
  const a = await settle(),
    b = await settle();
  const race = await Promise.allSettled([
    admin.query("SELECT public.office_bank_reconcile($1,$2)", [overview.rows[1].id, a]),
    other.query("SELECT public.office_bank_reconcile($1,$2)", [overview.rows[1].id, b]),
  ]);
  assert.equal(race.filter((x) => x.status === "fulfilled").length, 1);
  await assert.rejects(
    admin.query("SELECT public.office_bank_unreconcile($1,'')", [target]),
    /motivo/,
  );
  await admin.query("SELECT public.office_bank_unreconcile($1,'Revisão de teste')", [target]);
  await admin.query("SELECT public.office_finance_reverse_settlement($1,'Teste')", [settlement]);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM public.office_finance_history WHERE entity_id=$1 AND entity_type='bank_reconciliation'",
        [target],
      )
    ).rows[0].n,
    2,
  );
  // Create an entry straight from a bank movement: entry + settlement + reconciliation
  // in one call, idempotent, admin-only, and refused when already reconciled.
  const fresh = overview.rows[2].id;
  const newEntry = randomUUID(),
    newSettlement = randomUUID();
  const createData = {
    description: "Consulta avulsa",
    category: "Honorários",
    cost_center: "Administrativo",
    client_id: "",
  };
  await assert.rejects(
    outsider.query("SELECT public.office_bank_create_and_reconcile($1,$2,$3,$4)", [
      fresh,
      newEntry,
      newSettlement,
      createData,
    ]),
    { code: "42501" },
  );
  await assert.rejects(
    admin.query("SELECT public.office_bank_create_and_reconcile($1,$2,$3,$4)", [
      fresh,
      randomUUID(),
      randomUUID(),
      { ...createData, category: "" },
    ]),
    /plano de contas/,
  );
  for (let attempt = 0; attempt < 2; attempt += 1)
    await admin.query("SELECT public.office_bank_create_and_reconcile($1,$2,$3,$4)", [
      fresh,
      newEntry,
      newSettlement,
      createData,
    ]);
  const created = (
    await owner.query(
      "SELECT e.kind,e.amount_cents,e.settled_cents,e.client_id,e.cost_center,s.account_id,r.settlement_id FROM public.office_finance_entries e JOIN public.office_finance_settlements s ON s.entry_id=e.id JOIN public.office_bank_reconciliations r ON r.settlement_id=s.id WHERE e.id=$1",
      [newEntry],
    )
  ).rows;
  assert.equal(created.length, 1);
  assert.deepEqual(created[0], {
    kind: "income",
    amount_cents: 10000,
    settled_cents: 10000,
    client_id: null,
    cost_center: "Administrativo",
    account_id: account,
    settlement_id: newSettlement,
  });
  await assert.rejects(
    admin.query("SELECT public.office_bank_create_and_reconcile($1,$2,$3,$4)", [
      fresh,
      randomUUID(),
      randomUUID(),
      createData,
    ]),
    /já está conciliada/,
  );

  await release();
  lease = await claim();
  await importer.query(
    "SELECT public.office_bank_sync_finish($1,$2,'2026-11-01','[]','[]','Falha de teste')",
    [id, lease],
  );
  const state = (
    await owner.query(
      "SELECT last_error,syncing_since,last_success_at FROM public.office_bank_connections WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(state.last_error, "Falha de teste");
  assert.equal(state.syncing_since, null);
  assert.ok(state.last_success_at);
  console.log(
    "Bank connector SQL passed: restricted importer, leases, atomic imports, pagination, reconciliation, concurrency and reversal guards.",
  );
}
