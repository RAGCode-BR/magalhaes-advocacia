# Magalhães no Neon

Projeto exclusivo `dawn-term-03972586`, banco `magalhaes`, branch `production`.
O PostgreSQL contém somente a estrutura independente; os cadastros locais não são migrados.

O e-mail do administrador inicial é configurado no arquivo privado. O administrador abre **Usuários → Novo usuário**, informa nome, e-mail, senha inicial (8 a 128 caracteres), categoria e permissões. O usuário já pode entrar com essas credenciais e trocar a própria senha em **Personalizar → Redefinir senha**, informando a senha atual. Não há cadastro público, convite ou confirmação por e-mail. A criação da identidade, credencial e permissões é atômica e restrita ao administrador. Senhas iniciais são convertidas no navegador para o hash scrypt compatível com Better Auth; somente o hash é enviado à função SQL protegida. A troca da própria senha é validada pelo serviço Neon Auth e revoga as outras sessões do usuário.

A conexão PostgreSQL está apenas em `.env.neon.local`, ignorado pelo Git. Nunca use essa conexão em variável `VITE_*`. O site recebe somente `VITE_NEON_URL`, endereço público das APIs. Contas desativadas ou bloqueadas não podem acessar as tabelas. Marketing permanece indisponível.

Arquivos são guardados no PostgreSQL com as políticas de acesso dos anexos, até 50 MB por arquivo; o uso conta na cota de armazenamento Neon. URLs de visualização são temporárias no navegador. Atualizações entre telas usam consulta autorizada a cada 10 segundos (PG17 não tem o serviço Neon Realtime).

Google Calendar/Meet e IA dependem de serviços e credenciais próprias no servidor e ainda não estão conectados ao Neon. Suas telas continuam disponíveis, mas as operações externas informam a configuração pendente. Recuperação de senha esquecida ainda precisa de fluxo próprio; a troca com a senha atual já funciona em Personalizar.

## Verificação

- `node scripts/check-neon.mjs`: contagens e RLS.
- `node scripts/test-neon-access.mjs`: administrador, cliente, tarefa, subtarefa, arquivo e convite em uma transação sempre revertida. Todos os dados criados são descartáveis e revertidos.
- `node scripts/test-neon-http.mjs`: criação de login pelo administrador, login com a senha inicial, CRUD, troca da própria senha, rejeição da senha antiga e de acesso não autorizado. Usa o administrador de ACESSO-ONLINE.local e remove a identidade descartável ao fim.
- `npm test` e `npm run build:pages`.

`neon/schema.sql` é um dump somente da estrutura pública da instalação local independente, sem dados, permissões ou identidades da consultoria. `access.sql`, `files.sql`, `users.sql`, `identity.sql`, `hardening.sql`, `defaults.sql`, `password-login.sql`, `direct-users.sql` e `no-client-mirror.sql` contêm a adaptação Neon aplicada na ordem indicada.

O ambiente local anterior continua disponível com `npm run local`. Para usar Neon ao desenvolver, configure `VITE_NEON_URL` em um arquivo `.local`; essa opção tem prioridade sobre Supabase local.

## Clientes e espelhamento

Esta instalação tem somente o ambiente Consultoria. O trigger herdado `trg_sync_consultoria_client_to_marketing` foi removido: sem o workspace Marketing, a atribuição automática de ambiente fazia a cópia voltar para Consultoria. A migração local equivalente está em `supabase/migrations/20261021140000_magalhaes_disable_client_mirror.sql`.

`node scripts/test-neon-clients.mjs` testa a criação pela API com o cliente real do aplicativo e verifica que criar, editar, arquivar e restaurar mantêm exatamente uma linha. O registro de teste é removido ao final. A correção não impõe unicidade por nome; empresas distintas podem ter nomes iguais.
