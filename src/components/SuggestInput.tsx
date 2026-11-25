import { useId, useMemo, useRef, useState, type ComponentProps } from "react";
import { Check } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

/** Filters and orders suggestions: names starting with the typed text come first. */
export function filterSuggestions(options: readonly string[], query: string, limit = 50) {
  const term = normalize(query.trim());
  return [...new Set(options)]
    .filter((option) => !term || normalize(option).includes(term))
    .sort((a, b) => {
      const aStarts = normalize(a).startsWith(term) ? 0 : 1;
      const bStarts = normalize(b).startsWith(term) ? 0 : 1;
      return aStarts - bStarts || a.localeCompare(b, "pt-BR");
    })
    .slice(0, limit);
}

/**
 * Free-text field with a short, searchable list of suggestions in the app's own
 * style. Replaces <datalist>, whose native popup lists every option at full
 * screen height. The value still goes to the form through `name`.
 */
export function SuggestInput({
  options,
  defaultValue = "",
  emptyText = "Nenhuma sugestão. O texto digitado será usado.",
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "defaultValue" | "list"> & {
  options: readonly string[];
  defaultValue?: string;
  emptyText?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => filterSuggestions(options, value), [options, value]);
  const show = open && options.length > 0;

  function choose(option: string) {
    setValue(option);
    setOpen(false);
    setActive(-1);
  }

  return (
    <Popover open={show} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          {...props}
          className={cn("min-w-0", className)}
          ref={inputRef}
          value={value}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={show}
          aria-activedescendant={show && active >= 0 ? `${listId}-${active}` : undefined}
          onClick={() => setOpen(true)}
          onBlur={(event) => {
            setOpen(false);
            props.onBlur?.(event);
          }}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
            setActive(-1);
            props.onChange?.(event);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive((index) => Math.min(matches.length - 1, index + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(0, index - 1));
            } else if (event.key === "Enter" && show && active >= 0 && matches[active]) {
              event.preventDefault();
              choose(matches[active]);
            } else if (event.key === "Escape" && show) {
              // Close only the list, not the dialog around the field.
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
            props.onKeyDown?.(event);
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-56 p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          // A click on the field itself keeps the list open instead of toggling it.
          if (event.target instanceof Node && inputRef.current?.contains(event.target)) {
            event.preventDefault();
          }
        }}
      >
        <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto">
          {matches.map((option, index) => (
            <li
              key={option}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option === value}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                index === active && "bg-muted",
              )}
            >
              <Check
                className={cn("h-4 w-4 shrink-0", option === value ? "opacity-100" : "opacity-0")}
              />
              <span className="truncate">{option}</span>
            </li>
          ))}
          {!matches.length && (
            <li className="px-2 py-3 text-center text-sm text-muted-foreground">{emptyText}</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
