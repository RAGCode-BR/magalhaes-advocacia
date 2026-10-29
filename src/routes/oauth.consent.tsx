import { createFileRoute } from "@tanstack/react-router";
import { ClaudeConsentPage } from "@/components/ClaudeAuthorization";

export const Route = createFileRoute("/oauth/consent")({ component: ClaudeConsentPage });
