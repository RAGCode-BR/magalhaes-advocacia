// TaskFlow connector on Cloudflare Workers: the public HTTPS address each person
// adds to Claude (Settings > Connectors). Same tools and RLS as server.ts.
import { Hono, type Context } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpAuth, type McpAuth } from "@neon/oauth/mcp";
import { honoMcp, type McpAuthVariables } from "@neon/oauth/mcp/hono";
import pg from "pg";
import { newServer } from "./mcp-server.ts";
import { neonServiceUrls } from "./neon-data.ts";

type Env = {
  /** Neon Data API URL of the branch (same as the app's VITE_NEON_URL). */
  NEON_URL: string;
  /** This worker's public MCP endpoint, e.g. https://taskflow-mcp.<conta>.workers.dev/mcp */
  MCP_RESOURCE_URL: string;
  NEON_AUTH_BASE_URL?: string;
  /** Secret: login taskflow_mcp from neon/mcp-role.sql. */
  MCP_DATABASE_URL: string;
};

let cachedAuth: { key: string; auth: McpAuth } | null = null;
function authFor(env: Env) {
  const issuer = env.NEON_AUTH_BASE_URL || neonServiceUrls(env.NEON_URL).auth;
  const key = `${issuer} ${env.MCP_RESOURCE_URL}`;
  if (cachedAuth?.key !== key) {
    cachedAuth = { key, auth: createMcpAuth({ baseUrl: issuer, resource: env.MCP_RESOURCE_URL }) };
  }
  return cachedAuth.auth;
}

const app = new Hono<McpAuthVariables & { Bindings: Env }>();

// The guard needs this request's env, so it is built (and cached) on first use.
app.use((c, next) => honoMcp(authFor(c.env))(c as unknown as Context<McpAuthVariables>, next));

app.post("/mcp", async (c) => {
  // Workers cannot share sockets between requests: one short-lived pool per call.
  const pool = new pg.Pool({ connectionString: c.env.MCP_DATABASE_URL, max: 1 });
  try {
    // JSON responses keep the whole tool call inside this request, before the pool closes.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await newServer(pool).connect(transport);
    return await transport.handleRequest(c.req.raw, { authInfo: c.get("authInfo") });
  } finally {
    c.executionCtx.waitUntil(pool.end());
  }
});
// Stateless server: no SSE stream or session to resume or end.
app.all("/mcp", (c) => c.body(null, 405, { Allow: "POST" }));
app.get("/", (c) => c.text("Conector TaskFlow (Magalhães Advocacia). Adicione o endereço /mcp no Claude."));

export default app;
