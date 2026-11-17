import { useEffect, useRef, useState } from "react";
import { Download, Eye, FileText, Paperclip, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { currency, displayDate, table, type DocumentInfo } from "@/lib/office-finance-data";
import type { FinanceEntry } from "@/lib/office-finance";

const limit = 2 * 1024 * 1024;
type PendingFile = { id: string; file: File; error?: string };
function previewType(name: string) {
  const ext = name.toLowerCase().split(".").pop();
  return (
    {
      pdf: "application/pdf",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
    } as Record<string, string>
  )[ext ?? ""];
}
async function content(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}
export function FinanceAttachments({
  entry,
  documents,
  close,
  refresh,
}: {
  entry: FinanceEntry;
  documents: DocumentInfo[];
  close: () => void;
  refresh: () => Promise<unknown>;
}) {
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string; type: string } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const inFlight = useRef(false);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  function select(files: FileList | File[]) {
    if (inFlight.current) return;
    const accepted: PendingFile[] = [];
    for (const file of Array.from(files)) {
      if (!file.size || file.size > limit) {
        toast.error(`${file.name}: escolha um arquivo de até 2 MB.`);
        continue;
      }
      accepted.push({ id: crypto.randomUUID(), file });
    }
    setPending((old) => [
      ...old,
      ...accepted.filter(
        (a) =>
          !old.some(
            (b) =>
              b.file.name === a.file.name &&
              b.file.size === a.file.size &&
              b.file.lastModified === a.file.lastModified,
          ),
      ),
    ]);
  }
  async function upload() {
    if (inFlight.current || !pending.length) return;
    inFlight.current = true;
    setBusy(true);
    let saved = 0;
    try {
      for (const item of pending) {
        try {
          const encoded = await content(item.file);
          const { error } = await table("office_finance_documents").insert({
            id: item.id,
            entry_id: entry.id,
            filename: item.file.name.slice(0, 255),
            content_base64: encoded,
          } as never);
          if (error) {
            // A lost response can be retried without duplicating this queued file.
            if (error.code !== "23505") throw error;
            const check = await table("office_finance_documents")
              .select("id")
              .eq("id", item.id)
              .eq("entry_id", entry.id)
              .single();
            if (check.error) throw error;
          }
          saved++;
          setPending((old) => old.filter((x) => x.id !== item.id));
        } catch (error) {
          setPending((old) =>
            old.map((x) =>
              x.id === item.id
                ? {
                    ...x,
                    error:
                      error instanceof Error ? error.message : "Falha no envio. Tente novamente.",
                  }
                : x,
            ),
          );
        }
      }
      if (saved) {
        await refresh();
        toast.success(`${saved} arquivo(s) anexado(s).`);
      }
    } catch {
      toast.error("Os arquivos foram enviados, mas a lista não atualizou. Feche e reabra Anexos.");
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  async function open(doc: DocumentInfo, download = false) {
    setLoading(doc.id);
    try {
      const { data, error } = await table("office_finance_documents")
        .select("content_base64")
        .eq("id", doc.id)
        .single();
      if (error) throw error;
      const bytes = Uint8Array.from(
        atob((data as unknown as { content_base64: string }).content_base64),
        (c) => c.charCodeAt(0),
      );
      const type = previewType(doc.filename);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: type || "application/octet-stream" }),
      );
      if (download || !type) {
        const a = document.createElement("a");
        a.href = url;
        a.download = doc.filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else setPreview({ url, name: doc.filename, type });
    } catch {
      toast.error("Não foi possível abrir o arquivo. Tente novamente.");
    } finally {
      setLoading(null);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Paperclip className="h-5 w-5" />
            Anexos do lançamento
          </DialogTitle>
          <DialogDescription className="break-words pr-5">
            {entry.description} · {currency(entry.amount_cents)} · Vencimento{" "}
            {displayDate(entry.due_date)}
          </DialogDescription>
        </DialogHeader>
        <div
          role="region"
          aria-label="Área para arrastar arquivos"
          aria-busy={busy}
          onDragEnter={(e) => {
            e.preventDefault();
            depth.current++;
            if (!busy) setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = busy ? "none" : "copy";
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            depth.current--;
            if (depth.current <= 0) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            depth.current = 0;
            setDragging(false);
            if (!busy) select(e.dataTransfer.files);
          }}
          className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-primary bg-primary/10" : "border-border bg-muted/20"}`}
        >
          <UploadCloud className="mx-auto mb-2 h-8 w-8 text-primary" />
          <p className="font-medium">
            {dragging ? "Solte os arquivos aqui" : "Arraste seus comprovantes e documentos para cá"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Até 2 MB por arquivo. Confira a lista antes de anexar.
          </p>
          <input
            ref={input}
            type="file"
            multiple
            className="sr-only"
            aria-label="Selecionar arquivos"
            disabled={busy}
            onChange={(e) => {
              if (e.target.files) select(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            className="mt-3"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            Selecionar arquivos
          </Button>
        </div>
        {!!pending.length && (
          <section className="space-y-3" aria-label="Arquivos selecionados">
            <h3 className="text-sm font-medium">Prontos para anexar ({pending.length})</h3>
            <ul className="max-h-44 space-y-2 overflow-y-auto">
              {pending.map((item) => (
                <li key={item.id} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                  <FileText className="h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="break-all">{item.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {Math.ceil(item.file.size / 1024)} KB
                    </p>
                    {item.error && (
                      <p role="alert" className="text-xs text-destructive">
                        {item.error}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={`Remover ${item.file.name} da seleção`}
                    onClick={() => setPending((old) => old.filter((x) => x.id !== item.id))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <Button disabled={busy} onClick={() => void upload()}>
              {busy ? "Anexando…" : `Anexar ${pending.length} arquivo(s)`}
            </Button>
          </section>
        )}
        <section className="space-y-2">
          <h3 className="font-medium">Arquivos anexados ({documents.length})</h3>
          {!documents.length && (
            <p className="rounded-lg border p-4 text-sm text-muted-foreground">
              Este lançamento ainda não tem anexos.
            </p>
          )}
          <ul className="max-h-60 space-y-2 overflow-y-auto">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 break-all text-sm">{doc.filename}</span>
                <div className="flex gap-1">
                  {previewType(doc.filename) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!loading}
                      onClick={() => void open(doc)}
                    >
                      <Eye className="mr-1 h-4 w-4" />
                      Visualizar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!!loading}
                    onClick={() => void open(doc, true)}
                  >
                    <Download className="mr-1 h-4 w-4" />
                    Baixar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {loading && (
            <p role="status" className="text-sm text-muted-foreground">
              Abrindo arquivo…
            </p>
          )}
        </section>
        {preview && (
          <section className="space-y-2 rounded-lg border p-3" aria-label="Visualização do anexo">
            <div className="flex items-center justify-between gap-2">
              <p className="break-all text-sm font-medium">{preview.name}</p>
              <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
                Fechar prévia
              </Button>
            </div>
            {preview.type === "application/pdf" ? (
              <iframe
                title={preview.name}
                src={preview.url}
                className="h-[50dvh] w-full rounded border"
              />
            ) : (
              <img
                src={preview.url}
                alt={preview.name}
                className="mx-auto max-h-[50dvh] max-w-full object-contain"
              />
            )}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
