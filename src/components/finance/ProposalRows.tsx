import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fieldClass } from "@/lib/office-finance-data";

export type RowField<K extends string> = {
  key: K;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  inputMode?: "decimal" | "numeric" | "text";
  /** Ocupa a linha inteira no computador. */
  wide?: boolean;
  required?: boolean;
};

/**
 * Lista editável de itens da proposta (empresas, processos cobrados à parte,
 * diferenciais, ampliações). Cada item é um cartão com os campos e um botão
 * para remover; os valores ficam no estado do formulário.
 */
export function ProposalRows<K extends string>({
  rows,
  setRows,
  fields,
  itemLabel,
  addLabel,
  empty,
}: {
  rows: Record<K, string>[];
  setRows: (rows: Record<K, string>[]) => void;
  fields: RowField<K>[];
  itemLabel: string;
  addLabel: string;
  empty: Record<K, string>;
}) {
  const update = (index: number, key: K, value: string) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="rounded-lg border bg-muted/30 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-foreground">
              {itemLabel} {index + 1}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-muted-foreground"
              aria-label={`Remover ${itemLabel.toLocaleLowerCase("pt-BR")} ${index + 1}`}
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <label
                key={field.key}
                className={cn(fieldClass, (field.wide || field.multiline) && "sm:col-span-2")}
              >
                {field.label}
                {field.multiline ? (
                  <Textarea
                    rows={2}
                    maxLength={600}
                    value={row[field.key]}
                    placeholder={field.placeholder}
                    required={field.required}
                    onChange={(event) => update(index, field.key, event.target.value)}
                  />
                ) : (
                  <Input
                    maxLength={200}
                    value={row[field.key]}
                    placeholder={field.placeholder}
                    inputMode={field.inputMode}
                    required={field.required}
                    onChange={(event) => update(index, field.key, event.target.value)}
                  />
                )}
              </label>
            ))}
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setRows([...rows, { ...empty }])}
      >
        <Plus className="h-4 w-4" /> {addLabel}
      </Button>
    </div>
  );
}
