import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Called by the existing disposable Postgres harness. No production credentials.
export async function testBankStatement({ owner, admin, outsider }) {
  const accountId = randomUUID();
  const connectionId = randomUUID();
  await admin.query("SELECT public.office_finance_save_register($1,'account',$2)", [
    accountId,
    {
      name: "Sicoob validação",
      opening_cents: 0,
      opening_date: "2026-11-01",
      active: true,
    },
  ]);
  await owner.query(
    "INSERT INTO public.office_bank_connections(id,account_id,product) VALUES($1,$2,'checking')",
    [connectionId, accountId],
  );
  const insert = `INSERT INTO public.office_bank_transactions
    (connection_id,external_id,booked_on,description,amount_cents)
    VALUES($1,$2,'2026-11-16','Movimento de teste',$3)
    ON CONFLICT(connection_id,external_id) DO NOTHING`;
  await owner.query(insert, [connectionId, "bank-1", 25000]);
  await owner.query(insert, [connectionId, "bank-1", 25000]);
  // Same day/value, different bank IDs are two real movements.
  await owner.query(insert, [connectionId, "bank-2", 25000]);
  await owner.query(insert, [connectionId, "bank-3", -10000]);
  assert.equal(
    (await admin.query("SELECT count(*)::int n FROM public.office_bank_transactions")).rows[0].n,
    3,
  );
  await owner.query(
    `INSERT INTO public.office_bank_balances
    (connection_id,kind,amount_cents,observed_at) VALUES($1,'available',40000,now())`,
    [connectionId],
  );
  for (const name of ["connections", "transactions", "balances"]) {
    assert.equal(
      (await outsider.query(`SELECT count(*)::int n FROM public.office_bank_${name}`)).rows[0].n,
      0,
    );
    await assert.rejects(admin.query(`DELETE FROM public.office_bank_${name}`), { code: "42501" });
    await assert.rejects(admin.query(`UPDATE public.office_bank_${name} SET id=id`), {
      code: "42501",
    });
  }
  // A browser admin may consult evidence, but cannot forge a bank import.
  await assert.rejects(admin.query(insert, [connectionId, "forged", 10000]), { code: "42501" });
  await assert.rejects(owner.query(insert, [connectionId, "zero", 0]), { code: "23514" });
  await assert.rejects(owner.query(insert, [connectionId, "unsafe", "9007199254740992"]), {
    code: "23514",
  });
  await assert.rejects(owner.query(insert, [randomUUID(), "unknown-account", 100]), {
    code: "23503",
  });
  await assert.rejects(
    owner.query(
      `INSERT INTO public.office_bank_connections(account_id,product)
    VALUES($1,'checking')`,
      [accountId],
    ),
    { code: "23505" },
  );

  // Incoming evidence alone must never settle a fee or expense.
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM public.office_finance_settlements WHERE account_id=$1",
        [accountId],
      )
    ).rows[0].n,
    0,
  );
  if (process.argv.includes("--bank-capacity")) {
    await owner.query(
      `INSERT INTO public.office_bank_transactions
        (connection_id,external_id,booked_on,description,amount_cents)
       SELECT $1, 'capacity-' || n, DATE '2026-01-01' + (n % 365),
         'Movimentação bancária de teste para estimar armazenamento e índice por período',
         CASE WHEN n % 2 = 0 THEN 10000 ELSE -10000 END
       FROM generate_series(1,100000) AS n`,
      [connectionId],
    );
    await owner.query("ANALYZE public.office_bank_transactions");
    const size = await owner.query(
      "SELECT pg_total_relation_size('public.office_bank_transactions')::text AS bytes",
    );
    const plan = await owner.query(
      `EXPLAIN (ANALYZE, FORMAT JSON) SELECT id,booked_on,description,amount_cents
       FROM public.office_bank_transactions WHERE connection_id=$1
       AND booked_on BETWEEN '2026-11-01' AND '2026-11-30'
       ORDER BY booked_on DESC,id DESC LIMIT 100`,
      [connectionId],
    );
    console.log(
      "Local synthetic capacity (not a production load test):",
      JSON.stringify({
        rows: 100003,
        bytes: size.rows[0].bytes,
        plan: plan.rows[0]["QUERY PLAN"][0],
      }),
    );
  }
  console.log(
    "Bank foundation passed: duplicate prevention, exact cents, account isolation, admin-only reads and no automatic settlements.",
  );
}
