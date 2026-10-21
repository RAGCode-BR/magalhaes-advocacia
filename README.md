## Publicação Magalhães e banco Neon

Acesso público: https://ragcode-br.github.io/magalhaes-advocacia/

O banco online é Neon e começa vazio. O único administrador inicial usa o e-mail do titular configurado no arquivo privado; use **Primeiro acesso / aceitar convite** e confirme o código enviado ao e-mail. Novos acessos são autorizados pelo titular na tela Usuários. Consulte [docs/NEON.md](docs/NEON.md) para operação, limites e validação.

O ambiente local Supabase abaixo continua independente e disponível para testes neste Mac.

# Magalhães Advocacia

Cópia independente do Taskfloww da consultoria, com identidade vinho e dourado e a marca fornecida pelo escritório. Base: RAGCodeBR/taskflow, commit 95dcff21a087ecdd58e89fe55ec2bc4b32c949c6 (versão publicada em 19/10/2026). Mantém os módulos de tarefas, subtarefas, Kanban, listas, calendários, clientes, arquivos, conversas, mural, reuniões, atas, obrigações, CRM, relatórios, portal do cliente e administração. O Marketing foi desabilitado.

## Editar no VS Code

Abra `Magalhães Advocacia.code-workspace` nesta pasta. No terminal:

```sh
npm ci
npm run local
```

Abra o Docker Desktop antes de iniciar. O comando prepara o banco exclusivo e as funções locais. O acesso administrativo fica em `ACESSO-LOCAL.local`. Os cadastros persistem entre sessões.

Acesse http://localhost:5180/magalhaes-advocacia/. A edição dos arquivos em `src/` aparece no navegador durante o desenvolvimento. A marca está em `src/assets/magalhaes-logo.png`; as cores estão no final de `src/styles.css`.

## Publicação

Repositório: https://github.com/RAGCode-BR/magalhaes-advocacia

Site: https://ragcode-br.github.io/magalhaes-advocacia/

Push na branch `main` executa testes, build e publicação pelo GitHub Actions. Para validar antes de publicar: `npm test` e `npm run build:pages`. Mudanças locais só são publicadas após commit e push.

## Banco exclusivo local e publicação online

O ambiente local usa um Supabase completo neste Mac, separado da consultoria, com login administrativo, banco e arquivos persistentes. Inicie com `npm run local` e consulte o acesso em `ACESSO-LOCAL.local`. Os exemplos de cliente, tarefa, subtarefa e arquivo foram gravados no banco local para validar os fluxos.

O Supabase **online** ainda precisa ser criado e conectado ao GitHub Pages para liberar o acesso público. Siga [o guia de instalação](docs/SUPABASE-NOVO.md). Os dados locais não são enviados ao site público. Google e IA precisam das credenciais próprias dos provedores.

As operações de IA que antes dependiam do servidor foram adaptadas para a Edge Function `taskflow-ai`. O build gera `supabase/functions/taskflow-ai/handlers.js` a partir dos validadores e operações originais. A importação de tarefas usa o JWT do usuário e as políticas RLS. As chaves Gemini e Google ficam nos secrets do Supabase.
