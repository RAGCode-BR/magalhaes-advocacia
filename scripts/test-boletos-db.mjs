import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function testBoletos({ owner, admin, other, outsider, connection, clientId }) {
  const account = randomUUID(),
    connectionId = randomUUID(),
    entry = randomUUID();
  await admin.query("SELECT public.office_finance_save_register($1,'account',$2)", [
    account,
    { name: "Boleto test", opening_cents: 0, opening_date: "2020-01-01", active: true },
  ]);
  await owner.query(
    "INSERT INTO public.office_bank_connections(id,account_id,product,enabled) VALUES($1,$2,'checking',true)",
    [connectionId, account],
  );
  // Other test connections may exist: use the function's actual chosen connection below.
  await admin.query(
    "INSERT INTO public.office_finance_entries(id,group_id,installment,installment_count,kind,description,category,client_id,competence_date,due_date,amount_cents) VALUES($1,$2,1,1,'income','Boleto test','Honorários',$3,CURRENT_DATE,'2099-12-01',10000)",
    [entry, randomUUID(), clientId],
  );
  const payer = {
    nome: "Cliente Exemplo",
    numeroCpfCnpj: "52998224725",
    endereco: "Rua 1",
    bairro: "Centro",
    cidade: "Cuiabá",
    cep: "78000000",
    uf: "MT",
  };
  await assert.rejects(
    outsider.query("SELECT public.office_boleto_prepare($1,$2,'RC')", [entry, payer]),
    { code: "42501" },
  );
  const prepare = async () =>
    (await admin.query("SELECT public.office_boleto_prepare($1,$2,'RC') AS id", [entry, payer]))
      .rows[0].id;
  const id = await prepare();
  assert.equal(await prepare(), id);
  assert.equal(
    (await admin.query("SELECT public.office_boleto_list() AS data")).rows[0].data.length,
    1,
  );
  await assert.rejects(outsider.query("SELECT public.office_boleto_list()"), { code: "42501" });
  for (const c of [admin, outsider])
    await assert.rejects(c.query("SELECT * FROM public.office_finance_boletos"), { code: "42501" });
  await assert.rejects(
    admin.query("SELECT public.office_boleto_claim($1,$2)", [id, connectionId]),
    { code: "42501" },
  );
  const importer = await connection(null);
  await importer.query("SET ROLE magalhaes_sicoob");
  const importer2 = await connection(null);
  await importer2.query("SET ROLE magalhaes_sicoob");
  const conn = (
    await owner.query("SELECT connection_id FROM public.office_finance_boletos WHERE id=$1", [id])
  ).rows[0].connection_id;
  const claims = await Promise.all(
    [importer, importer2].map((c) =>
      c.query("SELECT public.office_boleto_claim($1,$2) data", [id, conn]),
    ),
  );
  assert.equal(claims.filter((c) => c.rows[0].data.claimed).length, 1);
  const b = claims.find((c) => c.rows[0].data.claimed).rows[0].data.boleto;
  await assert.rejects(
    owner.query("UPDATE public.office_finance_entries SET amount_cents=9000 WHERE id=$1", [entry]),
    /boleto no banco/,
  );
  await assert.rejects(importer.query("SELECT * FROM public.clients"), { code: "42501" });
  await importer.query("SELECT public.office_boleto_finish($1,$2,'uncertain','{}','Timeout')", [
    id,
    b.lease,
  ]);
  assert.equal(
    (await importer.query("SELECT public.office_boleto_claim($1,$2) data", [id, conn])).rows[0].data
      .claimed,
    false,
  );
  assert.equal(await prepare(), id); // preparation cannot reset an ambiguous issuance
  const data = {
    nossoNumero: "123",
    seuNumero: b.reference,
    amount_cents: 10000,
    payer_document: payer.numeroCpfCnpj,
    situacaoBoleto: "Em Aberto",
  };
  await assert.rejects(
    importer.query("SELECT public.office_boleto_refresh($1,$2,$3)", [
      id,
      conn,
      { ...data, amount_cents: 9999 },
    ]),
    /não corresponde/,
  );
  await importer.query("SELECT public.office_boleto_refresh($1,$2,$3)", [id, conn, data]);
  assert.equal(
    (await importer.query("SELECT public.office_boleto_read($1,$2) data", [id, conn])).rows[0].data
      .state,
    "issued",
  );
  assert.equal(
    (
      await admin.query("SELECT settled_cents FROM public.office_finance_entries WHERE id=$1", [
        entry,
      ])
    ).rows[0].settled_cents,
    0,
  );
  assert.equal(
    (await admin.query("SELECT public.office_bank_periods_list() data")).rows[0].data.some(
      (x) => x.row_count === 53,
    ),
    true,
  );
  console.log(
    "Boleto SQL passed: admin-only, restricted backend, concurrent issuance, immutable intent, timeout recovery and no automatic settlement.",
  );
}
