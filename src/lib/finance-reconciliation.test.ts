import {describe,it,expect} from 'vitest';
import {reconciliationEntries} from './finance-reconciliation';
import type {FinanceEntry} from './office-finance';
import type {BankTransaction} from './office-bank';
const bank: BankTransaction={id:'bank',booked_on:'2026-11-17',amount_cents:1000,description:'Pix',settlement_id:null,reconciled_at:null};
const entry=(id:string,patch:Partial<FinanceEntry>={}):FinanceEntry=>({id,kind:'income',description:id,category:'Serviços',supplier:null,notes:null,client_id:null,process_id:null,installment:1,installment_count:1,competence_date:'2026-11-01',due_date:'2026-11-17',amount_cents:1000,settled_cents:0,...patch});
describe('bank reconciliation suggestions',()=>{
 it('ranks exact remaining balance before date proximity and excludes closed/opposite entries',()=>{
  const rows=[entry('partial',{amount_cents:2000}),entry('later',{due_date:'2026-11-20'}),entry('exact'),entry('paid',{settled_cents:1000}),entry('expense',{kind:'expense'}),entry('cancelled',{cancelled_at:'2026-11-01'}),entry('part-paid',{amount_cents:1500,settled_cents:500})];
  expect(reconciliationEntries(rows,bank).map(e=>e.id)).toEqual(['exact','part-paid','later','partial']);
 });
 it('finds expenses by supplier and keeps overpayment candidates visible for comparison',()=>{
  const rows=[entry('expense',{kind:'expense',supplier:'Fornecedor Exemplo',amount_cents:500})];
  expect(reconciliationEntries(rows,{...bank,amount_cents:-1000},'exemplo')).toHaveLength(1);
  expect(reconciliationEntries(rows,bank,'exemplo')).toHaveLength(0);
 });
});
