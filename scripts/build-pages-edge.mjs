import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
await build({
  entryPoints: ["scripts/pages-edge/entry.ts"],
  outfile: "supabase/functions/taskflow-ai/handlers.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  define: { "process.env.LOVABLE_API_KEY": "undefined" },
  plugins: [
    {
      name: "edge-adapters",
      setup(build) {
        build.onResolve(
          { filter: /^(@tanstack\/react-start|@\/integrations\/supabase\/auth-middleware)$/ },
          () => ({ path: path.join(root, "scripts/pages-edge/builder.ts") }),
        );
        build.onResolve({ filter: /^@\/lib\/gemini.server$/ }, () => ({
          path: path.join(root, "scripts/pages-edge/gemini.ts"),
        }));
        build.onLoad({ filter: /import-ata.functions.ts$/ }, async (args) => ({
          loader: "ts",
          contents: (await readFile(args.path, "utf8")).replace(
            'const { supabaseAdmin } = await import("@/integrations/supabase/client.server");',
            "const supabaseAdmin = context.supabase;",
          ),
        }));
      },
    },
  ],
});
console.log(
  "Funções de IA preparadas para o Supabase exclusivo, com as regras de acesso do usuário.",
);
