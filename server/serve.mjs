#!/usr/bin/env node
// The built app (`npm run build` → dist/) and its /api on one port, no Vite: `npm start` → http://127.0.0.1:5190.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { PORT, ROOT, bootApi } from "./boot.mjs";

const DIST = join(ROOT, "dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".ico": "image/x-icon" };
const CSP = "default-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

let api;
try { api = bootApi(); } catch (error) { console.error(`shipstation-e2e-ui: ${error.message}`); process.exit(1); }

async function file(res, path, status = 200) {
  const body = await readFile(path);
  res.writeHead(status, { "content-type": TYPES[extname(path)] ?? "application/octet-stream", "x-content-type-options": "nosniff",
    "cache-control": path.includes(`${join("dist", "assets")}`) ? "public, max-age=31536000, immutable" : "no-store", "content-security-policy": CSP });
  res.end(body);
}

const server = createServer(async (req, res) => {
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
server.listen(PORT, "127.0.0.1", () => console.log(`shipstation-e2e-ui: built app on http://127.0.0.1:${PORT} (TEST_ key)`));
