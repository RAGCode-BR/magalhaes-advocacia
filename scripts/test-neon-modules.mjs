import { connectNeon } from './neon-db.mjs';
import { randomUUID } from 'node:crypto';
const db=await connectNeon();const adminId=randomUUID();let stage='inicialização';
async function insert(table,data){
 stage=table;const fields=Object.keys(data);const q=`insert into public.${table}(${fields.map(k=>'"'+k+'"').join(',')}) values(${fields.map((_,i)=>'$'+(i+1)).join(',')}) returning *`;
 return (await db.query(q,Object.values(data))).rows[0];
}
async function query(label,sql,args=[]){stage=label;return db.query(sql,args);}
try{
 await db.query('BEGIN');
 await db.query("update magalhaes_private.bootstrap_admin set email='modules-validation@example.invalid'");
 await db.query('insert into neon_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") values($1,$2,$3,false,now(),now())',[adminId,'Administrador de validação','modules-validation@example.invalid']);
 await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:adminId,role:'authenticated'})]);
 await db.query('SET LOCAL ROLE authenticated');
 const workspace=(await db.query('select public.current_workspace_id() id')).rows[0].id;
 const client=await insert('clients',{name:'Cliente de validação',created_by:adminId});
 const branch=await insert('client_branches',{client_id:client.id,name:'Unidade de validação'});
 const department=await insert('client_departments',{client_id:client.id,name:'Departamento de validação'});
 const employee=await insert('client_department_employees',{department_id:department.id,full_name:'Pessoa fictícia'});
 await insert('client_department_employee_notes',{employee_id:employee.id,content:'Anotação de validação'});
 await insert('client_important_dates',{client_id:client.id,title:'Data de validação',event_date:'2026-10-23'});
 await insert('client_system_accesses',{client_id:client.id,title:'Sistema fictício',login:'ficticio@example.invalid',password:'Valor fictício de validação'});
 const note=await insert('client_notes',{client_id:client.id,title:'Nota de validação',content:'Conteúdo manual',created_by:adminId});
 const topic=await insert('client_reference_topics',{client_id:client.id,title:'Referências de validação'});
 await insert('client_references',{client_id:client.id,topic_id:topic.id,title:'Referência de validação',url:'https://example.com/validation'});
 const invoice=await insert('client_invoices',{client_id:client.id,description:'Cobrança fictícia de validação',amount:1,due_date:'2026-10-23'});
 const column=await insert('kanban_columns',{name:'Coluna de validação'});
 const status=await insert('task_statuses',{name:'Status de validação'});
 const tag=await insert('task_tags',{name:'Etiqueta de validação'});
 const task=await insert('tasks',{title:'Tarefa de validação',created_by:adminId,client_id:client.id,assignee_id:adminId,column_id:column.id,status_id:status.id,due_date:'2026-10-23T15:00:00Z'});
 await insert('task_tag_links',{task_id:task.id,tag_id:tag.id});
 const subtask=await insert('subtasks',{task_id:task.id,title:'Etapa de validação',assignee_id:adminId});
 await insert('comments',{task_id:task.id,author_id:adminId,body:'Conversa de validação'});
 await insert('task_history',{task_id:task.id,user_id:adminId,action:'updated'});
 await query('concluir tarefa',"update public.tasks set status='done',completed_at=now() where id=$1",[task.id]);
 await query('lixeira',"update public.tasks set deleted_at=now(),deleted_by=$2 where id=$1",[task.id,adminId]);
 await query('restaurar tarefa',"update public.tasks set deleted_at=null,deleted_by=null where id=$1 returning id",[task.id]);
 const post=await insert('mural_posts',{title:'Mural de validação',content:'Comunicado fictício',created_by:adminId});
 await insert('mural_post_reactions',{post_id:post.id,user_id:adminId,emoji:'👍'});
 await insert('mural_post_reads',{post_id:post.id,user_id:adminId});
 const event=await insert('calendar_events',{title:'Evento interno de validação',starts_at:'2026-10-23T15:00:00Z',ends_at:'2026-10-23T16:00:00Z',created_by:adminId});
 await query('editar evento',"update public.calendar_events set title='Evento interno editado' where id=$1 returning id",[event.id]);
 const opportunity=await insert('crm_opportunities',{workspace_id:workspace,title:'Oportunidade fictícia',client_id:client.id});
 await query('mover CRM',"update public.crm_opportunities set stage='proposta' where id=$1 returning id",[opportunity.id]);
 const request=await insert('service_requests',{title:'Solicitação de validação',client_id:client.id,created_by:adminId});
 await insert('service_request_messages',{request_id:request.id,body:'Mensagem de validação',author_id:adminId});
 const obligation=await insert('obligations',{workspace_id:workspace,title:'Obrigação de validação',days_of_month:[23],created_by:adminId,assignee_id:adminId,client_id:client.id});
 const obligationOccurrence=await insert('obligation_occurrences',{workspace_id:workspace,obligation_id:obligation.id,due_date:'2026-10-23'});
 await query('criar tarefa de obrigação','select public.create_obligation_task($1)',[obligationOccurrence.id]);
 await query('concluir obrigação','select public.complete_obligation_occurrence($1)',[obligationOccurrence.id]);
 const meeting=await insert('recurring_meetings',{workspace_id:workspace,title:'Reunião interna de validação',days_of_month:[23],created_by:adminId,assignee_id:adminId,client_id:client.id,is_recurring:false,auto_smart_notes:false});
 const occurrence=await insert('recurring_meeting_occurrences',{workspace_id:workspace,recurring_meeting_id:meeting.id,due_date:'2026-10-23'});
 await insert('recurring_meeting_agenda_items',{occurrence_id:occurrence.id,title:'Pauta de validação',result:'done',created_by:adminId});
 await query('encerrar reunião','select public.complete_recurring_meeting_occurrence($1)',[occurrence.id]);
 await query('perfil',"update public.profiles set full_name='Nome de validação' where id=$1 returning id",[adminId]);
 console.log('PASS: clientes, unidades, departamentos, pessoas, notas, datas, acessos, referências, financeiro, colunas, status, etiquetas, tarefas, subtarefas, conversas, lixeira/restauração, mural, agenda interna, CRM, solicitações, obrigações, reuniões e perfil.');
}catch(error){console.error('FAIL '+stage+': '+error.message);process.exitCode=1}finally{await db.query('ROLLBACK');await db.end();console.log('Transação de validação revertida; dados existentes preservados.')}
