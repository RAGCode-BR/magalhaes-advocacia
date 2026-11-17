import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function testBankSettleExisting({owner,admin,other,outsider}) {
  const connection=(await owner.query('SELECT id FROM office_bank_connections LIMIT 1')).rows[0].id;
  async function movement(amount){return (await owner.query("INSERT INTO office_bank_transactions(connection_id,external_id,booked_on,description,amount_cents) VALUES($1,$2,'2026-11-16','Teste conciliação',$3) RETURNING id",[connection,randomUUID(),amount])).rows[0].id;}
  async function entry(kind,amount){const id=randomUUID();await admin.query("INSERT INTO office_finance_entries(id,group_id,installment,installment_count,kind,description,category,competence_date,due_date,amount_cents) VALUES($1,$1,1,1,$2,'Teste em aberto','Teste','2026-11-16','2026-11-16',$3)",[id,kind,amount]);return id;}
  const rpc='SELECT office_bank_settle_existing($1,$2,$3)';
  for(const kind of ['income','expense']){
    const id=await entry(kind,1000), t=await movement(kind==='income'?600:-600), settlement=randomUUID();
    await assert.rejects(outsider.query(rpc,[t,id,settlement]));
    await admin.query(rpc,[t,id,settlement]);await admin.query(rpc,[t,id,settlement]);
    assert.equal((await admin.query('SELECT settled_cents FROM office_finance_entries WHERE id=$1',[id])).rows[0].settled_cents,600);
    assert.equal((await admin.query('SELECT count(*)::int n FROM office_finance_settlements WHERE entry_id=$1',[id])).rows[0].n,1);
    const excess=await movement(kind==='income'?500:-500);
    await assert.rejects(admin.query(rpc,[excess,id,randomUUID()]),/excede/);
    const wrong=await movement(kind==='income'?-400:400);
    await assert.rejects(admin.query(rpc,[wrong,id,randomUUID()]),/tipo/);
    assert.equal((await admin.query('SELECT count(*)::int n FROM office_bank_reconciliations WHERE transaction_id IN ($1,$2)',[excess,wrong])).rows[0].n,0);
    const finish=await movement(kind==='income'?400:-400);
    await admin.query(rpc,[finish,id,randomUUID()]);
    assert.equal((await admin.query('SELECT settled_cents FROM office_finance_entries WHERE id=$1',[id])).rows[0].settled_cents,1000);
  }
  const id=await entry('income',1000), a=await movement(1000),b=await movement(1000);
  const results=await Promise.allSettled([admin.query(rpc,[a,id,randomUUID()]),other.query(rpc,[b,id,randomUUID()])]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await admin.query('SELECT settled_cents FROM office_finance_entries WHERE id=$1',[id])).rows[0].settled_cents,1000);
  console.log('Existing title reconciliation: partial/full, replay, permissions, direction, overpayment and concurrent confirmations OK');
}
