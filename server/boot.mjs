// One ShipStation client and one /api handler for this process — shared by `vite` (dev) and `serve.mjs` (built).
// The account comes from shipstation-e2e-ui/.env (see .env.example); the shell's variables win over the file.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "./handler.mjs";
import { createShipStation, loadConfig, readEnvFile } from "./shipstation.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_FILE = join(ROOT, ".env");
export const PORT = Number(process.env.PORT || readEnvFile(ENV_FILE).PORT || 5190);

/** Throws (and the process refuses to start) when the chosen account has no usable key. */
export function bootApi({ port = PORT } = {}) {
  const config = loadConfig({ envFile: ENV_FILE });
  const { apiKey, ...account } = config;
  const mode = account.environment === "production" ? `PRODUCTION (${account.writes ? "writes ON" : "read-only"})` : "sandbox";
  console.log(`shipstation-e2e-ui: ShipStation ${mode}, key from ${account.keySource}, ${account.limit} calls a minute`);
  return createHandler({ ss: createShipStation({ apiKey, limit: account.limit }), port, account });
}

process.on("unhandledRejection", (reason) => console.error("shipstation-e2e-ui: unhandled rejection", reason));
