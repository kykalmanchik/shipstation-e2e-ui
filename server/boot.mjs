// One ShipStation client and one /api handler for this process — shared by `vite` (dev) and `serve.mjs` (built).
// The account and the access code come from shipstation-e2e-ui/.env (see .env.example); the shell's variables win over the file.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAccess, loadDeploy } from "./access.mjs";
import { createHandler } from "./handler.mjs";
import { createShipStation, loadConfig, readEnvFile } from "./shipstation.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_FILE = join(ROOT, ".env");
export const PORT = Number(process.env.PORT || readEnvFile(ENV_FILE).PORT || 5190);

/** The handler and where to listen. Throws (and the process refuses to start) when the chosen account has no usable key,
 * or when the server would be reachable from beyond this machine without an access code. */
export function bootApi({ port = PORT } = {}) {
  const config = loadConfig({ envFile: ENV_FILE });
  const deploy = loadDeploy({ file: readEnvFile(ENV_FILE) });
  const { apiKey, ...account } = config;
  const mode = account.environment === "production" ? `PRODUCTION (${account.writes ? "writes ON" : "read-only"})` : "sandbox";
  const door = deploy.accessCode ? "behind the access code" : "open (no ACCESS_CODE)";
  console.log(`shipstation-e2e-ui: ShipStation ${mode}, key from ${account.keySource}, ${account.limit} calls a minute, ${door}`);
  const access = deploy.accessCode ? createAccess({ code: deploy.accessCode, secure: deploy.publicOrigin?.startsWith("https:") ?? false }) : null;
  const handle = createHandler({ ss: createShipStation({ apiKey, limit: account.limit }), port, account, access, publicOrigin: deploy.publicOrigin });
  return { handle, deploy };
}

process.on("unhandledRejection", (reason) => console.error("shipstation-e2e-ui: unhandled rejection", reason));
