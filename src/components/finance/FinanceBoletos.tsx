import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  currency,
  displayDate,
  isoToday,
  financeRpc,
  fieldClass,
  selectClass,
} from "@/lib/office-finance-data";
import type { FinanceEntry } from "@/lib/office-finance";
import { boletoPayer } from "@/lib/sicoob-boleto";
import {
  boletoAction,
  loadBoletos,
  type OfficeBoleto,
  type BoletoCursor,
} from "@/lib/office-boletos";
const states = {
  prepared: "Pronto para emitir",
  issuing: "Aguardando confirmação",
  issued: "Registrado no Sicoob",
  rejected: "Emissão recusada",
  uncertain: "Verificar no Sicoob",
};
export function FinanceBoletos({
  userId,
  entries,
  clients,
  onNewEntry,
}: {
  userId: string;
  entries: FinanceEntry[];
  clients: { id: string; name: string }[];
  onNewEntry: () => void;
}) {
  const qc = useQueryClient();
  const [pages, setPages] = useState<BoletoCursor[]>([]);
  const queryKey = ["office-boletos", userId];
  const query = useQuery({
    queryKey: [...queryKey, pages.at(-1)],
    queryFn: () => loadBoletos(pages.at(-1)),
  });
  const [form, setForm] = useState<OfficeBoleto | "new" | null>(null);
  const [selected, setSelected] = useState<OfficeBoleto | null>(null);
  const [recovery, setRecovery] = useState("");
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey });
  };
  const action = useMutation({
    mutationFn: ({ b, action }: { b: OfficeBoleto; action: "query" | "pdf" }) =>
      boletoAction(action, b.id, recovery || undefined),
    onSuccess: async (_, input) => {
      await refresh();
      if (input.action === "query") {
        setSelected(null);
        toast.success("Situação consultada no Sicoob.");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = query.data?.slice(0, 50) ?? [];
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-start justify-between gap-3 p-4 md:p-5">
        <div>
          <h2 className="text-lg font-semibold">Boletos Sicoob</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Emita a cobrança de um honorário em aberto, consulte a situação no banco e baixe o PDF
            para entregar ao cliente.
          </p>
        </div>
        <Button onClick={() => setForm("new")}>
          <Plus className="mr-2 h-4 w-4" />
          Novo boleto
        </Button>
        <p className="w-full text-xs text-muted-foreground">
          Sem envio automático ao cliente, juros, multa, protesto ou negativação. A confirmação de
          recebimento e a conciliação continuam no financeiro.
        </p>
      </Card>
      {query.isPending ? (
        <p role="status">Carregando boletos…</p>
      ) : query.isError ? (
        <Card role="alert" className="p-4">
          Não foi possível carregar os boletos.{" "}
          <Button variant="outline" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {!rows.length ? (
            <div className="space-y-3 p-6">
              <p>Nenhum boleto emitido pelo sistema.</p>
              <p className="text-sm text-muted-foreground">
                Primeiro cadastre o honorário com cliente, valor e vencimento em Lançamentos. Depois
                selecione Novo boleto.
              </p>
              <Button variant="outline" onClick={onNewEntry}>
                Cadastrar honorário
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    {["Cliente / honorário", "Vencimento", "Valor", "Situação", "Ações"].map(
                      (x) => (
                        <th className="p-3" key={x}>
                          {x}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id} className="border-t">
                      <td className="max-w-xs p-3">
                        <p className="font-medium break-words">{b.client_name}</p>
                        <p className="text-xs text-muted-foreground break-words">{b.description}</p>
                      </td>
                      <td className="whitespace-nowrap p-3">{displayDate(b.due_date)}</td>
                      <td className="whitespace-nowrap p-3 tabular-nums">
                        {currency(b.amount_cents)}
                      </td>
                      <td className="p-3">
                        {b.state === "issued" ? b.bank_data.situacaoBoleto : states[b.state]}
                      </td>
                      <td className="p-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelected(b);
                            setRecovery("");
                          }}
                        >
                          Detalhes
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(pages.length > 0 || (query.data?.length ?? 0) > 50) && (
            <div className="flex justify-between border-t p-3">
              <Button
                variant="outline"
                disabled={!pages.length}
                onClick={() => setPages((p) => p.slice(0, -1))}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                disabled={(query.data?.length ?? 0) <= 50}
                onClick={() => {
                  const b = rows.at(-1)!;
                  setPages((p) => [...p, { date: b.created_at, id: b.id }]);
                }}
              >
                Próxima
              </Button>
            </div>
          )}
        </Card>
      )}
      {form && (
        <BoletoForm
          existing={form === "new" ? undefined : form}
          entries={entries}
          clients={clients}
          close={() => setForm(null)}
          refresh={refresh}
        />
      )}
      {selected && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v && !action.isPending) setSelected(null);
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Boleto · {selected.client_name}</DialogTitle>
              <DialogDescription>{selected.description}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <p>
                Valor
                <br />
                <strong>{currency(selected.amount_cents)}</strong>
              </p>
              <p>
                Vencimento
                <br />
                <strong>{displayDate(selected.due_date)}</strong>
              </p>
              <p className="col-span-2">
                Situação:{" "}
                <strong>{selected.bank_data.situacaoBoleto || states[selected.state]}</strong>
              </p>
              <p className="col-span-2">
                Referência: {selected.reference}
                {selected.bank_data.nossoNumero && (
                  <> · Nosso número: {selected.bank_data.nossoNumero}</>
                )}
              </p>
            </div>
            {selected.last_error && (
              <p
                role="alert"
                className="rounded-lg border border-amber-400/50 bg-amber-50 p-3 text-sm text-amber-950"
              >
                {selected.last_error}
              </p>
            )}
            {selected.bank_data.linhaDigitavel && (
              <label className={fieldClass}>
                Linha digitável
                <Input
                  readOnly
                  value={selected.bank_data.linhaDigitavel}
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  variant="outline"
                  onClick={() =>
                    void navigator.clipboard.writeText(selected.bank_data.linhaDigitavel!).then(
                      () => toast.success("Linha copiada."),
                      () => toast.error("Selecione a linha e copie manualmente."),
                    )
                  }
                >
                  Copiar linha digitável
                </Button>
              </label>
            )}
            {["prepared", "rejected"].includes(selected.state) ? (
              <Button
                onClick={() => {
                  setForm(selected);
                  setSelected(null);
                }}
              >
                Revisar e emitir
              </Button>
            ) : (
              <>
                {!selected.bank_data.nossoNumero && (
                  <div className="space-y-2 rounded-lg border p-3 text-sm">
                    <p>
                      A emissão pode ter sido registrada. Confira a referência acima no Sicoob antes
                      de continuar.
                    </p>
                    <label className={fieldClass}>
                      Nosso número informado pelo banco
                      <Input
                        value={recovery}
                        inputMode="numeric"
                        maxLength={20}
                        onChange={(e) => setRecovery(e.target.value.replace(/\D/g, ""))}
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">
                      O sistema confere referência, valor e pagador antes de vincular. Nenhuma nova
                      cobrança será emitida por esta consulta.
                    </p>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={action.isPending || (!selected.bank_data.nossoNumero && !recovery)}
                    onClick={() => action.mutate({ b: selected, action: "query" })}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {selected.bank_data.nossoNumero
                      ? "Consultar situação"
                      : "Vincular pelo nosso número"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={action.isPending || !selected.bank_data.nossoNumero}
                    onClick={() => action.mutate({ b: selected, action: "pdf" })}
                  >
                    <FileDown className="mr-2 h-4 w-4" />
                    Baixar PDF
                  </Button>
                </div>
              </>
            )}
            <p className="text-xs text-muted-foreground">
              A situação exibida é a última consulta ao banco. Emitir ou consultar o boleto não
              marca o honorário como recebido.
            </p>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
function BoletoForm({
  existing,
  entries,
  clients,
  close,
  refresh,
}: {
  existing?: OfficeBoleto;
  entries: FinanceEntry[];
  clients: { id: string; name: string }[];
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [entryId, setEntryId] = useState(existing?.entry_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const available = entries.filter(
    (e) =>
      e.kind === "income" &&
      e.client_id &&
      !e.cancelled_at &&
      e.amount_cents > e.settled_cents &&
      e.due_date >= isoToday(),
  );
  const entry = available.find((e) => e.id === entryId);
  const name = clients.find((c) => c.id === entry?.client_id)?.name ?? "";
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Emitir boleto Sicoob</DialogTitle>
          <DialogDescription>
            Confira o honorário e os dados do pagador. Ao confirmar, a cobrança será registrada no
            banco.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !entry) return;
            setBusy(true);
            setError("");
            try {
              const f = new FormData(e.currentTarget);
              const value = (key: string) => String(f.get(key) ?? "").trim();
              const payer = boletoPayer(
                Object.fromEntries(
                  ["numeroCpfCnpj", "nome", "endereco", "bairro", "cidade", "cep", "uf"].map(
                    (k) => [k, value(k)],
                  ),
                ),
              );
              const id = (await financeRpc("office_boleto_prepare", {
                p_entry: entry.id,
                p_payer: payer,
                p_species: value("species"),
              })) as unknown as string;
              const result = await boletoAction("issue", id);
              await refresh();
              if (result?.state === "issued")
                toast.success("Boleto registrado no Sicoob. Abra Detalhes para baixar o PDF.");
              else
                toast.info(
                  "Já existe uma solicitação para este honorário. Confira os detalhes do boleto.",
                );
              close();
            } catch (err) {
              setError(
                (err as Error).message ||
                  "Não foi possível emitir. Consulte a lista antes de tentar novamente.",
              );
              await refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className={fieldClass}>
            Honorário
            <select
              required
              className={selectClass}
              value={entryId}
              disabled={busy || !!existing}
              onChange={(e) => setEntryId(e.target.value)}
            >
              <option value="">Selecione um honorário em aberto</option>
              {available.map((e) => (
                <option key={e.id} value={e.id}>
                  {clients.find((c) => c.id === e.client_id)?.name} · {e.description} ·{" "}
                  {currency(e.amount_cents - e.settled_cents)} · {displayDate(e.due_date)}
                </option>
              ))}
            </select>
          </label>
          {!available.length && (
            <p className="text-sm">
              Cadastre um honorário com cliente e vencimento hoje ou futuro na aba Lançamentos.
            </p>
          )}
          {entry && (
            <>
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                Cobrar <strong>{currency(entry.amount_cents - entry.settled_cents)}</strong> ·
                vencimento <strong>{displayDate(entry.due_date)}</strong>. O valor corresponde ao
                saldo em aberto desta parcela.
              </div>
              <div key={entry.id} className="grid gap-3 sm:grid-cols-2">
                {[
                  ["nome", "Nome do pagador", 50],
                  ["numeroCpfCnpj", "CPF / CNPJ", 18],
                  ["endereco", "Endereço e número", 40],
                  ["bairro", "Bairro", 30],
                  ["cidade", "Cidade", 40],
                  ["cep", "CEP", 9],
                  ["uf", "UF", 2],
                ].map(([key, label, max]) => (
                  <label key={key} className={fieldClass}>
                    {label}
                    <Input
                      name={String(key)}
                      required
                      maxLength={Number(max)}
                      disabled={busy}
                      defaultValue={
                        existing?.payer[key as keyof typeof existing.payer] ??
                        (key === "nome" ? name : "")
                      }
                    />
                  </label>
                ))}
                <label className={fieldClass}>
                  Espécie do documento
                  <select
                    name="species"
                    className={selectClass}
                    defaultValue={existing?.species ?? "RC"}
                    disabled={busy}
                  >
                    <option value="RC">Recibo</option>
                    <option value="DS">Duplicata de serviço</option>
                    <option value="FAT">Fatura</option>
                    <option value="OU">Outros</option>
                  </select>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                Sem juros, multa, desconto, protesto ou negativação. O PDF será disponibilizado para
                você entregar ao cliente; o banco não fará a distribuição pelo sistema.
              </p>
            </>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              Fechar
            </Button>
            <Button type="submit" disabled={busy || !entry}>
              {busy ? "Aguardando Sicoob…" : "Confirmar e emitir no Sicoob"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
