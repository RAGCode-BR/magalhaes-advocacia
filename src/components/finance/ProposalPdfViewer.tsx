import { useEffect, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { proposalFileName, type ProposalDocument } from "@/lib/finance-proposal";

/** Shows the proposal PDF inside the app, with download and new-tab options. */
export function ProposalPdfViewer({ doc, close }: { doc: ProposalDocument; close: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let created: string | null = null;
    let cancelled = false;
    import("@/lib/finance-proposal-pdf")
      .then(({ proposalPdfBlob }) => proposalPdfBlob(doc))
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message || "Não foi possível gerar o PDF.");
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [doc]);
  const fileName = proposalFileName(doc);
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex h-[92dvh] max-w-5xl flex-col gap-3 p-4 sm:p-5">
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate">Proposta nº {doc.number}</DialogTitle>
          <DialogDescription className="truncate">{doc.title}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted/40">
          {error ? (
            <p role="alert" className="p-6 text-sm text-destructive">
              {error}
            </p>
          ) : url ? (
            <iframe title={`PDF da proposta ${doc.number}`} src={url} className="h-full w-full" />
          ) : (
            <p role="status" className="p-6 text-sm text-muted-foreground">
              Gerando o PDF…
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {url ? (
            <>
              <Button variant="outline" size="sm" asChild>
                <a href={url} target="_blank" rel="noopener">
                  <ExternalLink /> Abrir em nova aba
                </a>
              </Button>
              <Button size="sm" asChild>
                <a href={url} download={fileName}>
                  <Download /> Baixar PDF
                </a>
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" disabled>
                <ExternalLink /> Abrir em nova aba
              </Button>
              <Button size="sm" disabled>
                <Download /> Baixar PDF
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
