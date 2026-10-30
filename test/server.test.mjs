// The server half: the key guard, the limiter, retries, the operation door and the router's guards. No network.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApi, createHandler, pathFor, queryFor } from "../server/handler.mjs";
import { OPERATIONS, OPERATIONS_BY_ID } from "../server/operations.mjs";
import { InputError, UnreachableError, VendorError, createLimiter, createShipStation, loadConfig, retryAfterMs } from "../server/shipstation.mjs";

const KEY = "TEST_fakeKeyForTests";

/** A fake clock: `sleep` moves time on instead of waiting. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, sleep: async (ms) => { t += Math.max(0, ms); } };
}

/** A fetch answering from `reply(url, init, n)`: a body, `{ status, body, headers }`, or `"lost"`. */
function fakeFetch(reply = () => ({})) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const answer = reply(url, init, calls.length) ?? {};
    if (answer === "lost") throw new TypeError("fetch failed");
    const { status = 200, body = answer, headers = {} } = "status" in answer ? answer : { body: answer };
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  };
  return { fetch, calls };
}

test("the account: SHIPSTATION_ENV picks it; the shell beats shipstation-e2e-ui/.env", () => {
  const dir = mkdtempSync(join(tmpdir(), "shipstation-e2e-ui-"));
  const own = join(dir, ".env");
  writeFileSync(own, '# comment\nSHIPSTATION_ENV=sandbox\nSHIPSTATION_SANDBOX_API_KEY="TEST_file"\nSHIPSTATION_PRODUCTION_API_KEY=liveKey\n');

  assert.deepEqual(loadConfig({ env: {}, envFile: own }),
    { environment: "sandbox", apiKey: "TEST_file", keySource: "shipstation-e2e-ui/.env", writes: true, limit: 20 });
  assert.equal(loadConfig({ env: { SHIPSTATION_SANDBOX_API_KEY: "TEST_shell" }, envFile: own }).keySource, "shell");

  const prod = loadConfig({ env: { SHIPSTATION_ENV: "production" }, envFile: own });
  assert.deepEqual(prod, { environment: "production", apiKey: "liveKey", keySource: "shipstation-e2e-ui/.env", writes: false, limit: 200 });
  assert.equal(loadConfig({ env: { SHIPSTATION_ENV: "production", SHIPSTATION_PRODUCTION_WRITES: "true" }, envFile: own }).writes, true);
  assert.equal(loadConfig({ env: { SHIPSTATION_RATE_LIMIT_PER_MINUTE: "5" }, envFile: own }).limit, 5);
});

test("the account: a wrong key or setting refuses to start", () => {
  const dir = mkdtempSync(join(tmpdir(), "shipstation-e2e-ui-"));
  const own = join(dir, ".env");
  writeFileSync(own, "SHIPSTATION_ENV=sandbox\n");
  assert.throws(() => loadConfig({ env: { SHIPSTATION_SANDBOX_API_KEY: "liveKey" }, envFile: own }), /not a TEST_ sandbox key/);
  assert.throws(() => loadConfig({ env: { SHIPSTATION_ENV: "production", SHIPSTATION_PRODUCTION_API_KEY: KEY }, envFile: own }), /is a TEST_ key/);
  assert.throws(() => loadConfig({ env: { SHIPSTATION_ENV: "production" }, envFile: own }), /SHIPSTATION_PRODUCTION_API_KEY is empty/);
  assert.throws(() => loadConfig({ env: {}, envFile: own }), /SHIPSTATION_SANDBOX_API_KEY is empty/);
  assert.throws(() => loadConfig({ env: { SHIPSTATION_ENV: "staging" }, envFile: own }), /sandbox or production/);
  assert.throws(() => loadConfig({ env: { SHIPSTATION_SANDBOX_API_KEY: KEY, SHIPSTATION_RATE_LIMIT_PER_MINUTE: "lots" }, envFile: own }), /whole number/);
});

test("a read-only production account runs reads and refuses every change before ShipStation sees it", async () => {
  const { fetch, calls } = fakeFetch(() => ({ ok: true }));
  const api = createApi(createShipStation({ apiKey: "liveKey", fetch, ...clock() }), { environment: "production", writes: false });
  await api.run("shipment.get", { params: { shipment_id: "se-1" } });
  await api.run("rates.calculate", { params: {}, body: { shipment_id: "se-1", rate_options: { carrier_ids: [] } } });
  for (const id of ["shipment.cancel", "label.void", "label.buyFromRate", "shipment.hold"]) {
    const error = await api.run(id, { params: { shipment_id: "se-1", label_id: "se-2", rate_id: "se-3" }, body: {} }).catch((e) => e);
    assert.equal(error.status, 403, id);
    assert.match(error.message, /SHIPSTATION_PRODUCTION_WRITES=true/);
  }
  assert.equal(calls.length, 2, "only the two reads reached ShipStation");
});

test("Retry-After: seconds or an HTTP date", () => {
  assert.equal(retryAfterMs("7"), 7000);
  assert.equal(retryAfterMs(new Date(5_000).toUTCString(), 1_000), 4000);
  assert.equal(retryAfterMs(null), null);
  assert.equal(retryAfterMs("soon"), null);
});

test("the limiter lets 20 calls start in a minute and queues the 21st until the window frees", async () => {
  const c = clock();
  const limiter = createLimiter({ limit: 20, windowMs: 60_000, ...c });
  const start = c.now();
  for (let i = 0; i < 20; i++) await limiter.acquire();
  assert.equal(c.now(), start, "the first twenty do not wait");
  await limiter.acquire();
  assert.ok(c.now() - start >= 60_000, "the twenty-first waits for the oldest to leave the window");
});

test("a read is retried once after a 429, honouring Retry-After; a write never is", async () => {
  const c = clock();
  const { fetch, calls } = fakeFetch((_u, _i, n) => (n === 1 ? { status: 429, headers: { "retry-after": "2" }, body: { errors: [{ message: "slow down" }] } } : { shipments: [] }));
  const ss = createShipStation({ apiKey: KEY, fetch, ...c });
  assert.deepEqual(await ss.call({ path: "/shipments" }), { shipments: [] });
  assert.equal(calls.length, 2);

  const w = fakeFetch(() => ({ status: 429, headers: { "retry-after": "2" }, body: {} }));
  const ws = createShipStation({ apiKey: KEY, fetch: w.fetch, ...c });
  const error = await ws.call({ method: "PUT", path: "/shipments/se-1/cancel" }).catch((e) => e);
  assert.ok(error instanceof VendorError);
  assert.equal(error.status, 429);
  assert.equal(error.retryAfterMs, 2000);
  assert.equal(w.calls.length, 1, "a write is sent exactly once");
});

test("a lost answer: a read is retried once, a write is reported as an unknown outcome", async () => {
  const c = clock();
  const r = fakeFetch((_u, _i, n) => (n === 1 ? "lost" : { ok: true }));
  assert.deepEqual(await createShipStation({ apiKey: KEY, fetch: r.fetch, ...c }).call({ path: "/carriers" }), { ok: true });
  assert.equal(r.calls.length, 2);

  const w = fakeFetch(() => "lost");
  const error = await createShipStation({ apiKey: KEY, fetch: w.fetch, ...c }).call({ method: "POST", path: "/labels/rates/se-1", body: {} }).catch((e) => e);
  assert.ok(error instanceof UnreachableError);
  assert.equal(error.outcome, "unknown");
  assert.equal(error.status, 504);
  assert.equal(w.calls.length, 1);
});

test("the operation door: declared query only, checked path parameters, the method of the catalogue", async () => {
  assert.deepEqual(queryFor([{ name: "shipment_id" }, { name: "page_size", type: "integer" }], { shipment_id: "se-1", page_size: "25", evil: "x" }), { shipment_id: "se-1", page_size: "25" });
  assert.throws(() => queryFor([{ name: "sort_dir", enum: ["asc", "desc"] }], { sort_dir: "sideways" }), InputError);
  assert.throws(() => queryFor([{ name: "page", type: "integer" }], { page: "1; drop" }), InputError);
  const tagAdd = OPERATIONS_BY_ID.get("shipment.tagAdd");
  assert.equal(pathFor(tagAdd, { shipment_id: "se-1", tag_name: "Rush order" }), "/shipments/se-1/tags/Rush%20order");
  assert.throws(() => pathFor(tagAdd, { shipment_id: "../carriers", tag_name: "x" }), InputError);
  assert.throws(() => pathFor(tagAdd, { shipment_id: "se-1", tag_name: "a/b" }), InputError);

  const { fetch, calls } = fakeFetch(() => ({ approved: true }));
  const api = createApi(createShipStation({ apiKey: KEY, fetch, ...clock() }));
  const answer = await api.run("label.void", { params: { label_id: "se-9" }, body: { ignored: true } });
  assert.equal(answer.path, "/v2/labels/se-9/void");
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].body, undefined, "an operation without a body sends none");
  await api.run("shipment.hold", { params: { shipment_id: "se-1" }, body: { hold_until_date: "2026-10-30" } });
  assert.deepEqual(calls[1].body, { hold_until_date: "2026-10-30" });
  await assert.rejects(() => api.run("shipment.delete", { params: {} }), /no such operation/);
});

test("every operation of the catalogue names a known method, a /path and rules for its parameters", () => {
  const ids = new Set();
  for (const op of OPERATIONS) {
    assert.ok(!ids.has(op.id), `duplicate ${op.id}`); ids.add(op.id);
    assert.match(op.method, /^(GET|POST|PUT|DELETE)$/);
    assert.match(op.path, /^\/[a-z_]/);
    for (const name of op.path.match(/\{(\w+)\}/g)?.map((p) => p.slice(1, -1)) ?? []) assert.ok(op.params?.[name], `${op.id}: no rule for {${name}}`);
    assert.ok(["shipment", "label", "account"].includes(op.scope));
    assert.ok(["read", "write", "spend", "danger"].includes(op.kind));
  }
});

test("a search asks by order number and by external id and merges both, newest first", async () => {
  const { fetch, calls } = fakeFetch((url) => (url.includes("external_shipment_id")
    ? { shipments: [{ shipment_id: "se-1", created_at: "2026-10-20T00:00:00Z" }] }
    : { shipments: [{ shipment_id: "se-1", created_at: "2026-10-20T00:00:00Z" }, { shipment_id: "se-2", created_at: "2026-10-21T00:00:00Z" }] }));
  const api = createApi(createShipStation({ apiKey: KEY, fetch, ...clock() }));
  const answer = await api.listShipments({ q: "#10001", shipment_status: "on_hold" });
  assert.deepEqual(answer.shipments.map((s) => s.shipment_id), ["se-2", "se-1"]);
  assert.ok(calls.every((c) => new URL(c.url).searchParams.get("shipment_status") === "on_hold"), "the other filters still apply");
});

async function withServer(run) {
  const { fetch, calls } = fakeFetch(() => ({ shipments: [], page: 1, pages: 1, total: 0 }));
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  server.on("request", createHandler({ ss: createShipStation({ apiKey: KEY, fetch, ...clock() }), port }));
  try { await run({ base: `http://127.0.0.1:${port}`, port, calls }); } finally { server.close(); }
}

test("the router: its own host, writes from its own page as JSON, no route outside the catalogue, the key in no answer", async () => {
  await withServer(async ({ base, port, calls }) => {
    const list = await fetch(`${base}/api/shipments`);
    assert.equal(list.status, 200);
    assert.ok(list.headers.get("x-ss-calls"));
    assert.ok(!(await list.text()).includes(KEY));
    const meta = await (await fetch(`${base}/api/meta`)).json();
    assert.equal(meta.operations.length, OPERATIONS.length);

    const origin = `http://127.0.0.1:${port}`;
    const json = { "content-type": "application/json" };
    assert.equal((await fetch(`${base}/api/op/shipment.cancel`, { method: "POST", headers: json, body: "{}" })).status, 403, "no Origin");
    assert.equal((await fetch(`${base}/api/op/shipment.cancel`, { method: "POST", headers: { ...json, origin: "http://evil.test" }, body: "{}" })).status, 403);
    assert.equal((await fetch(`${base}/api/op/shipment.cancel`, { method: "POST", headers: { origin, "content-type": "text/plain" }, body: "{}" })).status, 415);
    assert.equal((await fetch(`${base}/api/op/shipment.cancel`, { method: "POST", headers: { ...json, origin }, body: JSON.stringify({ params: { shipment_id: "se-1/void" } }) })).status, 400);
    assert.equal((await fetch(`${base}/api/op/nope`, { method: "POST", headers: { ...json, origin }, body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/api/environment/webhooks`)).status, 404);
    assert.equal((await fetch(`${base}/api/shipments/%E0%A4%A/record`)).status, 400);
    const before = calls.length;
    assert.equal((await fetch(`${base}/api/op/shipment.cancel`, { method: "POST", headers: { ...json, origin }, body: JSON.stringify({ params: { shipment_id: "se-1" } }) })).status, 200);
    assert.equal(calls.length, before + 1);
    assert.equal(calls.at(-1).url, "https://api.shipstation.com/v2/shipments/se-1/cancel");

    const status = await new Promise((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path: "/api/meta", headers: { host: `attacker.test:${port}` } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject); req.end();
    });
    assert.equal(status, 421, "DNS rebinding: another Host is refused");
  });
});
