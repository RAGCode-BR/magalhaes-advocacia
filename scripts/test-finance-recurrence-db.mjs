import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function testFinanceRecurrence({ admin, outsider }) {
  for (const kind of ["income", "expense"]) {
    const group = randomUUID();
    const statement = `INSERT INTO public.office_finance_entries
      (group_id,installment,installment_count,kind,description,category,competence_date,due_date,amount_cents,recurrence_frequency)
      SELECT $1,n,3,$2,'Validação recorrente','Exemplo',
        ('2026-01-15'::date + (n-1)*interval '1 month')::date,
        ('2026-01-31'::date + (n-1)*interval '1 month')::date,10000,'monthly'
      FROM generate_series(1,3) n ON CONFLICT (group_id,installment) DO NOTHING`;
    await admin.query("BEGIN");
    try {
      await admin.query(statement, [group, kind]);
      await admin.query(statement, [group, kind]);
      const { rows } = await admin.query(
        `SELECT amount_cents, due_date::text, competence_date::text, recurrence_frequency
        FROM public.office_finance_entries WHERE group_id=$1 ORDER BY installment`,
        [group],
      );
      assert.equal(rows.length, 3);
      assert.deepEqual(
        rows.map((r) => r.amount_cents),
        [10000, 10000, 10000],
      );
      assert.deepEqual(
        rows.map((r) => r.due_date),
        ["2026-01-31", "2026-02-28", "2026-03-31"],
      );
      assert.ok(rows.every((r) => r.recurrence_frequency === "monthly"));
    } finally {
      await admin.query("ROLLBACK");
    }
    await assert.rejects(outsider.query(statement, [randomUUID(), kind]));
  }
  console.log("Recurring income/expense: full amounts, unique retries, dates and permissions OK");
}
