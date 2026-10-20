import { VitePWA } from "vite-plugin-pwa";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vite";
import { appUpdatesPlugin } from "./scripts/app-updates-plugin";

// A página estática chama as mesmas operações por Edge Function; nenhum segredo é empacotado.
const edgeFunctions = {
  "ai-format.functions.ts": ["formatNoteWithAI"],
  "client-report.functions.ts": ["generateClientReport"],
  "format-ata.functions.ts": ["formatAtaWithGemini"],
  "import-ata.functions.ts": ["parseAtaWithGemini", "createTasksFromAta"],
};
const pagesEdgePlugin = {
  name: "magalhaes-pages-edge",
  enforce: "pre" as const,
  transform(_code: string, id: string) {
    const names = edgeFunctions[id.split("/").pop() as keyof typeof edgeFunctions];
    if (!names) return null;
    return `import { remoteFunction } from "/src/lib/pages-edge-client.ts";\n${names.map((name) => `export const ${name} = remoteFunction("${name}");`).join("\n")}`;
  },
};

export default defineConfig({
  // GitHub Pages serves project sites under /<repo-name>/.
  // Keep this in sync with the repository name, otherwise asset URLs break and the page opens blank.
  base: "/magalhaes-advocacia/",
  define: {
    // The app uses this flag to avoid TanStack Start server behavior in the static GitHub Pages build.
    "import.meta.env.VITE_GITHUB_PAGES": JSON.stringify("true"),
  },
  resolve: {
    alias: {
      "@tanstack/react-start/server": "/src/pages-react-start-stub.ts",
      "@tanstack/react-start": "/src/pages-react-start-stub.ts",
    },
  },
  plugins: [
    pagesEdgePlugin,
    appUpdatesPlugin(),
    react(),
    tailwindcss(),
    tsconfigPaths(),
    VitePWA({
      registerType: "prompt",
      injectRegister: "auto",
      outDir: ".gh-pages-dist",
      includeAssets: ["magalhaes-logo.png"],
      manifest: {
        name: "Magalhães Advocacia",
        short_name: "Magalhães",
        description: "Gestão do escritório",
        theme_color: "#501618",
        background_color: "#fbf8f5",
        display: "standalone",
        start_url: "/magalhaes-advocacia/",
        scope: "/magalhaes-advocacia/",
        icons: [
          { src: "magalhaes-logo.png", sizes: "1080x1080", type: "image/png", purpose: "any" },
        ],
      },
      workbox: {
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "/magalhaes-advocacia/index.html",
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        globIgnores: ["**/app-release.json"],
        additionalManifestEntries: [{ url: "index.html", revision: String(Date.now()) }],
      },
    }),
  ],
  build: {
    // Static files are generated here first, then scripts/prepare-gh-pages.mjs renames the entry file.
    outDir: ".gh-pages-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: "index.pages.html",
    },
  },
});
