# Magalhães Advocacia

Cópia independente do Taskfloww da consultoria, com identidade vinho e dourado e a marca fornecida pelo escritório. Base: RAGCodeBR/taskflow, commit 95dcff21a087ecdd58e89fe55ec2bc4b32c949c6 (versão publicada em 19/10/2026). Mantém os módulos de tarefas, subtarefas, Kanban, listas, calendários, clientes, arquivos, conversas, mural, reuniões, atas, obrigações, CRM, relatórios, portal do cliente e administração. O Marketing foi desabilitado.

## Editar no VS Code

Abra `Magalhães Advocacia.code-workspace` nesta pasta. No terminal:

```sh
npm ci
npm run dev
```

Acesse http://localhost:5180/magalhaes-advocacia/. A edição dos arquivos em `src/` aparece no navegador durante o desenvolvimento. A marca está em `src/assets/magalhaes-logo.png`; as cores estão no final de `src/styles.css`.

## Publicação

Repositório: https://github.com/RAGCode-BR/magalhaes-advocacia

Site: https://ragcode-br.github.io/magalhaes-advocacia/

Push na branch `main` executa testes, build e publicação pelo GitHub Actions. Para validar antes de publicar: `npm test` e `npm run build:pages`. Mudanças locais só são publicadas após commit e push.

## Banco exclusivo: instalação pendente

Não há credenciais nem dados da consultoria nesta instalação. O login fica desabilitado até conectar o novo projeto Supabase. Siga [o guia de instalação](docs/SUPABASE-NOVO.md). A publicação do frontend não ativa banco, convites, integrações Google ou IA por conta própria.

As operações de IA que antes dependiam do servidor foram adaptadas para a Edge Function `taskflow-ai`. O build gera `supabase/functions/taskflow-ai/handlers.js` a partir dos validadores e operações originais. A importação de tarefas usa o JWT do usuário e as políticas RLS. As chaves Gemini e Google ficam nos secrets do Supabase.
