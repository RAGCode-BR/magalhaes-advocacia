import { createFileRoute, Navigate } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/ambientes")({ component: () => <Navigate to="/dashboard" replace /> });
