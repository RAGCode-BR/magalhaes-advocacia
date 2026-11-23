# CRM: colunas livres e lixeira de propostas — design curto

## Por quê
Propostas e leads do CRM andam juntos (toda proposta cria um lead), mas a exclusão
não andava junto e não havia como desfazê-la. O funil tinha 6 colunas fixas no banco.

## O que muda
**Colunas do CRM**
- Criar coluna (nome e cor), renomear, reordenar e excluir as colunas comuns.
- Coluna fixa "Contrato fechado" (id `finalizado`): sempre a última, sem renomear,
  mover nem excluir. É a coluna de venda ganha do relatório do CRM.
- Excluir coluna com leads pede a coluna de destino; nenhum lead some.
- Proposta nova entra em "novo"; se essa coluna não existir, na primeira coluna do funil.
- Mover para "Contrato fechado" não gera Contas a receber (continua no botão "Gerar financeiro").

**Lead só nasce de proposta**
- Sem cadastro manual de lead no CRM (banco recusa INSERT; UPDATE só da coluna).
- Clicar no lead abre a proposta com os botões de Propostas (admin) e a coluna do funil.
- Textos de consultoria trocados por termos da advocacia (relatórios e miniaturas).

**Lixeira de propostas**
- Exclusão vira exclusão lógica (`deleted_at`) na proposta e no lead.
- Excluir a proposta → proposta na lixeira e lead fora do CRM.
- Excluir o lead → lead fora do CRM e proposta na lixeira.
- Restaurar → proposta e lead voltam (lead na coluna onde estava; se a coluna
  tiver sido excluída, na primeira do funil).
- Excluir de vez só na Lixeira, apaga os dois.
- Proposta que gerou Contas a receber: nem ela nem o lead podem ser excluídos.
- Aba "Propostas" na Lixeira, só para administradores (regra do Financeiro).

## Abordagens
1. **Escolhida:** `crm_pipeline_stages` vira a fonte das colunas (ids livres), sem o
   CHECK fixo; exclusão lógica com `deleted_at` e funções no banco que mantêm proposta
   e lead em sincronia.
2. Descartada: manter colunas fixas e só esconder/renomear — não cria colunas.
3. Descartada: lixeira em tabela separada (cópia) — duplica dados e complica restaurar.

## Restrições
- Migração no Neon só com OK do usuário, testada antes em transação desfeita.
- Nota de novidade com miniatura (AGENTS.md). Commit/push/deploy só com autorização.
