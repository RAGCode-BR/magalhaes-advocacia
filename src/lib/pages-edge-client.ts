import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";

export function remoteFunction(action: string) {
  return async ({ data }: { data: unknown }) => {
    if (!isSupabaseConfigured)
      throw new Error("Conecte o Supabase exclusivo da Magalhães para utilizar este recurso.");
    const { data: result, error } = await supabase.functions.invoke("taskflow-ai", {
      body: { action, data },
    });
    if (error)
      throw new Error(
        "Não foi possível executar o recurso. Confira a sessão e a instalação da função taskflow-ai no Supabase.",
      );
    if (result?.error) throw new Error(result.error);
    return result;
  };
}
