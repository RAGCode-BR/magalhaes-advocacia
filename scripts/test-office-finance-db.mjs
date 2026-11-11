import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";

// This harness never reads application credentials or connects to a remote database.
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "magalhaes-finance-db-"));
const dataDirectory = join(directory, "data");
const port = 55487;
const connections = [];
const adminId = "00000000-0000-0000-0000-000000000001";
const outsiderId = "00000000-0000-0000-0000-000000000002";
const clientId = randomUUID();
const processId = randomUUID();
const workspaceId = randomUUID();
const today = new Date().toISOString().slice(0, 10);
let started = false;

async function connection(identity = adminId) {
  const client = new pg.Client({
    host: directory,
    port,
    database: "postgres",
    user: process.env.USER,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  await client.connect();
  connections.push(client);
  if (identity) {
    await client.query("SET ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: identity }),
    ]);
  }
  return client;
}

function payload(overrides = {}) {
  return {
    description: "Honorário de validação",
    category: "Honorários",
    client_id: clientId,
    process_id: processId,
    amount_cents: 10000,
    periods: 3,
    first_due: "2026-01-31",
    competence_date: "2026-01-15",
    ...overrides,
  };
}

async function entry(client, amount = 10000) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.office_finance_entries(id,group_id,installment,installment_count,kind,description,category,client_id,process_id,competence_date,due_date,amount_cents)
     VALUES($1,$2,1,1,'income','Honorário','Honorários',$3,$4,'2026-01-01','2026-01-31',$5)`,
    [id, randomUUID(), clientId, processId, amount],
  );
  return id;
}

async function settlement(client, entryId, amount, id = randomUUID()) {
  await client.query(
    `INSERT INTO public.office_finance_settlements(id,entry_id,amount_cents,settled_on)
     VALUES($1,$2,$3,'2026-01-01') ON CONFLICT(id) DO NOTHING`,
    [id, entryId, amount],
  );
  return id;
}

async function assertBalance(client, id, expected) {
  const {
    rows: [row],
  } = await client.query("SELECT settled_cents FROM public.office_finance_entries WHERE id=$1", [
    id,
  ]);
  assert.equal(row.settled_cents, expected);
}

try {
  execFileSync("initdb", ["-D", dataDirectory, "-A", "trust"], { stdio: "pipe" });
  execFileSync(
    "pg_ctl",
    [
      "-D",
      dataDirectory,
      "-l",
      join(directory, "postgres.log"),
      "-o",
      `-k ${directory} -p ${port} -c listen_addresses=`,
      "-w",
      "start",
    ],
    { stdio: "pipe" },
  );
  started = true;
  const owner = await connection(null);
  await owner.query(`
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    CREATE TYPE public.app_role AS ENUM('admin','collaborator');
    CREATE FUNCTION public.has_role(uuid,public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT $1='00000000-0000-0000-0000-000000000001' AND $2='admin' $$;
    CREATE TABLE public.workspaces(id uuid PRIMARY KEY);
    CREATE TABLE public.clients(id uuid PRIMARY KEY,name text NOT NULL DEFAULT 'Cliente',workspace_id uuid,email text,phone text);
    -- Minimal CRM shape used by the quote → lead integration.
    CREATE TABLE public.crm_opportunities(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
      title text NOT NULL, company_name text, client_id uuid REFERENCES public.clients(id),
      contact_email text, contact_phone text, stage text NOT NULL DEFAULT 'novo',
      source text, amount numeric(14,2), notes text, created_by uuid);
    GRANT SELECT ON public.crm_opportunities TO authenticated;
    CREATE TABLE public.tasks(id uuid PRIMARY KEY,client_id uuid,deleted_at timestamptz);
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT SELECT ON public.tasks TO authenticated;
  `);
  if (process.argv.includes("--neon-identity")) {
    await owner.query(`
      CREATE FUNCTION public.neon_uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    `);
  }
  await owner.query("INSERT INTO public.workspaces VALUES($1)", [workspaceId]);
  await owner.query(
    "INSERT INTO public.clients(id,name,workspace_id,email) VALUES($1,'Cliente Teste',$2,'cliente@exemplo.com')",
    [clientId, workspaceId],
  );
  await owner.query("INSERT INTO public.tasks VALUES($1,$2,NULL)", [processId, clientId]);
  for (const filename of [
    "20261106120000_office_finance.sql",
    "20261107120000_office_finance_workflows.sql",
    "20261107150000_office_finance_orders.sql",
    "20261110120000_finance_quote_proposal_crm.sql",
  ]) {
    await owner.query(await readFile(join(root, "supabase/migrations", filename), "utf8"));
  }
  const admin = await connection();
  const other = await connection();
  const outsider = await connection(outsiderId);

  // Non-admins cannot read any finance table, mutate through RPCs or write history.
  for (const table of [
    "entries",
    "settlements",
    "documents",
    "accounts",
    "registers",
    "agreements",
    "transfers",
    "history",
    "services",
    "orders",
    "order_items",
  ]) {
    assert.equal(
      (await outsider.query(`SELECT count(*)::int n FROM public.office_finance_${table}`)).rows[0]
        .n,
      0,
    );
  }
  await assert.rejects(
    outsider.query("SELECT public.office_finance_save_register($1,'category',$2)", [
      randomUUID(),
      { name: "Negado" },
    ]),
    { code: "42501" },
  );
  await assert.rejects(
    admin.query(
      "INSERT INTO public.office_finance_history(entity_id,entity_type,action) VALUES($1,'entries','fake')",
      [randomUUID()],
    ),
    { code: "42501" },
  );

  const paidEntry = await entry(admin);
  const payment = await settlement(admin, paidEntry, 3000);
  await settlement(admin, paidEntry, 3000, payment);
  await assertBalance(admin, paidEntry, 3000);
  await assert.rejects(settlement(admin, paidEntry, 7001), /excede o saldo/);
  await assert.rejects(
    admin.query("SELECT public.office_finance_cancel_entry($1,'teste')", [paidEntry]),
    /Estorne/,
  );
  await assert.rejects(
    admin.query("SELECT public.office_finance_edit_entry($1,$2)", [
      paidEntry,
      payload({ amount_cents: 2000, due_date: "2026-01-31" }),
    ]),
    /menor que as baixas/,
  );
  await admin.query("SELECT public.office_finance_reverse_settlement($1,'Duplicidade')", [payment]);
  await admin.query("SELECT public.office_finance_reverse_settlement($1,'Reenvio')", [payment]);
  await assertBalance(admin, paidEntry, 0);
  await admin.query("SELECT public.office_finance_cancel_entry($1,'Duplicidade')", [paidEntry]);
  await assert.rejects(settlement(admin, paidEntry, 1), /cancelado/);

  const concurrentEntry = await entry(admin);
  const simultaneous = await Promise.allSettled([
    settlement(admin, concurrentEntry, 6000),
    settlement(other, concurrentEntry, 6000),
  ]);
  assert.equal(simultaneous.filter((item) => item.status === "fulfilled").length, 1);
  await assertBalance(admin, concurrentEntry, 6000);

  // Cancellation holds the entry lock. An in-flight settlement must recheck state.
  const cancelledEntry = await entry(admin);
  await admin.query("BEGIN");
  await admin.query("SELECT public.office_finance_cancel_entry($1,'Cancelamento simultâneo')", [
    cancelledEntry,
  ]);
  const blockedSettlement = settlement(other, cancelledEntry, 100).then(
    () => false,
    () => true,
  );
  await admin.query("COMMIT");
  assert.equal(await blockedSettlement, true);
  await assertBalance(admin, cancelledEntry, 0);

  // Reversal restores balance while the next settlement waits on the same lock.
  const reversedEntry = await entry(admin);
  const toReverse = await settlement(admin, reversedEntry, 6000);
  await admin.query("BEGIN");
  await admin.query("SELECT public.office_finance_reverse_settlement($1,'Correção')", [toReverse]);
  const waitingSettlement = settlement(other, reversedEntry, 5000);
  await admin.query("COMMIT");
  await waitingSettlement;
  await assertBalance(admin, reversedEntry, 5000);

  // Quote conversion is atomic/idempotent even on two concurrent requests.
  const quoteId = randomUUID();
  await admin.query("SELECT public.office_finance_save_agreement($1,'quote',$2)", [
    quoteId,
    payload(),
  ]);
  await assert.rejects(
    admin.query("SELECT public.office_finance_agreement_action($1,'generate')", [quoteId]),
    /Aprove/,
  );
  await admin.query("SELECT public.office_finance_agreement_action($1,'approve')", [quoteId]);
  await admin.query("SELECT public.office_finance_agreement_action($1,'approve')", [quoteId]);
  await Promise.all([
    admin.query("SELECT public.office_finance_agreement_action($1,'generate')", [quoteId]),
    other.query("SELECT public.office_finance_agreement_action($1,'generate')", [quoteId]),
  ]);
  const quoteEntries = (
    await admin.query(
      "SELECT amount_cents,due_date::text,competence_date::text FROM public.office_finance_entries WHERE group_id=$1 ORDER BY installment",
      [quoteId],
    )
  ).rows;
  assert.deepEqual(
    quoteEntries.map((row) => row.amount_cents),
    [3334, 3333, 3333],
  );
  assert.deepEqual(
    quoteEntries.map((row) => row.due_date),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
  );
  assert.equal(
    quoteEntries.reduce((total, row) => total + row.amount_cents, 0),
    10000,
  );
  assert.ok(quoteEntries.every((row) => row.competence_date === "2026-01-15"));

  // Each new quote becomes one "novo" CRM lead carrying the proposal document.
  const lead = (
    await admin.query(
      "SELECT o.stage,o.amount::text,o.client_id,o.contact_email,o.source,o.proposal,a.crm_opportunity_id=o.id linked FROM public.crm_opportunities o JOIN public.office_finance_agreements a ON a.id=o.finance_agreement_id WHERE a.id=$1",
      [quoteId],
    )
  ).rows;
  assert.equal(lead.length, 1);
  assert.equal(lead[0].stage, "novo");
  assert.equal(lead[0].amount, "100.00");
  assert.equal(lead[0].client_id, clientId);
  assert.equal(lead[0].contact_email, "cliente@exemplo.com");
  assert.equal(lead[0].source, "Orçamento");
  assert.ok(lead[0].linked);
  const proposalQuote = randomUUID();
  const proposal = { number: "2026-TEST", scope: ["Análise"], validity_days: 15 };
  for (let attempt = 0; attempt < 2; attempt += 1)
    await admin.query("SELECT public.office_finance_save_agreement($1,'quote',$2)", [
      proposalQuote,
      payload({ proposal }),
    ]);
  const proposalLeads = (
    await admin.query(
      "SELECT o.proposal,a.proposal agreement_proposal FROM public.crm_opportunities o JOIN public.office_finance_agreements a ON a.id=o.finance_agreement_id WHERE a.id=$1",
      [proposalQuote],
    )
  ).rows;
  assert.equal(proposalLeads.length, 1, "retries must not duplicate the lead");
  assert.deepEqual(proposalLeads[0].proposal, proposal);
  assert.deepEqual(proposalLeads[0].agreement_proposal, proposal);
  await assert.rejects(
    outsider.query("SELECT public.office_finance_save_agreement($1,'quote',$2)", [
      randomUUID(),
      payload(),
    ]),
    { code: "42501" },
  );

  // A quote can target a new contact without a client record. The lead goes to
  // the active workspace; generating finance requires linking a client first.
  const prospectQuote = randomUUID();
  await assert.rejects(
    admin.query("SELECT public.office_finance_save_agreement($1,'quote',$2)", [
      randomUUID(),
      payload({ client_id: "", process_id: "" }),
    ]),
    /Selecione o cliente/,
  );
  await assert.rejects(
    admin.query("SELECT public.office_finance_save_agreement($1,'recurring',$2)", [
      randomUUID(),
      payload({ client_id: "", process_id: "", proposal: { client: { name: "Novo" } } }),
    ]),
    /Selecione o cliente/,
  );
  await admin.query("SELECT public.office_finance_save_agreement($1,'quote',$2)", [
    prospectQuote,
    payload({
      client_id: "",
      process_id: "",
      workspace_id: workspaceId,
      proposal: { client: { name: "Contato Novo" }, contact_email: "novo@exemplo.com" },
    }),
  ]);
  const prospectLead = (
    await admin.query(
      "SELECT o.client_id,o.company_name,o.contact_email,o.workspace_id,o.stage,a.client_id agreement_client FROM public.crm_opportunities o JOIN public.office_finance_agreements a ON a.id=o.finance_agreement_id WHERE a.id=$1",
      [prospectQuote],
    )
  ).rows[0];
  assert.equal(prospectLead.client_id, null);
  assert.equal(prospectLead.agreement_client, null);
  assert.equal(prospectLead.company_name, "Contato Novo");
  assert.equal(prospectLead.contact_email, "novo@exemplo.com");
  assert.equal(prospectLead.workspace_id, workspaceId);
  assert.equal(prospectLead.stage, "novo");
  await admin.query("SELECT public.office_finance_agreement_action($1,'approve')", [prospectQuote]);
  await assert.rejects(
    admin.query("SELECT public.office_finance_agreement_action($1,'generate')", [prospectQuote]),
    /cliente/,
  );
  await assert.rejects(
    outsider.query("SELECT public.office_finance_link_agreement_client($1,$2)", [
      prospectQuote,
      clientId,
    ]),
    { code: "42501" },
  );
  for (let attempt = 0; attempt < 2; attempt += 1)
    await admin.query("SELECT public.office_finance_link_agreement_client($1,$2)", [
      prospectQuote,
      clientId,
    ]);
  assert.equal(
    (
      await admin.query(
        "SELECT o.client_id FROM public.crm_opportunities o WHERE o.finance_agreement_id=$1",
        [prospectQuote],
      )
    ).rows[0].client_id,
    clientId,
  );
  await assert.rejects(
    admin.query("SELECT public.office_finance_link_agreement_client($1,$2)", [
      prospectQuote,
      randomUUID(),
    ]),
    /já tem um cliente/,
  );
  await admin.query("SELECT public.office_finance_agreement_action($1,'generate')", [prospectQuote]);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM public.office_finance_entries WHERE group_id=$1 AND client_id=$2",
        [prospectQuote, clientId],
      )
    ).rows[0].n,
    3,
  );

  const recurringId = randomUUID();
  await admin.query("SELECT public.office_finance_save_agreement($1,'recurring',$2)", [
    recurringId,
    payload({ first_due: "2099-01-31", competence_date: "2099-01-31" }),
  ]);
  await admin.query("SELECT public.office_finance_agreement_action($1,'generate')", [recurringId]);
  const recurringEntries = (
    await admin.query(
      "SELECT amount_cents,competence_date::text FROM public.office_finance_entries WHERE group_id=$1 ORDER BY installment",
      [recurringId],
    )
  ).rows;
  assert.deepEqual(
    recurringEntries.map((row) => row.amount_cents),
    [10000, 10000, 10000],
  );
  assert.deepEqual(
    recurringEntries.map((row) => row.competence_date),
    ["2099-01-31", "2099-02-28", "2099-03-31"],
  );
  await admin.query("SELECT public.office_finance_agreement_action($1,'close')", [recurringId]);
  await admin.query("SELECT public.office_finance_agreement_action($1,'close')", [recurringId]);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM public.office_finance_entries WHERE group_id=$1 AND cancelled_at IS NOT NULL",
        [recurringId],
      )
    ).rows[0].n,
    3,
  );

  // A process may have been moved/archived since the agreement was registered.
  const staleAgreement = randomUUID();
  await admin.query("SELECT public.office_finance_save_agreement($1,'recurring',$2)", [
    staleAgreement,
    payload(),
  ]);
  await owner.query("UPDATE public.tasks SET deleted_at=now() WHERE id=$1", [processId]);
  await assert.rejects(
    admin.query("SELECT public.office_finance_agreement_action($1,'generate')", [staleAgreement]),
    /processo não está mais disponível/,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM public.office_finance_entries WHERE group_id=$1",
        [staleAgreement],
      )
    ).rows[0].n,
    0,
  );
  await owner.query("UPDATE public.tasks SET deleted_at=NULL WHERE id=$1", [processId]);

  const accountA = randomUUID(),
    accountB = randomUUID();
  for (const [id, name] of [
    [accountA, "Caixa"],
    [accountB, "Banco"],
  ]) {
    await admin.query("SELECT public.office_finance_save_register($1,'account',$2)", [
      id,
      { name, opening_cents: 0, opening_date: "2026-01-01" },
    ]);
  }
  const transferId = randomUUID();
  const transfer = {
    from_account: accountA,
    to_account: accountB,
    amount_cents: 3000,
    transferred_on: today,
    description: "Movimentação interna",
  };
  await admin.query("SELECT public.office_finance_transfer($1,$2)", [transferId, transfer]);
  await admin.query("SELECT public.office_finance_transfer($1,$2)", [transferId, transfer]);
  assert.equal(
    (await admin.query("SELECT count(*)::int n FROM public.office_finance_transfers")).rows[0].n,
    1,
  );
  await assert.rejects(
    admin.query("SELECT public.office_finance_transfer($1,$2)", [
      randomUUID(),
      { ...transfer, to_account: accountA },
    ]),
    /duas contas/,
  );

  // Orders use server-computed totals, immutable item snapshots and explicit execution stages.
  const serviceId = randomUUID();
  await assert.rejects(
    outsider.query("SELECT public.office_finance_save_service($1,$2)", [
      serviceId,
      { name: "Negado", price_cents: 100 },
    ]),
    { code: "42501" },
  );
  await admin.query("SELECT public.office_finance_save_service($1,$2)", [
    serviceId,
    { name: "Consultoria de teste", price_cents: 5000 },
  ]);
  const orderData = {
    description: "Serviço de validação",
    client_id: clientId,
    process_id: processId,
    category: "Honorários",
    installments: 3,
    discount_cents: 500,
    competence_date: "2026-01-15",
    first_due: "2026-01-31",
    start_date: "2026-01-01",
    expected_date: "2026-01-15",
    responsible: "Equipe de teste",
    items: [{ service_id: serviceId, description: "Consultoria", quantity: 2, unit_cents: 5250 }],
  };
  const orderId = randomUUID();
  const saveOrder = (db, id, data = orderData, kind = "service") =>
    db.query("SELECT public.office_finance_save_order($1,$2,$3)", [id, kind, data]);
  const orderAction = (db, id, action, reason = null) =>
    db.query("SELECT public.office_finance_order_action($1,$2,$3)", [id, action, reason]);
  await assert.rejects(saveOrder(outsider, orderId), { code: "42501" });
  await assert.rejects(orderAction(outsider, orderId, "start"), { code: "42501" });
  await assert.rejects(
    saveOrder(admin, randomUUID(), { ...orderData, total_cents: 1 }),
    /total informado/,
  );
  await assert.rejects(saveOrder(admin, randomUUID(), { ...orderData, items: [] }), /200 itens/);
  await assert.rejects(
    saveOrder(admin, randomUUID(), { ...orderData, discount_cents: 10500 }),
    /desconto/,
  );
  await assert.rejects(
    saveOrder(admin, randomUUID(), { ...orderData, installments: 121 }),
    /120 parcelas/,
  );
  await assert.rejects(
    saveOrder(admin, randomUUID(), { ...orderData, expected_date: "2025-01-01" }),
    /previsão/,
  );
  await assert.rejects(
    saveOrder(admin, randomUUID(), { ...orderData, client_id: null }),
    /cliente/,
  );
  await assert.rejects(
    saveOrder(admin, randomUUID(), { ...orderData, supplier: "" }, "purchase"),
    /fornecedor/,
  );
  await Promise.all([saveOrder(admin, orderId), saveOrder(other, orderId)]);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM public.office_finance_order_items WHERE order_id=$1",
        [orderId],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await admin.query("SELECT total_cents FROM public.office_finance_orders WHERE id=$1", [
        orderId,
      ])
    ).rows[0].total_cents,
    10000,
  );
  await admin.query("SELECT public.office_finance_save_service($1,$2)", [
    serviceId,
    { name: "Consultoria de teste", price_cents: 9000, active: false },
  ]);
  assert.equal(
    (
      await admin.query(
        "SELECT unit_cents FROM public.office_finance_order_items WHERE order_id=$1",
        [orderId],
      )
    ).rows[0].unit_cents,
    5250,
  );
  await assert.rejects(orderAction(admin, orderId, "generate"), /Conclua/);
  await assert.rejects(orderAction(admin, orderId, "complete"), /indisponível/);
  await orderAction(admin, orderId, "start");
  await orderAction(admin, orderId, "start");
  await assert.rejects(saveOrder(admin, orderId), /rascunho/);
  await orderAction(admin, orderId, "complete");
  await orderAction(admin, orderId, "complete");
  await owner.query("UPDATE public.tasks SET deleted_at=now() WHERE id=$1", [processId]);
  await assert.rejects(
    orderAction(admin, orderId, "generate"),
    /processo não está mais disponível/,
  );
  await owner.query("UPDATE public.tasks SET deleted_at=NULL WHERE id=$1", [processId]);
  await Promise.all([
    orderAction(admin, orderId, "generate"),
    orderAction(other, orderId, "generate"),
  ]);
  const generated = (
    await admin.query(
      "SELECT id,amount_cents,due_date::text,kind FROM public.office_finance_entries WHERE group_id=$1 ORDER BY installment",
      [orderId],
    )
  ).rows;
  assert.deepEqual(
    generated.map((r) => r.amount_cents),
    [3334, 3333, 3333],
  );
  assert.deepEqual(
    generated.map((r) => r.due_date),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
  );
  assert.ok(generated.every((r) => r.kind === "income"));
  const orderPayment = await settlement(admin, generated[0].id, 100);
  await assert.rejects(orderAction(admin, orderId, "cancel", "Teste"), /Estorne/);
  await admin.query("SELECT public.office_finance_reverse_settlement($1,'Teste')", [orderPayment]);
  await assert.rejects(orderAction(admin, orderId, "cancel", ""), /motivo/);
  await orderAction(admin, orderId, "cancel", "Validação concluída");
  await orderAction(admin, orderId, "cancel", "Reenvio");
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM public.office_finance_entries WHERE group_id=$1 AND cancelled_at IS NOT NULL",
        [orderId],
      )
    ).rows[0].n,
    3,
  );
  await assert.rejects(orderAction(admin, orderId, "start"), /indisponível/);

  const purchaseId = randomUUID();
  await saveOrder(
    admin,
    purchaseId,
    { ...orderData, supplier: "Fornecedor de teste", client_id: null, process_id: null },
    "purchase",
  );
  await orderAction(admin, purchaseId, "start");
  await orderAction(admin, purchaseId, "complete");
  await orderAction(admin, purchaseId, "generate");
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM public.office_finance_entries WHERE group_id=$1 AND kind='expense'",
        [purchaseId],
      )
    ).rows[0].n,
    3,
  );
  // Cancellation and generation on the same order serialize without leaving active orphan entries.
  const raceId = randomUUID();
  await saveOrder(admin, raceId);
  await orderAction(admin, raceId, "start");
  await orderAction(admin, raceId, "complete");
  await admin.query("BEGIN");
  await orderAction(admin, raceId, "cancel", "Cancelamento simultâneo");
  const pendingGeneration = orderAction(other, raceId, "generate");
  const rejectedGeneration = assert.rejects(pendingGeneration, /Conclua/);
  await admin.query("COMMIT");
  await rejectedGeneration;
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM public.office_finance_entries WHERE group_id=$1",
        [raceId],
      )
    ).rows[0].n,
    0,
  );
  assert.ok(
    (
      await admin.query(
        "SELECT count(*)::int n FROM public.office_finance_history WHERE entity_type='office_finance_order_items' AND action='DELETE'",
      )
    ).rows[0].n > 0,
  );

  // All financial writes are auditable, including reversals and cancellations.
  assert.ok(
    (
      await admin.query(
        "SELECT count(*)::int n FROM public.office_finance_history WHERE entity_id=$1",
        [reversedEntry],
      )
    ).rows[0].n >= 4,
  );
  console.log(
    "Finance SQL passed: migrations, RLS, retries, overpayment, concurrent operations, quote conversion, recurrence, transfers, services, orders, purchases and history.",
  );
} finally {
  await Promise.allSettled(connections.map((client) => client.end()));
  if (started)
    execFileSync("pg_ctl", ["-D", dataDirectory, "-m", "immediate", "-w", "stop"], {
      stdio: "pipe",
    });
  await rm(directory, { recursive: true, force: true });
}
