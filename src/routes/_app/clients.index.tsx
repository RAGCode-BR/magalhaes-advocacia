import { createFileRoute } from "@tanstack/react-router";
import { ClientsIndexPage } from "./clients";
import { ClientCalendarPage } from "@/components/ClientCalendarPage";

export const Route = createFileRoute("/_app/clients/")({
  validateSearch: (search: Record<string, unknown>): { client?: string } =>
    typeof search.client === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search.client)
      ? { client: search.client }
      : {},
  component: Page,
});

function Page() {
  const { client } = Route.useSearch();
  return client ? <ClientCalendarPage clientId={client} /> : <ClientsIndexPage />;
}
