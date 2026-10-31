// The page's only door to its server. Every answer refreshes the rate meter from the server's headers; every failure is
// an ApiError that says who refused (ShipStation or this tool) and whether a write's outcome is unknown.
import { carrierSetupHint } from "./moves.ts";
import type { Meta, OpInput, OpResult, ShipmentPage, ShipmentRecord } from "./types.ts";

export class ApiError extends Error {
  status: number;
  from: "shipstation" | "shipstation-e2e-ui" | "network";
  requestId: string | null;
  errors: Array<{ code: string | null; message: string | null; field: string | null }>;
  outcome: string | null;
  retryAfterMs: number | null;
  constructor(status: number, body: Record<string, unknown> | null, fallback: string) {
    const e = (body?.error ?? {}) as Record<string, unknown>;
    super(typeof e.message === "string" && e.message ? e.message : fallback);
    this.status = status;
    this.from = e.from === "shipstation" ? "shipstation" : status === 0 ? "network" : "shipstation-e2e-ui";
    this.requestId = typeof e.requestId === "string" ? e.requestId : null;
    this.errors = Array.isArray(e.errors) ? (e.errors as ApiError["errors"]) : [];
    this.outcome = typeof e.outcome === "string" ? e.outcome : null;
    this.retryAfterMs = typeof e.retryAfterMs === "number" ? e.retryAfterMs : null;
  }
}

/* ---------- the rate meter ---------- */

export interface Meter { calls: number; limit: number; queued: number }
let meter: Meter = { calls: 0, limit: 20, queued: 0 };
const meterListeners = new Set<() => void>();
export const meterStore = {
  get: () => meter,
  subscribe(listener: () => void) { meterListeners.add(listener); return () => { meterListeners.delete(listener); }; },
};
/** The account this page was drawn for. An answer from another one (shipstation-e2e-ui/.env switched under an open tab) reloads
 * the page, so nothing read from one account is shown — or acted on — as the other's. */
let pageEnvironment: string | null = null;
function checkEnvironment(response: Response) {
  const environment = response.headers.get("x-ss-environment");
  if (!environment) return;
  if (pageEnvironment === null) pageEnvironment = environment;
  else if (environment !== pageEnvironment) window.location.reload();
}

function readMeter(response: Response) {
  checkEnvironment(response);
  const calls = response.headers.get("x-ss-calls");
  if (calls === null) return;
  meter = { calls: Number(calls), limit: Number(response.headers.get("x-ss-limit")) || 20, queued: Number(response.headers.get("x-ss-queued")) || 0 };
  for (const listener of meterListeners) listener();
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method, signal,
      headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new ApiError(0, null, "this tool's server could not be reached — is `npm run dev` still running?");
  }
  readMeter(response);
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) throw new ApiError(response.status, data, `HTTP ${response.status}`);
  return data as T;
}

export const api = {
  meta: (signal?: AbortSignal) => request<Meta>("GET", "/api/meta", undefined, signal),
  shipments: (query: Record<string, string>, signal?: AbortSignal) => request<ShipmentPage>("GET", `/api/shipments?${new URLSearchParams(query)}`, undefined, signal),
  record: (shipmentId: string, signal?: AbortSignal) => request<ShipmentRecord>("GET", `/api/shipments/${encodeURIComponent(shipmentId)}/record`, undefined, signal),
  run: (operationId: string, input: OpInput) => request<OpResult>("POST", `/api/op/${operationId}`, input),
};

/** A short line for a toast or an error box. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : String(error);
  const head = error.from === "shipstation" ? `ShipStation ${error.status}` : error.from === "network" ? "No answer" : `This tool (${error.status})`;
  const parts = [`${head}: ${error.message}`];
  if (error.status === 429) parts.push(`the sandbox allows 20 calls a minute — try again in ${Math.ceil((error.retryAfterMs ?? 60_000) / 1000)} s`);
  if (error.requestId) parts.push(`request_id ${error.requestId}`);
  const hint = carrierSetupHint(error.message);
  if (hint) parts.push(hint);
  return parts.join(" · ");
}

/** Reads are retried by the server already; the page retries only when the server itself did not answer. */
export const retryOnce = (count: number, error: unknown) => count < 1 && error instanceof ApiError && error.status === 0;
