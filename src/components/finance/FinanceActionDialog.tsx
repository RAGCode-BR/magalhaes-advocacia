import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type FinanceAction = {
  title: string;
  explanation: string;
  needsReason?: boolean;
  run: (reason: string) => Promise<unknown>;
};

export function FinanceActionDialog({
  action,
  close,
  refresh,
}: {
  action: FinanceAction;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => action.run(reason.trim()),
    onSuccess: async () => {
      await refresh();
      close();
      toast.success("Operação registrada.");
    },
    onError: (error: Error) =>
      toast.error(error.message || "Não foi possível concluir a operação."),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action.title}</DialogTitle>
          <DialogDescription>{action.explanation}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!mutation.isPending) mutation.mutate();
          }}
        >
          {action.needsReason && (
            <label className="grid gap-2 text-sm">
              Motivo
              <Textarea
                required
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={close}>
              Voltar
            </Button>
            <Button disabled={mutation.isPending || (action.needsReason && !reason.trim())}>
              {mutation.isPending ? "Registrando…" : "Confirmar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
