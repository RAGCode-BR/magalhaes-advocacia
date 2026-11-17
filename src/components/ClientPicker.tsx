import { useId, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type PickerClient = { id: string; name: string; is_active?: boolean | null };

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

/**
 * Searchable client field: type part of the name (accents ignored) and pick with
 * click or Enter. Inactive clients are hidden unless already selected.
 */
export function ClientPicker({
  clients,
  value,
  onChange,
  placeholder = "Digite o nome do cliente",
  emptyLabel,
  required = false,
  disabled = false,
  id,
  className,
  "aria-label": ariaLabel,
}: {
  clients: PickerClient[];
  value: string;
  onChange: (id: string, client?: PickerClient) => void;
  placeholder?: string;
  /** Adds a first option that clears the field, e.g. "Sem cliente". */
  emptyLabel?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const selected = clients.find((client) => client.id === value);
  const options = useMemo(() => {
    const term = normalize(query.trim());
    const list = clients
      .filter((client) => client.is_active !== false || client.id === value)
      .filter((client) => !term || normalize(client.name).includes(term))
      .sort((a, b) => {
        // Names that start with the typed text come first.
        const aStarts = normalize(a.name).startsWith(term) ? 0 : 1;
        const bStarts = normalize(b.name).startsWith(term) ? 0 : 1;
        return aStarts - bStarts || a.name.localeCompare(b.name, "pt-BR");
      })
      .slice(0, 50);
    return [...(emptyLabel && !term ? [{ id: "", name: emptyLabel }] : []), ...list];
  }, [clients, query, value, emptyLabel]);

  function choose(client: PickerClient) {
    onChange(client.id, client.id ? client : undefined);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setActive(0);
        if (!next) setQuery("");
      }}
    >
      <div className={cn("relative", className)}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-label={ariaLabel}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected
                ? `${selected.name}${selected.is_active === false ? " (inativo)" : ""}`
                : value === "" && emptyLabel
                  ? emptyLabel
                  : placeholder}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
        {required && (
          // Keeps native form validation ("preencha este campo") working.
          <input
            tabIndex={-1}
            aria-hidden
            required
            value={value}
            onChange={() => undefined}
            className="pointer-events-none absolute inset-0 opacity-0"
          />
        )}
      </div>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-64 p-2">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            role="combobox"
            aria-controls={listId}
            aria-expanded
            aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
            value={query}
            placeholder="Digite para buscar…"
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(options.length - 1, index + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (options[active]) choose(options[active]);
              }
            }}
          />
        </div>
        <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto">
          {options.map((client, index) => (
            <li
              key={client.id || "empty"}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={client.id === value}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(client)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                index === active && "bg-muted",
                !client.id && "text-muted-foreground",
              )}
            >
              <Check
                className={cn(
                  "h-4 w-4 shrink-0",
                  client.id === value ? "opacity-100" : "opacity-0",
                )}
              />
              <span className="truncate">{client.name}</span>
            </li>
          ))}
          {!options.length && (
            <li className="px-2 py-3 text-center text-sm text-muted-foreground">
              Nenhum cliente encontrado.
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
