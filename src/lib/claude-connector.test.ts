import { describe, expect, it } from "vitest";
import {
  CLAUDE_REQUEST_LIMIT,
  askClaudeUrl,
  buildClaudeRequest,
  neonAuthIssuer,
  oauthQueryFrom,
  redirectHost,
  screenContext,
} from "./claude-connector";

const CLIENT = { id: "6f1c2d3e-0000-4000-8000-000000000001", name: "Cliente Exemplo" };

describe("Claude connector helpers", () => {
  it("derives the Neon Auth issuer like the data client", () => {
    expect(neonAuthIssuer("https://ep-test.c-6.us-east-2.aws.neon.tech/magalhaes")).toBe(
      "https://ep-test.neonauth.c-6.us-east-2.aws.neon.tech/magalhaes/auth",
    );
    expect(neonAuthIssuer("")).toBeNull();
  });

  it("keeps the signed authorization query exactly as received", () => {
    const signed = "?client_id=a&ba_param=ba_iat&ba_param=sig&sig=x%3D";
    expect(oauthQueryFrom(signed)).toBe("client_id=a&ba_param=ba_iat&ba_param=sig&sig=x%3D");
  });

  it("shows only the host the code returns to", () => {
    expect(redirectHost("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
    expect(redirectHost("não é url")).toBe("endereço desconhecido");
  });

  it("builds a free request with the screen context and opens it in Claude", () => {
    const request = buildClaudeRequest(
      "  crie um card para amanhã ",
      'o cliente "Cliente Exemplo"',
    );
    expect(request).toBe(
      'Use o conector do TaskFlow. Contexto: estou vendo o cliente "Cliente Exemplo" no TaskFlow. crie um card para amanhã',
    );
    expect(askClaudeUrl(request)).toMatch(/^https:\/\/claude\.ai\/new\?q=Use%20o%20conector/);
    expect(buildClaudeRequest("   ")).toBe("");
    expect(buildClaudeRequest("x".repeat(CLAUDE_REQUEST_LIMIT + 50))).toHaveLength(
      "Use o conector do TaskFlow. ".length + CLAUDE_REQUEST_LIMIT,
    );
  });

  it("names the client on a client page and the screen elsewhere", () => {
    expect(screenContext(`/magalhaes-advocacia/clients/${CLIENT.id}/edit`, [CLIENT])).toBe(
      'o cliente "Cliente Exemplo"',
    );
    expect(screenContext("/magalhaes-advocacia/tasks/kanban")).toBe("a Gestão de processos");
    expect(screenContext("/magalhaes-advocacia/claude")).toBeNull();
  });
});
