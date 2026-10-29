import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpAuth } from "@neon/oauth/mcp";
import { expressMcp } from "@neon/oauth/mcp/express";
import pg from "pg";
import { connectorDrift } from "./db.ts";
import { newServer } from "./mcp-server.ts";
import { neonServiceUrls } from "./neon-data.ts";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Defina ${name} (veja mcp/.env.example).`);
  return value;
};

const urls = neonServiceUrls(required("NEON_URL"));
const resource = required("MCP_RESOURCE_URL");
const issuer = process.env.NEON_AUTH_BASE_URL ?? urls.auth;
const auth = createMcpAuth({ baseUrl: issuer, resource });
// Login taskflow_mcp only (neon/mcp-role.sql): it can act as one verified user, never as owner.
const pool = new pg.Pool({ connectionString: required("MCP_DATABASE_URL"), max: 5 });

const missing = await connectorDrift(pool);
if (missing)
  console.warn(
    `${missing} diferença(s) de acesso entre o conector e o app: rode neon/mcp-role.sql novamente.`,
  );

const app = express();
app.use(expressMcp(auth));
app.use(express.json({ limit: "1mb" }));
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());
  await newServer(pool).connect(transport);
  await transport.handleRequest(req, res, req.body);
});
// Stateless server: no SSE stream or session to resume or end.
app.all("/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () =>
  console.log(`TaskFlow MCP em http://localhost:${port}/mcp (recurso: ${resource})`),
);
