import { createFileRoute } from "@tanstack/react-router";
import { ClaudeLoginPage } from "@/components/ClaudeAuthorization";

export const Route = createFileRoute("/oauth/login")({ component: ClaudeLoginPage });
