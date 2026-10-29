# TaskFlow MCP (prova de conceito)

Conector MCP para cada pessoa ligar o próprio Claude à própria conta do TaskFlow. A pessoa entra com o login dela (OAuth do Neon Auth). O conector verifica o token e consulta o banco como aquela pessoa, sob as mesmas políticas RLS do app.

Ferramentas atuais, somente leitura:

- `meus_ambientes`: ambientes que a pessoa pode acessar.
- `listar_cards`: cards abertos de um ambiente, ordenados por prazo.

## Por que não usa o Data API

O token OAuth não traz a claim `role`, então o Data API o trata como anônimo (`permission denied`). O Data API aceita um único provedor de JWT, que já é o Neon Auth, e o Neon não permite conceder o papel `authenticated` a outro login.

Por isso [neon/mcp-role.sql](../neon/mcp-role.sql) cria:

- `taskflow_mcp_user`: espelha os privilégios de `authenticated` e entra em todas as políticas RLS dele.
- `taskflow_mcp`: o login do conector, que só pode assumir `taskflow_mcp_user`. Não tem DDL, `BYPASSRLS` nem acesso a `neon_auth`.

Cada chamada roda numa transação com `set local role taskflow_mcp_user` e `request.jwt.claims.sub` = usuário verificado ([db.ts](db.ts)).

**Rode `neon/mcp-role.sql` de novo após qualquer migração que crie políticas, tabelas ou funções para `authenticated`.** O servidor avisa na inicialização quando falta alguma política. Enquanto isso, o conector simplesmente não vê os dados novos: falha fechada.

## Rodar localmente

```bash
cd mcp
npm install
cp .env.example .env   # branch de teste + senha do taskflow_mcp
npm start
```

## Pré-requisitos no Neon

1. OAuth provider ativo no branch (**Settings > Better Auth**), com **Server URL** igual a `MCP_RESOURCE_URL`.
2. Páginas de login e consentimento hospedadas (pendente no TaskFlow).
3. `neon/mcp-role.sql` aplicado e senha do `taskflow_mcp` definida fora do repositório.
