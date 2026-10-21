import { spawn, spawnSync } from "node:child_process";
const setup = spawnSync(process.execPath, ["scripts/start-local.mjs"], { stdio: "inherit" });
if (setup.status !== 0) process.exit(setup.status || 1);
const bundle = spawnSync(process.execPath, ["scripts/build-pages-edge.mjs"], { stdio: "inherit" });
if (bundle.status !== 0) process.exit(bundle.status || 1);
const edge = spawn(
  "./node_modules/.bin/supabase",
  ["functions", "serve", "--env-file", ".env.functions.local"],
  { stdio: "inherit" },
);
const vite = spawn(
  "./node_modules/.bin/vite",
  ["--config", "vite.pages.config.ts", "--port", "5180", "--strictPort"],
  { stdio: "inherit" },
);
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  edge.kill("SIGTERM");
  vite.kill("SIGTERM");
  console.log("Aplicativo encerrado. O banco e os cadastros locais foram preservados.");
  process.exit(code);
};
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
vite.on("exit", (code) => stop(code || 0));
edge.on("exit", (code) => {
  if (code) console.error("As funções de integração encerraram. Confira o log acima.");
});
