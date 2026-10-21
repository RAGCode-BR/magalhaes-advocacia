import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";

import "./styles.css";

// No desenvolvimento, o Vite atualiza a interface. Um worker de um preview anterior
// não deve manter a versão publicada nem reiniciar uma sessão de edição local.
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      if (new URL(registration.scope).pathname === import.meta.env.BASE_URL)
        void registration.unregister();
    }
  });
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

// GitHub Pages hosts this repository under /task-flow.
// The router basepath must match vite.pages.config.ts.
const router = getRouter(import.meta.env.BASE_URL.replace(/\/$/, ""));

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
