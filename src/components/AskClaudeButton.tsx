import { useEffect, useState, type KeyboardEvent } from "react";
import { useRouterState } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ExternalLink, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useClients } from "@/hooks/use-data";
import {
  CLAUDE_REQUEST_LIMIT,
  askClaudeUrl,
  buildClaudeRequest,
  screenContext,
} from "@/lib/claude-connector";

/**
 * "Pedir ao Claude" on every screen (button or Ctrl/⌘ + J): the person types anything and it
 * opens in their own Claude, with the current screen as context. The connector does the work.
 */
export function AskClaudeButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [withContext, setWithContext] = useState(true);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data: clients = [] } = useClients();
  const context = screenContext(pathname, clients as { id: string; name: string }[]);
  // The floating button can be tucked into the right edge; Ctrl/⌘ + J still works.
  const [docked, setDocked] = useState(() => {
    try {
      return localStorage.getItem("ask-claude-docked") === "true";
    } catch {
      return false;
    }
  });
  const [peeking, setPeeking] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem("ask-claude-docked", String(docked));
    } catch {
      // Still docks for this visit when storage is unavailable.
    }
  }, [docked]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const send = () => {
    const request = buildClaudeRequest(text, withContext ? context : null);
    if (!request) return;
    window.open(askClaudeUrl(request), "_blank", "noopener");
    setText("");
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <>
      <motion.div
        className="group fixed bottom-4 right-4 z-40 print:hidden"
        initial={false}
        animate={{ x: docked ? (peeking ? 26 : 38) : 0 }}
        transition={{ type: "spring", bounce: 0.2, duration: 0.45 }}
        onHoverStart={() => setPeeking(true)}
        onHoverEnd={() => setPeeking(false)}
      >
        <button
          type="button"
          onClick={() => (docked ? setDocked(false) : setOpen(true))}
          aria-label={docked ? "Mostrar o botão Pedir ao Claude" : "Pedir ao Claude"}
          title={docked ? "Mostrar o botão Pedir ao Claude" : "Pedir ao Claude (Ctrl/⌘ + J)"}
          className="glass-wine flex h-10 items-center rounded-full px-[11px] text-sm font-medium outline-none ring-sidebar-ring transition-[box-shadow,transform] duration-200 hover:shadow-[0_0_0_1px_rgba(221,188,112,0.6),0_10px_24px_-10px_rgba(59,16,20,0.8)] focus-visible:ring-2 active:scale-95"
        >
          <Sparkles className="h-[18px] w-[18px] shrink-0 text-sidebar-primary" />
          <span
            className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity,padding] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${
              docked
                ? "max-w-0 opacity-0"
                : "max-w-0 opacity-0 group-focus-within:max-w-40 group-focus-within:pl-2 group-focus-within:pr-1 group-focus-within:opacity-100 group-hover:max-w-40 group-hover:pl-2 group-hover:pr-1 group-hover:opacity-100"
            }`}
          >
            Pedir ao Claude
          </span>
        </button>
        {!docked && (
          <button
            type="button"
            onClick={() => setDocked(true)}
            aria-label="Ocultar o botão Pedir ao Claude"
            title="Ocultar (Ctrl/⌘ + J continua funcionando)"
            className="absolute -left-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity duration-200 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </motion.div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Pedir ao Claude
            </DialogTitle>
            <DialogDescription>
              Escreva o que o Claude deve fazer no TaskFlow. O pedido abre no seu Claude, numa nova
              aba, e qualquer alteração pede a sua aprovação lá.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={4}
            maxLength={CLAUDE_REQUEST_LIMIT}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ex.: crie um card para revisar o contrato deste cliente amanhã e me diga o que está atrasado."
          />
          {context && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={withContext}
                onCheckedChange={(checked) => setWithContext(checked === true)}
              />
              Incluir o contexto: {context}
            </label>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <p className="mr-auto self-center text-xs text-muted-foreground">
              Enter envia · Shift + Enter quebra a linha
            </p>
            <Button onClick={send} disabled={!text.trim()}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Abrir no Claude
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
