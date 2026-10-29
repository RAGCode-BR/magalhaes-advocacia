import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquarePlus,
  ShieldCheck,
  Sparkles,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useClients } from "@/hooks/use-data";
import {
  CLAUDE_CONNECTOR_URL,
  askClaudeUrl,
  disconnectClaude,
  listClaudeConnections,
  neonAuthIssuer,
} from "@/lib/claude-connector";

export const Route = createFileRoute("/_app/claude")({ component: ClaudePage });

const QUICK_PROMPTS = [
  "Use o TaskFlow e resuma as minhas tarefas desta semana, destacando prazos e atrasos.",
  "Use o TaskFlow e liste os cards atrasados, agrupados por cliente.",
  "Use o TaskFlow e me diga quais clientes estão sem movimentação há mais de 30 dias.",
];

function ClaudePage() {
  const available = Boolean(neonAuthIssuer());
  return (
    <div className="mx-auto min-w-0 max-w-4xl space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Sparkles className="h-6 w-6 text-primary" />
          Claude
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conecte o seu Claude ao TaskFlow para pedir resumos, acompanhar clientes e organizar cards
          conversando. Funciona com a sua própria assinatura do Claude, no navegador, no celular ou
          no computador.
        </p>
      </header>
      {available ? (
        <>
          <ConnectionStatus />
          <SetupSteps />
          <AskClaude />
          <Safety />
        </>
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          A conexão com o Claude está disponível apenas no banco online do escritório.
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ConnectionStatus() {
  const queryClient = useQueryClient();
  const connections = useQuery({
    queryKey: ["claude-connections"],
    queryFn: listClaudeConnections,
  });
  const disconnect = useMutation({
    mutationFn: disconnectClaude,
    onSuccess: () => {
      toast.success("Claude desconectado do seu TaskFlow.");
      queryClient.invalidateQueries({ queryKey: ["claude-connections"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const list = connections.data ?? [];

  return (
    <Section title="Sua conexão">
      {connections.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Verificando…
        </p>
      ) : connections.isError ? (
        <p className="text-sm text-muted-foreground">
          Não foi possível verificar agora. Atualize a página para tentar de novo.
        </p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          O seu Claude ainda não está conectado. Siga os passos abaixo.
        </p>
      ) : (
        <ul className="space-y-2">
          {list.map((connection) => (
            <li
              key={connection.id}
              className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  Conectado
                </p>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {connection.createdAt &&
                    `Desde ${new Date(connection.createdAt).toLocaleDateString("pt-BR")} · `}
                  {connection.clientId}
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={disconnect.isPending}>
                    <Unplug className="mr-2 h-4 w-4" />
                    Desconectar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar o Claude?</AlertDialogTitle>
                    <AlertDialogDescription>
                      O Claude deixa de acessar o seu TaskFlow. Para usar de novo, será preciso
                      entrar e permitir outra vez.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => disconnect.mutate(connection.id)}>
                      Desconectar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function SetupSteps() {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CLAUDE_CONNECTOR_URL);
      toast.success("Endereço copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o endereço e copie manualmente.");
    }
  };

  return (
    <Section title="Como conectar">
      {!CLAUDE_CONNECTOR_URL ? (
        <p className="text-sm text-muted-foreground">
          O endereço do conector ainda não foi configurado neste ambiente.
        </p>
      ) : (
        <ol className="space-y-4 text-sm">
          <li>
            <p className="font-medium">1. Copie o endereço do conector</p>
            <div className="mt-2 flex gap-2">
              <Input readOnly value={CLAUDE_CONNECTOR_URL} onFocus={(e) => e.target.select()} />
              <Button variant="outline" onClick={copy} aria-label="Copiar endereço">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </li>
          <li>
            <p className="font-medium">2. Abra os conectores do Claude</p>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Abrir configurações do Claude
              </a>
            </Button>
          </li>
          <li>
            <p className="font-medium">3. Adicione um conector personalizado</p>
            <p className="mt-1 text-muted-foreground">
              Clique em <strong>Adicionar conector personalizado</strong>, dê o nome{" "}
              <strong>TaskFlow</strong> e cole o endereço.
            </p>
          </li>
          <li>
            <p className="font-medium">4. Entre e permita</p>
            <p className="mt-1 text-muted-foreground">
              Clique em <strong>Conectar</strong>. Abre a tela do TaskFlow: entre com a sua conta e
              clique em <strong>Permitir</strong>. Pronto, a conexão aparece acima.
            </p>
          </li>
        </ol>
      )}
    </Section>
  );
}

function AskClaude() {
  const { data: clients = [] } = useClients();
  const [clientId, setClientId] = useState("");
  const client = clients.find((item: { id: string }) => item.id === clientId) as
    { name: string } | undefined;
  const open = (prompt: string) => window.open(askClaudeUrl(prompt), "_blank", "noopener");

  return (
    <Section title="Perguntar ao Claude">
      <p className="mb-3 text-sm text-muted-foreground">
        Abre uma conversa nova no seu Claude com o pedido já escrito. Você revisa e envia.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="sm:w-72">
            <SelectValue placeholder="Escolha um cliente" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((item: { id: string; name: string }) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          disabled={!client}
          onClick={() =>
            client &&
            open(
              `Use o TaskFlow e resuma o andamento do cliente "${client.name}": status dos cards, prazos, últimas conversas e documentos.`,
            )
          }
        >
          <MessageSquarePlus className="mr-2 h-4 w-4" />
          Resumo do cliente
        </Button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => open(prompt)}
            className="rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted"
          >
            {prompt.replace("Use o TaskFlow e ", "").replace(/^./, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>
    </Section>
  );
}

function Safety() {
  return (
    <p className="flex gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
      <ShieldCheck className="h-4 w-4 shrink-0" />O Claude vê apenas o que você vê no TaskFlow. Ele
      só cria ou altera algo quando você pede e aprova no Claude, sempre no seu nome, e não exclui
      nada.
    </p>
  );
}
