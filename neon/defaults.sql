-- Product defaults only, never copied client records.
INSERT INTO public.kanban_columns(workspace_id,name,color,position)
SELECT w.id,v.name,v.color,v.position FROM public.workspaces w CROSS JOIN (VALUES
 ('A Fazer','#501618',0),('Em Andamento','#8b343b',1),('Em Revisão','#bb9652',2),('Concluído','#328268',3)
) v(name,color,position) WHERE w.slug='consultoria' AND NOT EXISTS(SELECT 1 FROM public.kanban_columns c WHERE c.workspace_id=w.id);
INSERT INTO public.task_statuses(workspace_id,name,color,position,is_completed,is_active)
SELECT w.id,v.name,v.color,v.position,v.completed,v.active FROM public.workspaces w CROSS JOIN (VALUES
 ('A Fazer','#64748b',0,false,false),('Em Andamento','#8b343b',1,false,true),('Em Revisão','#bb9652',2,false,false),('Concluída','#328268',3,true,false)
) v(name,color,position,completed,active) WHERE w.slug='consultoria' AND NOT EXISTS(SELECT 1 FROM public.task_statuses s WHERE s.workspace_id=w.id);
INSERT INTO public.crm_pipeline_stages(workspace_id,stage_id,label,color)
SELECT w.id,v.id,v.label,v.color FROM public.workspaces w CROSS JOIN (VALUES
 ('atendendo','Atendendo','#16a77e'),('novo','Novos Leads','#3278d4'),('qualificado','Qualificados','#5b45ad'),('proposta','Proposta Enviada','#f06e43'),('negociacao','Em Negociação','#e9a400'),('finalizado','Finalizados','#208b43')
) v(id,label,color) WHERE w.slug='consultoria' ON CONFLICT DO NOTHING;
