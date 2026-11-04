#!/usr/bin/env node
// The built app (`npm run build` → dist/) and its /api on one port, no Vite: `npm start` → http://127.0.0.1:5190.
// `HOST=0.0.0.0` (the Docker image's) listens beyond the loopback, which needs ACCESS_CODE; `/healthz` is for the balancer.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { PORT, ROOT, bootApi } from "./boot.mjs";

const DIST = join(ROOT, "dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".ico": "image/x-icon" };
const CSP = "default-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

let api;
let deploy;
try { ({ handle: api, deploy } = bootApi()); } catch (error) { console.error(`shipstation-e2e-ui: ${error.message}`); process.exit(1); }

async function file(res, path, status = 200) {
  const body = await readFile(path);
  res.writeHead(status, { "content-type": TYPES[extname(path)] ?? "application/octet-stream", "x-content-type-options": "nosniff",
    "cache-control": path.includes(`${join("dist", "assets")}`) ? "public, max-age=31536000, immutable" : "no-store", "content-security-policy": CSP });
  res.end(body);
}

const server = createServer(async (req, res) => {
  // A balancer's check names no host of ours and carries no session: it learns only that the process answers.
  if (req.url === "/healthz") { res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" }); return res.end("ok"); }
  try {
    await api(req, res, async () => {
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
      const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://local").pathname);
      const target = normalize(join(DIST, pathname));
      if (!target.startsWith(DIST)) { res.writeHead(400); return res.end(); }
      try { await file(res, target.endsWith("/") ? join(target, "index.html") : target); }
      catch { await file(res, join(DIST, "index.html")); } // the app's own routes: every view lives in the query string
    });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) { res.writeHead(500); res.end(); }
  }
});
server.on("error", (error) => {
  console.error(`shipstation-e2e-ui: ${error.code === "EADDRINUSE" ? `port ${PORT} is taken (PORT=… for another)` : error.message}`);
  process.exit(1);
});
server.listen(PORT, deploy.host, () => console.log(`shipstation-e2e-ui: built app on http://${deploy.host}:${PORT}${deploy.publicOrigin ? `, opened at ${deploy.publicOrigin}` : ""}`));
// A container is stopped with SIGTERM: finish the answers under way, then go (a ShipStation write is never cut mid-call).
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 25_000).unref(); });
