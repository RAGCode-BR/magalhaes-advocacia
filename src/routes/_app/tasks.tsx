import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { KanbanSquare, List as ListIcon, Calendar as CalIcon, Search, X } from "lucide-react";
import { useClients, useTasks, useTaskStatuses, type Task } from "@/hooks/use-data";
import { TaskDialog } from "@/components/TaskDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SlidingThumb } from "@/components/SlidingThumb";
import { LayoutGroup } from "motion/react";

export const Route = createFileRoute("/_app/tasks")({
  component: TasksLayout,
});

function TasksLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [taskSearch, setTaskSearch] = useState("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const { data: tasks = [], isLoading: loadingTasks } = useTasks();
  const { data: clients = [] } = useClients();
  const { data: statuses = [] } = useTaskStatuses();
  const clientNames = useMemo(
    () => new Map(clients.map((client) => [client.id, client.name])),
    [clients],
  );
  const completedStatusIds = useMemo(
    () => new Set(statuses.filter((status) => status.is_completed).map((status) => status.id)),
    [statuses],
  );
  const searchResults = useMemo(() => {
    const normalize = (value: string) =>
      value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR");
    const term = normalize(taskSearch.trim());
    if (!term) return [];
    return tasks
      .filter((task) => normalize(task.title).includes(term))
      .sort((first, second) => {
        const firstDone =
          first.status === "done" ||
          !!first.completed_at ||
          (!!first.status_id && completedStatusIds.has(first.status_id));
        const secondDone =
          second.status === "done" ||
          !!second.completed_at ||
          (!!second.status_id && completedStatusIds.has(second.status_id));
        return (
          Number(firstDone) - Number(secondDone) || first.title.localeCompare(second.title, "pt-BR")
        );
      });
  }, [completedStatusIds, taskSearch, tasks]);
  const searching = taskSearch.trim().length > 0;
  const views = [
    { to: "/tasks/kanban", label: "Kanban", icon: KanbanSquare },
    { to: "/tasks/list", label: "Lista", icon: ListIcon },
    { to: "/tasks/calendar", label: "Calendário", icon: CalIcon },
  ] as const;
  return (
    <div className="flex flex-col">
      <div className="glass-surface sticky top-0 z-30 flex min-w-0 flex-wrap items-center gap-2 px-3 py-1.5 sm:px-4">
        <div className="relative w-full sm:w-72 lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={taskSearch}
            onChange={(event) => setTaskSearch(event.target.value)}
            placeholder="Buscar tarefa pelo título..."
            aria-label="Buscar tarefas pelo título"
            className="h-8 rounded-full pl-9 pr-9"
          />
          {taskSearch && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
              aria-label="Limpar busca"
              onClick={() => setTaskSearch("")}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <LayoutGroup id="task-views">
        <div className="flex w-full min-w-0 items-center gap-3 overflow-x-auto sm:ml-auto sm:w-auto">
          <span className="hidden shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground lg:inline">
            Visualizar
          </span>
          <div className="glass-track flex w-full min-w-0 rounded-full p-0.5 sm:inline-flex sm:w-auto sm:shrink-0">
            {views.map((v) => {
              const active = pathname === v.to || pathname.startsWith(v.to + "/");
              const Icon = v.icon;
              return (
                <Link
                  key={v.to}
                  to={v.to}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex min-w-0 flex-1 items-center justify-center rounded-full px-1 py-1 text-center text-xs leading-tight transition-colors sm:flex-none sm:px-3 sm:text-sm ${
                    active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {active && <SlidingThumb layoutId="task-view-thumb" />}
                  <span className="relative flex items-center gap-1.5 sm:gap-2">
                    <Icon className={`h-4 w-4 ${active ? "text-primary" : ""}`} />
                    {v.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
        </LayoutGroup>
      </div>
      {searching && (
        <div className="space-y-3 p-4 sm:p-6">
          <p className="text-sm text-muted-foreground">
            {loadingTasks
              ? "Buscando tarefas..."
              : `${searchResults.length} ${searchResults.length === 1 ? "tarefa encontrada" : "tarefas encontradas"} em todos os clientes, abertas e concluídas.`}
          </p>
          {!loadingTasks && searchResults.length === 0 ? (
            <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
              Nenhuma tarefa com esse título.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card">
              {searchResults.map((task) => {
                const completed =
                  task.status === "done" ||
                  !!task.completed_at ||
                  (!!task.status_id && completedStatusIds.has(task.status_id));
                return (
                  <button
                    key={task.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-4 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/50"
                    onClick={() => setSelectedTask(task)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{task.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {clientNames.get(task.client_id ?? "") ?? "Sem cliente"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {completed ? "Concluída" : "Aberta"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div className={searching ? "hidden" : "contents"}>
        <Outlet />
      </div>
      <TaskDialog
        open={!!selectedTask}
        onOpenChange={(open) => {
          if (!open) setSelectedTask(null);
        }}
        task={selectedTask}
      />
    </div>
  );
}
