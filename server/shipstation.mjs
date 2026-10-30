// The ShipStation API v2 client of this tool: one door to https://api.shipstation.com/v2, with the sandbox's
// rate limit kept on our side (shipengine.com/docs/sandbox: "a 20 requests per minute rate limit"), a read
// retried once when ShipStation asks it to wait or stumbles, and a write never retried — a write that got no
// answer is reported as an unknown outcome, to be read back, never sent twice.
import { readFileSync } from "node:fs";

export const API_BASE = "https://api.shipstation.com/v2";
export const SE_ID = /^se(-[a-z0-9]+)+$/;

/** A refusal of ours (a bad input), told apart from ShipStation's own answer. */
export class InputError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

/** ShipStation answered with an error status: its status, request id and messages — never the request's headers. */
export class VendorError extends Error {
  constructor(status, body, { retryAfterMs = null } = {}) {
    const errors = Array.isArray(body?.errors) ? body.errors : [];
    super(errors.map((e) => e?.message).filter(Boolean).join("; ") || (status === 429 ? "ShipStation asks to slow down (429)" : `ShipStation answered ${status}`));
    this.status = status;
    this.requestId = typeof body?.request_id === "string" ? body.request_id : null;
    this.retryAfterMs = retryAfterMs;
    this.errors = errors.map((e) => ({
      code: e?.error_code ?? null, source: e?.error_source ?? null, type: e?.error_type ?? null,
      message: e?.message ?? null, field: e?.field_name ?? null, value: e?.field_value ?? null,
    }));
  }
}

/** No answer reached us: for a read, ShipStation is unreachable; for a write, nobody knows whether it applied. */
export class UnreachableError extends Error {
  constructor(message, { write }) {
    super(write ? `${message} — the outcome is unknown: read the record again before repeating it` : message);
    this.status = write ? 504 : 502;
    this.outcome = write ? "unknown" : "not_sent_or_lost";
  }
}

/** `KEY=value` lines of an env file; a missing file is an empty one. */
export function readEnvFile(path) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return {}; }
  const values = {};
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
}

/**
 * The two accounts this tool can talk to. One host serves both; the key alone says which (docs.shipstation.com/sandbox:
 * "API key prefix: TEST_ / No prefix"). The default rate limits are the documented ones: 20 a minute in the sandbox
 * (shipengine.com/docs/sandbox), 200 a minute in production (docs.shipstation.com/rate-limits).
 */
export const ENVIRONMENTS = {
  sandbox: { keyVar: "SHIPSTATION_SANDBOX_API_KEY", limit: 20 },
  production: { keyVar: "SHIPSTATION_PRODUCTION_API_KEY", limit: 200 },
};

/**
 * The account to use, from (first wins) the shell and this tool's `.env`. `SHIPSTATION_ENV` picks it. A sandbox key must start with TEST_, a production key must not, and
 * production is read-only unless `SHIPSTATION_PRODUCTION_WRITES=true`.
 */
export function loadConfig({ env = process.env, envFile } = {}) {
  const file = envFile ? readEnvFile(envFile) : {};
  const from = (name) => (env[name] ? { value: env[name], source: "shell" } : file[name] ? { value: file[name], source: "shipstation-e2e-ui/.env" } : { value: "", source: null });
  const environment = (from("SHIPSTATION_ENV").value || "sandbox").trim().toLowerCase();
  const spec = ENVIRONMENTS[environment];
  if (!spec) throw new Error(`SHIPSTATION_ENV must be sandbox or production, not "${environment}"`);

  const { value: rawKey, source: keySource } = from(spec.keyVar);
  const apiKey = rawKey.trim();
  if (!apiKey) throw new Error(`SHIPSTATION_ENV=${environment} but ${spec.keyVar} is empty (shell, shipstation-e2e-ui/.env)`);
  if (environment === "sandbox" && !apiKey.startsWith("TEST_")) throw new Error(`refusing: ${spec.keyVar} is not a TEST_ sandbox key`);
  if (environment === "production" && apiKey.startsWith("TEST_")) throw new Error(`refusing: ${spec.keyVar} is a TEST_ key — that is a sandbox key, put it in SHIPSTATION_SANDBOX_API_KEY`);

  const writes = environment === "sandbox" || /^(true|1|yes)$/i.test(from("SHIPSTATION_PRODUCTION_WRITES").value.trim());
  const limitText = from("SHIPSTATION_RATE_LIMIT_PER_MINUTE").value.trim();
  const limit = limitText ? Number(limitText) : spec.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error(`SHIPSTATION_RATE_LIMIT_PER_MINUTE must be a whole number from 1 to 1000, not "${limitText}"`);
  return { environment, apiKey, keySource, writes, limit };
}

/** `Retry-After` as milliseconds: delta-seconds or an HTTP date (RFC 9110 §10.2.3); null when absent or unreadable. */
export function retryAfterMs(header, now = Date.now()) {
  if (!header) return null;
  if (/^\d+$/.test(header.trim())) return Number(header.trim()) * 1000;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** A sliding-window limiter: at most `limit` starts per `windowMs`, served first come first served. */
export function createLimiter({ limit, windowMs, now, sleep }) {
  const starts = [];
  let tail = Promise.resolve();
  let queued = 0;
  const prune = () => { const since = now() - windowMs; while (starts.length && starts[0] <= since) starts.shift(); };
  return {
    acquire() {
      queued++;
      const turn = tail.then(async () => {
        for (;;) {
          prune();
          if (starts.length < limit) { starts.push(now()); return; }
          await sleep(starts[0] + windowMs - now() + 5);
        }
      }).finally(() => { queued--; });
      tail = turn.catch(() => {});
      return turn;
    },
    /** ShipStation said to wait: hold every later start until then. */
    pause(ms) { const until = now() + ms; tail = tail.then(() => sleep(Math.max(0, until - now()))); },
    stats() { prune(); return { calls: starts.length, queued, limit, windowMs }; },
  };
}

export function createShipStation({
  apiKey, fetch: fetcher = globalThis.fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  timeoutMs = 20_000, limit = 20, windowMs = 60_000, maxRetryWaitMs = 30_000,
}) {
  const limiter = createLimiter({ limit, windowMs, now, sleep });
  let vendorLimit = null;

  async function once({ method, path, query, body }) {
    await limiter.acquire();
    const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : "";
    let response;
    try {
      response = await fetcher(`${API_BASE}${path}${qs}`, {
        method, redirect: "error", signal: AbortSignal.timeout(timeoutMs),
        headers: { "api-key": apiKey, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      return { lost: error?.name === "TimeoutError" ? `ShipStation did not answer in ${timeoutMs / 1000} s` : `ShipStation could not be reached (${error?.message ?? "network"})` };
    }
    const remaining = response.headers.get("x-rate-limit-remaining");
    if (remaining !== null) vendorLimit = { remaining: Number(remaining), limit: Number(response.headers.get("x-rate-limit-limit")) || null, at: now() };
    const text = await response.text();
    let parsed = null;
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 2000) }; } }
    return { response, parsed };
  }

  /** One ShipStation call. A read (`GET`) is retried once after a 429 (honouring Retry-After, at most 30 s), a 5xx or a
   * lost answer; a write is sent exactly once. */
  async function call({ method = "GET", path, query, body }) {
    const read = method === "GET";
    for (let attempt = 1; ; attempt++) {
      const { response, parsed, lost } = await once({ method, path, query, body });
      if (lost) {
        if (read && attempt === 1) { await sleep(1000); continue; }
        throw new UnreachableError(lost, { write: !read });
      }
      if (response.ok) return parsed ?? { status: response.status };
      const wait = retryAfterMs(response.headers.get("retry-after"), now());
      if (response.status === 429) {
        const ms = wait ?? windowMs;
        limiter.pause(Math.min(ms, windowMs));
        if (read && attempt === 1 && ms <= maxRetryWaitMs) { await sleep(ms); continue; }
        throw new VendorError(429, parsed, { retryAfterMs: ms });
      }
      if (read && attempt === 1 && response.status >= 500) { await sleep(1000); continue; }
      throw new VendorError(response.status, parsed);
    }
  }

  return { call, stats: () => ({ ...limiter.stats(), vendor: vendorLimit }) };
}
