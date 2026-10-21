> O banco online escolhido para esta instalação é o Neon. Consulte [NEON.md](NEON.md). Este documento permanece como referência da alternativa Supabase e do ambiente local.

# Instalação exclusiva — Magalhães Advocacia

Status em 20/10/2026: banco local exclusivo instalado e validado com login, clientes, tarefas, subtarefas, anexos e convites de teste. O projeto Supabase online ainda não foi criado. Nenhum banco da consultoria foi vinculado ou alterado. Os passos abaixo tratam da instalação online; o ambiente local está descrito ao final.

1. Crie um projeto Supabase exclusivo da Magalhães. Não reutilize o banco da consultoria.
2. Com a CLI Supabase autenticada, vincule **somente o project ref novo**: `npx supabase link --project-ref REF_NOVO_DA_MAGALHAES`.
3. Aplique o histórico em `supabase/migrations/` com `npx supabase db push`. A migration final nomeia o ambiente Magalhães e impede acessos ao Marketing. Não aplique estas migrations em outro banco. Se uma migration falhar, registre o erro e ajuste antes de continuar; não pule etapas. O histórico usa pg_cron para reuniões recorrentes.
4. Em Auth > URL Configuration, configure a Site URL como `https://ragcode-br.github.io/magalhaes-advocacia/` e autorize os redirects `https://ragcode-br.github.io/magalhaes-advocacia/auth**` e `http://localhost:5180/magalhaes-advocacia/auth**`.
5. Copie a Project URL e a chave pública/anon para `.env.local` (`VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`). Não use service_role no frontend.
6. No GitHub, Settings > Secrets and variables > Actions > Variables, crie essas mesmas duas variáveis e execute o workflow de publicação novamente.
7. Publique as funções: `npm run build:edge` e `npx supabase functions deploy`. Configure `INVITE_REDIRECT_URL=https://ragcode-br.github.io/magalhaes-advocacia/auth?invite=1` nos secrets do Supabase. Configure SMTP para os convites do escritório.
8. Antes do primeiro convite online, insira o email autorizado no SQL Editor do **projeto novo**: `INSERT INTO public.access_invitations (email, expires_at) VALUES ('EMAIL_DO_ADMINISTRADOR_EM_MINUSCULAS', now() + interval '48 hours') ON CONFLICT (email) DO UPDATE SET expires_at = EXCLUDED.expires_at;`. Convide o primeiro administrador pelo painel Supabase Auth. Após o usuário aceitar o convite e definir a senha, execute `supabase/bootstrap-admin.sql`, substituindo o email indicado pelo email real do administrador. O script não cria senha e não altera usuários de outros projetos.
9. Para IA, configure `GEMINI_API_KEY` e `GEMINI_MODEL` nos secrets do Supabase. Para Calendar/Meet, configure `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_SHARED_CALENDAR_ID` e `TASKFLOW_APP_URL`. Ajuste o callback OAuth para o novo projeto. Não copie tokens, credenciais, calendários ou contas do sistema original.
10. Verifique login, convite de colaborador, criação/edição de cliente e tarefa, subtarefas/anexos, permissões, Kanban, agenda, relatórios e importação de ata com um usuário de teste. Confirme que não aparece a opção Marketing. Revise Storage, Realtime e os jobs do pg_cron no projeto novo.

## Limites da publicação estática

O GitHub Pages hospeda o frontend. Dados, autenticação, arquivos e integrações usam o projeto Supabase próprio. A IA usa `taskflow-ai`; esse endpoint autentica a sessão antes de executar os mesmos validadores e handlers do sistema original. Todas as consultas e gravações dessa função seguem as políticas do usuário, sem service_role.

As funções Google e administração também devem ser publicadas no novo Supabase. Sem esses serviços e secrets, o código está presente, mas os recursos correspondentes ainda não estão operacionais. A validação do build e dos testes locais não comprova a instalação do banco nem as integrações.

## Ambiente local neste Mac

A cópia também pode usar um Supabase local completo, sem projeto online. Abra o Docker Desktop e execute `npm run local` na pasta do sistema. A primeira execução baixa os componentes; as seguintes reutilizam o banco existente. O frontend abre em `http://localhost:5180/magalhaes-advocacia/`.

O comando cria o usuário administrativo `admin@magalhaes.local`. A senha gerada fica no arquivo **ACESSO-LOCAL.local**, ignorado pelo Git e com leitura restrita ao usuário do Mac. Não é uma conta do site público. As credenciais do banco são escritas em `.env.development.local`, usado somente pelo desenvolvimento; builds de publicação continuam usando as variáveis próprias do GitHub.

- API local: `http://127.0.0.1:55441`
- Banco PostgreSQL: porta `55442`, no volume Docker `supabase_db_magalhaes-advocacia`
- Painel do banco (Studio): `http://127.0.0.1:55443`
- Caixa de emails de teste: `http://127.0.0.1:55444` (convites locais não chegam a caixas externas)

`Ctrl+C` encerra a interface e as funções locais. Para parar também os containers, use `npm run local:stop`. Os dados continuam salvos. Para retomar, abra o Docker e execute `npm run local`. **Não use `db reset` nem `stop --no-backup` para reiniciar**, pois esses comandos apagam os cadastros locais.

IA e integrações Google precisam das credenciais próprias dos provedores. Para testar IA localmente, acrescente `GEMINI_API_KEY` e `GEMINI_MODEL` ao arquivo ignorado `.env.functions.local` e reinicie `npm run local`. O acesso público pelo GitHub Pages continuará separado desse ambiente.
