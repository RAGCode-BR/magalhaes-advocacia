import { supabase } from "@/integrations/supabase/client";
import { financeRpc } from "./office-finance-data";
import type { BoletoPayer } from "./sicoob-boleto";
export type OfficeBoleto = {
  id: string;
  entry_id: string;
  reference: string;
  amount_cents: number;
  due_date: string;
  state: "prepared" | "issuing" | "issued" | "rejected" | "uncertain";
  last_error: string | null;
  bank_data: {
    nossoNumero?: string;
    linhaDigitavel?: string;
    situacaoBoleto?: string;
    queried_at?: string;
  };
  payer: BoletoPayer;
  species: string;
  description: string;
  client_name: string;
  created_at: string;
  updated_at: string;
};
export type BoletoCursor = { date: string; id: string };
export async function loadBoletos(cursor?: BoletoCursor): Promise<OfficeBoleto[]> {
  return (await financeRpc("office_boleto_list", {
    p_before: cursor?.date ?? null,
    p_before_id: cursor?.id ?? null,
  })) as unknown as OfficeBoleto[];
}
export async function boletoAction(
  action: "issue" | "query" | "pdf",
  id: string,
  nossoNumero?: string,
) {
  const { data, error } = await supabase.auth.getSession({ forceFetch: true } as never);
  if (error || !data.session?.access_token)
    throw new Error("Entre novamente para acessar os boletos.");
  const response = await fetch(`https://magalhaes-sicoob.ragcodebr.workers.dev/boletos/${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id, nossoNumero }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const result = await response.json();
    throw new Error(result.error || "Não foi possível acessar o boleto.");
  }
  if (action === "pdf") {
    const blob = await response.blob(),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `boleto-${id}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }
  return response.json();
}
