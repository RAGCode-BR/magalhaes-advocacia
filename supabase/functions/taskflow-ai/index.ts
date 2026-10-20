import { createClient } from "npm:@supabase/supabase-js@2";
import * as handlers from "./handlers.js";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const actions = new Set(["formatNoteWithAI", "generateClientReport", "formatAtaWithGemini", "parseAtaWithGemini", "createTasksFromAta"]);
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "Método inválido." }, 405);
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return reply({ error: "Sessão necessária." }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await supabase.auth.getUser(authorization.slice(7));
  if (error || !user) return reply({ error: "Sessão inválida." }, 401);
  try {
    const { action, data } = await request.json();
    if (!actions.has(action)) return reply({ error: "Ação inválida." }, 400);
    // The caller's JWT is used for every database operation, including task creation.
    // Service-role credentials never enter these handlers.
    return reply(await handlers[action as keyof typeof handlers]({ data, context: { supabase, userId: user.id } }));
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "Falha na solicitação." }, 400);
  }
});
