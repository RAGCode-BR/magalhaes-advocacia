# Magalhães no Neon

Projeto exclusivo `dawn-term-03972586`, banco `magalhaes`, branch `production`.
O PostgreSQL contém somente a estrutura independente; os cadastros locais não são migrados.

O e-mail do administrador inicial é configurado no arquivo privado. O acesso é direto com e-mail e senha, sem código por e-mail. Novos usuários autorizados abrem **Ativar acesso autorizado** e definem sua senha. O banco rejeita qualquer outro cadastro sem convite válido. O administrador cria convites pela tela Usuários; o link é copiado para compartilhamento e vale por 7 dias. O destinatário ativa o e-mail cadastrado. Não há envio automático de convite pelo sistema.

A conexão PostgreSQL está apenas em `.env.neon.local`, ignorado pelo Git. Nunca use essa conexão em variável `VITE_*`. O site recebe somente `VITE_NEON_URL`, endereço público das APIs. Contas desativadas ou bloqueadas não podem acessar as tabelas. Marketing permanece indisponível.

Arquivos são guardados no PostgreSQL com as políticas de acesso dos anexos, até 50 MB por arquivo; o uso conta na cota de armazenamento Neon. URLs de visualização são temporárias no navegador. Atualizações entre telas usam consulta autorizada a cada 10 segundos (PG17 não tem o serviço Neon Realtime).

Google Calendar/Meet e IA dependem de serviços e credenciais próprias no servidor e ainda não estão conectados ao Neon. Suas telas continuam disponíveis, mas as operações externas informam a configuração pendente. Recuperação e troca de senha Neon ainda precisam de fluxo próprio; o administrador não define senhas de outras pessoas.

## Verificação

- `node scripts/check-neon.mjs`: contagens e RLS.
- `node scripts/test-neon-access.mjs`: administrador, cliente, tarefa, subtarefa, arquivo e convite em uma transação sempre revertida. Todos os dados criados são descartáveis e revertidos.
- `node scripts/test-neon-http.mjs`: login real no Neon e CRUD pela API com identidade descartável, removida ao fim.
- `npm test` e `npm run build:pages`.

`neon/schema.sql` é um dump somente da estrutura pública da instalação local independente, sem dados, permissões ou identidades da consultoria. `access.sql`, `files.sql`, `users.sql`, `identity.sql`, `hardening.sql`, `defaults.sql` e `password-login.sql` contêm a adaptação Neon aplicada na ordem indicada.

O ambiente local anterior continua disponível com `npm run local`. Para usar Neon ao desenvolver, configure `VITE_NEON_URL` em um arquivo `.local`; essa opção tem prioridade sobre Supabase local.
