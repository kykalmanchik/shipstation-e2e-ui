// The page's API: three reads the list and the expanded row live on, and one door that runs any operation of the
// catalogue (operations.mjs) by its id. The browser never names a ShipStation path; it names an operation.
import { OPERATIONS, OPERATIONS_BY_ID, PARAM_RULES, SHIPMENT_LIST_QUERY, SHIPMENT_STATUSES } from "./operations.mjs";
import { InputError, SE_ID, UnreachableError, VendorError } from "./shipstation.mjs";

const MAX_BODY = 64 * 1024;
const MAX_VALUE = 200;

function decodePart(part) {
  try { return decodeURIComponent(part); } catch { throw new InputError("the path is not valid percent-encoding"); }
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new InputError("the request body is larger than 64 KB");
    chunks.push(chunk);
  }
  if (size === 0) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new InputError("the request body is not JSON"); }
}

/** Only the declared query parameters, each checked against its own rule; empty values are dropped. */
export function queryFor(declared = [], given = {}) {
  const out = {};
  for (const spec of declared) {
    const raw = given?.[spec.name];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = String(raw).trim();
    if (!value) continue;
    if (value.length > MAX_VALUE) throw new InputError(`${spec.name} is at most ${MAX_VALUE} characters`);
    if (spec.enum && !spec.enum.includes(value)) throw new InputError(`${spec.name} must be one of ${spec.enum.join(", ")}`);
    if (spec.type === "integer" && !/^\d{1,6}$/.test(value)) throw new InputError(`${spec.name} must be a whole number`);
    if (spec.type === "date-time" && !Number.isFinite(Date.parse(value))) throw new InputError(`${spec.name} must be a date or date-time`);
    out[spec.name] = spec.type === "date-time" ? new Date(value).toISOString() : value;
  }
  return out;
}

/** The operation's path with each `{param}` checked against its rule and encoded as one segment. */
export function pathFor(op, params = {}) {
  return op.path.replace(/\{(\w+)\}/g, (_, name) => {
    const value = params?.[name];
    const rule = PARAM_RULES[op.params?.[name]];
    if (typeof value !== "string" || !rule || !rule.test(value)) throw new InputError(`${name} is missing or not valid`);
    return encodeURIComponent(value);
  });
}

/** `account`: { environment, writes, limit, keySource } — never the key. A read-only account runs reads only. */
export function createApi(ss, account = { environment: "sandbox", writes: true }) {
  async function listShipments(given) {
    const q = String(given.q ?? "").trim();
    if (q && SE_ID.test(q)) {
      const shipment = await ss.call({ path: `/shipments/${encodeURIComponent(q)}` });
      return { shipments: [shipment], page: 1, pages: 1, total: 1, searched: "shipment_id" };
    }
    const query = queryFor(SHIPMENT_LIST_QUERY, { sort_by: "created_at", sort_dir: "desc", page_size: "25", ...given });
    if (query.store_id) query.store_id = query.store_id.replace(/^se-/, "");
    if (!q) return ss.call({ path: "/shipments", query });
    if (q.length > 100) throw new InputError("the search is at most 100 characters");
    // Our order number is shipment_number and our order id external_shipment_id: ask both, merge, newest first.
    const [a, b] = await Promise.all([
      ss.call({ path: "/shipments", query: { ...query, page: "1", external_shipment_id: q } }),
      ss.call({ path: "/shipments", query: { ...query, page: "1", shipment_number: q } }),
    ]);
    const seen = new Map();
    for (const s of [...(a?.shipments ?? []), ...(b?.shipments ?? [])]) seen.set(s.shipment_id, s);
    const shipments = [...seen.values()].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
    return { shipments, page: 1, pages: 1, total: shipments.length, searched: "order" };
  }

  async function record(shipmentId) {
    if (!SE_ID.test(shipmentId)) throw new InputError("shipment must be a ShipStation id (se-…)");
    const key = encodeURIComponent(shipmentId);
    const [shipment, labels, fulfillments] = await Promise.all([
      ss.call({ path: `/shipments/${key}` }),
      ss.call({ path: "/labels", query: { shipment_id: shipmentId, page_size: "100" } }),
      ss.call({ path: "/fulfillments", query: { shipment_id: shipmentId, page_size: "25" } }).catch((error) => ({ unavailable: error.message })),
    ]);
    return { shipment, labels: labels?.labels ?? [], fulfillments: fulfillments?.fulfillments ?? [], fulfillmentsUnavailable: fulfillments?.unavailable ?? null };
  }

  async function run(opId, input) {
    const op = OPERATIONS_BY_ID.get(opId);
    if (!op) throw Object.assign(new InputError(`no such operation: ${opId}`), { status: 404 });
    if (!account.writes && op.kind !== "read") {
      throw Object.assign(new InputError(`the ${account.environment} account is read-only here: set SHIPSTATION_PRODUCTION_WRITES=true in shipstation-e2e-ui/.env to run "${op.title}"`), { status: 403 });
    }
    const path = pathFor(op, input?.params);
    const query = queryFor(op.query, input?.query);
    let body;
    if (op.body && op.method !== "GET") {
      body = input?.body ?? {};
      if (typeof body !== "object") throw new InputError("the body must be a JSON object or array");
    }
    const data = await ss.call({ method: op.method, path, query, body });
    return { operation: op.id, method: op.method, path: `/v2${path}`, query, data };
  }

  return { listShipments, record, run };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "cache-control": "no-store", "x-content-type-options": "nosniff", "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

/** The /api/* handler. `next` (Vite's middleware chain) gets everything else; without it, a 404. */
export function createHandler({ ss, port, account = { environment: "sandbox", writes: true, limit: 20, keySource: null } }) {
  const api = createApi(ss, account);
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));

  return async function handle(req, res, next) {
    const url = new URL(req.url ?? "/", "http://local");
    if (!url.pathname.startsWith("/api/")) return next ? next() : send(res, 404, { error: { message: "not found" } });
    // Another site in the same browser could reach a local port by name (DNS rebinding) or post to it.
    if (!hosts.has(req.headers.host ?? "")) return send(res, 421, { error: { message: "unknown host" } });
    if (req.method !== "GET") {
      if (!origins.has(req.headers.origin ?? "")) return send(res, 403, { error: { message: "writes are taken only from this page" } });
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return send(res, 415, { error: { message: "send application/json" } });
    }
    const stats = () => {
      const s = ss.stats();
      return { "x-ss-calls": String(s.calls), "x-ss-limit": String(s.limit), "x-ss-queued": String(s.queued), "x-ss-environment": account.environment };
    };
    try {
      let result;
      let m;
      if (req.method === "GET" && url.pathname === "/api/meta") {
        result = { operations: OPERATIONS, shipmentListQuery: SHIPMENT_LIST_QUERY, statuses: SHIPMENT_STATUSES, account, stats: ss.stats() };
      } else if (req.method === "GET" && url.pathname === "/api/shipments") {
        result = await api.listShipments(Object.fromEntries(url.searchParams));
      } else if (req.method === "GET" && (m = /^\/api\/shipments\/([^/]+)\/record$/.exec(url.pathname))) {
        result = await api.record(decodePart(m[1]));
      } else if (req.method === "POST" && (m = /^\/api\/op\/([a-zA-Z.]+)$/.exec(url.pathname))) {
        result = await api.run(m[1], await readJson(req));
      } else {
        return send(res, 404, { error: { message: `no such route: ${req.method} ${url.pathname}` } }, stats());
      }
      return send(res, 200, result ?? {}, stats());
    } catch (error) {
      if (error instanceof VendorError) {
        return send(res, error.status, { error: { from: "shipstation", status: error.status, message: error.message, requestId: error.requestId, retryAfterMs: error.retryAfterMs, errors: error.errors } },
          { ...stats(), ...(error.retryAfterMs ? { "retry-after": String(Math.ceil(error.retryAfterMs / 1000)) } : {}) });
      }
      if (error instanceof UnreachableError) return send(res, error.status, { error: { from: "shipstation-e2e-ui", message: error.message, outcome: error.outcome } }, stats());
      if (error instanceof InputError) return send(res, error.status, { error: { from: "shipstation-e2e-ui", message: error.message } }, stats());
      console.error(error);
      return send(res, 500, { error: { from: "shipstation-e2e-ui", message: error?.message ?? "failed" } }, stats());
    }
  };
}
