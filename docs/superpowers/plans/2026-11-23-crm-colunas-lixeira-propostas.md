# CRM: colunas livres e lixeira de propostas — plano

> Execução nativa (executing-plans). Checkbox por passo.

**Goal:** colunas do CRM criáveis/excluíveis com "Contrato fechado" fixa no fim, e lixeira de
propostas sincronizada com o lead do CRM.
**Architecture:** `crm_pipeline_stages` vira a fonte das colunas (FK composta do lead para a
coluna); exclusão lógica (`deleted_at`) em proposta e lead, escondida pelas políticas de leitura;
funções SECURITY DEFINER fazem exclusão, restauração e exclusão definitiva juntas.
**Tech Stack:** Neon Postgres (RLS, Data API), React 19, TanStack Query, Vitest.
**Spec:** docs/superpowers/specs/2026-11-23-crm-colunas-lixeira-propostas-design.md

## Global Constraints
- Coluna fixa: id `finalizado`, rótulo "Contrato fechado", sempre a última; não renomeia, não move, não exclui.
- Proposta que gerou Contas a receber (`generated_at` ou lançamentos com `group_id`) não pode ser excluída, nem o lead dela.
- Lixeira de propostas só para administradores. Migração no Neon só com OK do usuário.
- Lead manual (sem proposta) continua com exclusão definitiva, como hoje.

## Review Focus
- Excluir coluna com leads na lixeira: eles também migram para a coluna destino (restaurar nunca quebra).
- Proposta nova quando a coluna "novo" foi excluída: lead vai para a primeira coluna por posição.
- Colaborador do CRM (não admin) exclui lead com proposta: funciona e a proposta vai para a lixeira.
- Tentar renomear/excluir `finalizado` direto pela API: o banco recusa.
- Restaurar proposta já restaurada ou já excluída de vez: sem erro (idempotente).

### Task 1: Migração `20261123150000_crm_stages_and_proposal_trash.sql`
- Remove CHECKs fixos de `stage`/`stage_id`; novo CHECK de formato `^[a-z0-9_]{1,40}$`.
- Semeia colunas padrão para ambientes sem colunas + trigger ao criar ambiente; renomeia `finalizado` para "Contrato fechado".
- FK `(workspace_id, stage)` → `crm_pipeline_stages(workspace_id, stage_id)`.
- Trigger BEFORE INSERT em leads: coluna inexistente → primeira por posição (não `finalizado`).
- Trigger em `crm_pipeline_stages`: recusa alterar rótulo/cor de `finalizado`.
- `crm_delete_stage(target_workspace uuid, target_stage text, move_to text)`: move leads (inclusive na lixeira) e apaga a coluna; recusa `finalizado`.
- `deleted_at timestamptz` em `office_finance_agreements` e `crm_opportunities`; políticas de leitura escondem as excluídas.
- `office_finance_delete_proposal(target)` (redefinida, lógica), `crm_delete_opportunity(target)`,
  `office_finance_trashed_proposals()`, `office_finance_restore_proposal(target)`, `office_finance_purge_proposal(target)`.
- Validar em BEGIN/ROLLBACK no Neon com cenários do Review Focus; aplicar só com OK.

### Task 2: Lógica pura das colunas (`src/lib/crm-stages.ts` + teste)
- `orderStages(rows): StageRow[]` — ordena por posição, `finalizado` sempre por último.
- `newStageId(): string` — `c_` + 8 caracteres `[a-z0-9]`.
- `FINAL_STAGE = "finalizado"`.

### Task 3: CRM (`src/routes/_app/crm.tsx`)
- Colunas a partir de `orderStages`; "+ Nova coluna"; editor com Excluir (pede destino); coluna fixa sem arrastar/editar.
- Excluir lead via `crm_delete_opportunity`; texto do aviso conforme tenha proposta.

### Task 4: Propostas e Lixeira
- Texto de confirmação em `FinanceAgreements.tsx` (vai para a lixeira, lead sai do CRM).
- `trash.tsx`: abas Tarefas / Propostas (admin), restaurar e excluir de vez.

### Task 5: Novidade + miniatura; testes, lint, verificação no navegador (desktop e celular).
