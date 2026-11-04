// shipstation-e2e-ui — the ShipStation sandbox desk: a stand-in for the ShipStation UI the sandbox does not have.
//   npm run dev     → Vite + the /api middleware on http://127.0.0.1:5190 (PORT=… for another)
//   npm run build && npm start   → the built app served by server/serve.mjs, no Vite
//   npm test        → server and page logic, no network      npm run sync-style → the os look again
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error — a plain .mjs module without types
import { PORT, bootApi } from "./server/boot.mjs";

/** The /api handler inside Vite's own server, so `npm run dev` is one process on one port. */
function e2eApi(): Plugin {
  return {
    name: "shipstation-e2e-ui-api",
    configureServer(server) {
      const { handle } = bootApi({ port: PORT }); // throws without a usable key: Vite refuses to start
      server.middlewares.use((req, res, next) => { void handle(req, res, next); });
    },
  };
}

export default defineConfig({
  plugins: [react(), e2eApi()],
  server: { host: "127.0.0.1", port: PORT, strictPort: true },
  preview: { host: "127.0.0.1", port: PORT, strictPort: true },
});
