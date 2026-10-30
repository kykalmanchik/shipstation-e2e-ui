// The page's pure half: the view in the address, and what a record may do now. Node strips the types itself.
import assert from "node:assert/strict";
import { test } from "node:test";
import { draft, unavailable, type Context } from "../src/lib/actions.ts";
import type { Label, Operation, Shipment } from "../src/lib/types.ts";
import { VOID_RISK, noSize, packageChanged, packageError, packageOf, updatePackageStep, defaultCarrierCode, defaultTracking, executePlan, holdDateError, moves, plan, rateRequest, refusalOf, shipError, stageOf, tomorrow, buyable, type Step } from "../src/lib/moves.ts";
import { parseView, serializeView } from "../src/lib/url-state.ts";
// @ts-expect-error — a plain .mjs module without types
import { OPERATIONS_BY_ID } from "../server/operations.mjs";

const op = (id: string) => OPERATIONS_BY_ID.get(id) as Operation;
const shipment = (over: Partial<Shipment> = {}): Shipment => ({ shipment_id: "se-1", shipment_status: "pending", ...over });
const label = (over: Partial<Label> = {}): Label => ({ label_id: "se-9", status: "completed", voided: false, tracking_number: "1Z1", carrier_code: "ups", ...over });
const ctx = (s: Partial<Shipment> = {}, labels: Label[] = [], l?: Label): Context => ({ shipment: shipment(s), labels, ...(l ? { label: l } : {}), today: "2026-10-22" });

test("the view round-trips through the address, defaults left out", () => {
  const view = parseView("?q=%231001&shipment_status=on_hold&page=3&page_size=50&open=se-5&op=label.void%40se-9");
  assert.deepEqual(view, { tab: "shipments", filters: { q: "#1001", shipment_status: "on_hold" }, page: 3, pageSize: 50, open: "se-5", op: "label.void@se-9", move: null });
  assert.deepEqual(parseView(serializeView(view)), view);
  assert.equal(serializeView(parseView("")), "");
  assert.deepEqual(parseView("?page=-2&page_size=7&open=../x&op=<script>"), { tab: "shipments", filters: {}, page: 1, pageSize: 25, open: null, op: null, move: null });
});

test("a label out ends hold, cancel, update and a second label — the rules ShipStation answers with", () => {
  const labelled = ctx({ shipment_status: "label_purchased" }, [label()]);
  for (const id of ["shipment.hold", "shipment.cancel", "shipment.update", "label.buyFromRate", "fulfillment.create"]) assert.ok(unavailable(op(id), labelled), id);
  assert.equal(unavailable(op("rates.calculate"), labelled), null);
  assert.equal(unavailable(op("label.void"), { ...labelled, label: label() }), null);
});

test("on hold: a label waits for the restore; restore only on hold", () => {
  const held = ctx({ shipment_status: "on_hold", hold_until_date: "2026-10-30" });
  assert.match(unavailable(op("label.buyFromRate"), held) ?? "", /hold/);
  assert.equal(unavailable(op("shipment.restore"), held), null);
  assert.ok(unavailable(op("shipment.restore"), ctx()));
});

test("split and merge need a sales order; track needs a tracking number; void a live label only", () => {
  assert.ok(unavailable(op("shipment.split"), ctx()));
  assert.equal(unavailable(op("shipment.split"), ctx({ sales_order_ids: ["so-1"] })), null);
  assert.ok(unavailable(op("label.track"), ctx({}, [], label({ tracking_number: "" }))));
  assert.ok(unavailable(op("label.void"), ctx({}, [], label({ voided: true, status: "voided" }))));
  assert.equal(unavailable(op("label.cancelRefund"), ctx({}, [], label({ voided: true, status: "voided" }))), null);
});

test("a read-only account: every change is unavailable, every read still runs", () => {
  const readOnly = { ...ctx({}, [label()], label()), readOnly: true };
  for (const id of ["shipment.hold", "shipment.cancel", "label.void", "label.buyFromRate", "shipment.notes"]) assert.match(unavailable(op(id), readOnly) ?? "", /read-only/, id);
  for (const id of ["shipment.get", "rates.calculate", "label.get"]) assert.equal(unavailable(op(id), readOnly), null, id);
});

test("a form starts with the record's ids and safe defaults", () => {
  assert.deepEqual(draft(op("shipment.hold"), ctx()), { params: { shipment_id: "se-1" }, query: {}, body: { hold_until_date: "2026-10-23" } });
  assert.deepEqual(draft(op("label.void"), ctx({}, [], label())).params, { label_id: "se-9" });
  const update = draft(op("shipment.update"), ctx({ created_at: "x", tags: [], ship_to: { name: "A" } })).body as Record<string, unknown>;
  assert.ok(!("shipment_id" in update) && !("created_at" in update) && !("tags" in update) && "ship_to" in update);
  assert.deepEqual(draft(op("rates.calculate"), { ...ctx(), carrierIds: ["se-c1"] }).body, { shipment_id: "se-1", rate_options: { carrier_ids: ["se-c1"] } });
  assert.deepEqual(draft(op("shipment.labels"), ctx()).query, { shipment_id: "se-1" });
});

const why = (c: Context, id: string) => moves(c).find((m) => m.id === id)!.why;

test("the stage is read from the status, the hold date and the labels", () => {
  assert.equal(stageOf(ctx()), "pending");
  assert.equal(stageOf(ctx({ shipment_status: "on_hold" })), "on_hold");
  assert.equal(stageOf(ctx({ hold_until_date: "2026-10-30" })), "on_hold");
  assert.equal(stageOf(ctx({ shipment_status: "label_purchased" }, [label()])), "label_purchased");
  assert.equal(stageOf(ctx({ shipment_status: "cancelled" })), "cancelled");
  assert.equal(stageOf(ctx({ shipment_status: "pending_fulfillment" })), "pending");
});

test("Move to: what each stage allows, and Shipped, Delivered and Problem never", () => {
  const fresh = ctx();
  assert.ok(why(fresh, "pending")); // already there
  for (const id of ["on_hold", "label_purchased", "cancelled"]) assert.equal(why(fresh, id), null, id);
  assert.equal(why(fresh, "shipped"), null); // by a fulfillment
  for (const id of ["delivered", "problem"]) assert.match(why(fresh, id) ?? "", /tracking/i, id);

  const held = ctx({ shipment_status: "on_hold", hold_until_date: "2026-10-30" });
  assert.equal(why(held, "pending"), null);
  assert.equal(why(held, "on_hold"), null); // a new date replaces the old one
  assert.equal(why(held, "label_purchased"), null); // the restore runs first

  const labelled = ctx({ shipment_status: "label_purchased" }, [label()]);
  assert.equal(why(labelled, "pending"), null); // by voiding the label
  assert.equal(why(labelled, "cancelled"), null);
  assert.ok(why(labelled, "on_hold") && why(labelled, "label_purchased"));

  const cancelled = ctx({ shipment_status: "cancelled" });
  for (const id of ["pending", "on_hold", "label_purchased"]) assert.match(why(cancelled, id) ?? "", /stays cancelled/, id);
  assert.ok(why(cancelled, "cancelled"));
});

test("a read-only account can move nowhere", () => {
  for (const id of ["pending", "on_hold", "label_purchased", "cancelled"]) {
    const m = moves({ ...ctx({ shipment_status: "on_hold" }), readOnly: true }).find((x) => x.id === id)!;
    if (id !== "on_hold") assert.match(m.why ?? "", /read-only/, id);
  }
});

test("plans: release, void then cancel, hold with its date, restore before a purchase", () => {
  const ops = (steps: Step[]) => steps.map((s) => s.op);
  const held = ctx({ shipment_status: "on_hold", hold_until_date: "2026-10-30" });
  assert.deepEqual(ops(plan("pending", held)), ["shipment.restore"]);
  assert.deepEqual(ops(plan("label_purchased", held)), ["shipment.restore"]);
  assert.deepEqual(ops(plan("label_purchased", ctx())), []);

  const labelled = ctx({ shipment_status: "label_purchased" }, [label({ label_id: "se-9" }), label({ label_id: "se-8", voided: true, status: "voided" })]);
  assert.deepEqual(ops(plan("pending", labelled)), ["label.void"]);
  assert.deepEqual(plan("pending", labelled)[0]!.input.params, { label_id: "se-9" });
  assert.deepEqual(ops(plan("cancelled", labelled)), ["label.void", "shipment.cancel"]);
  assert.deepEqual(ops(plan("cancelled", ctx())), ["shipment.cancel"]);

  assert.deepEqual(plan("on_hold", ctx(), { holdUntil: "2026-10-30" })[0]!.input, { params: { shipment_id: "se-1" }, query: {}, body: { hold_until_date: "2026-10-30" } });
  assert.deepEqual(plan("on_hold", ctx()), []);
});

test("every step of a plan is an operation of the catalogue, with the parameters it names", () => {
  const labelled = ctx({ shipment_status: "label_purchased" }, [label()]);
  for (const s of [...plan("cancelled", labelled), ...plan("on_hold", ctx(), { holdUntil: "2026-10-30" }), ...plan("pending", ctx({ shipment_status: "on_hold" }))]) {
    const o = op(s.op);
    assert.ok(o, s.op);
    assert.deepEqual(Object.keys(s.input.params).sort(), Object.keys(o.params ?? {}).sort(), s.op);
  }
});

test("the hold date: later than today, a real date", () => {
  assert.equal(tomorrow("2026-10-31"), "2026-11-01");
  assert.equal(holdDateError("2026-10-23", "2026-10-22"), null);
  assert.ok(holdDateError("2026-10-22", "2026-10-22"));
  assert.ok(holdDateError("", "2026-10-22"));
  assert.ok(holdDateError("2026-13-40", "2026-10-22"));
});

test("a rate request narrows by service and package only when they are chosen; refused rates are not offered", () => {
  assert.deepEqual(rateRequest("se-1", ["se-c"]), { shipment_id: "se-1", rate_options: { carrier_ids: ["se-c"] } });
  assert.deepEqual(rateRequest("se-1", ["se-c"], "ups_ground", "package").rate_options, { carrier_ids: ["se-c"], service_codes: ["ups_ground"], package_types: ["package"] });
  const rates = [
    { rate_id: "b", shipping_amount: { amount: 9, currency: "usd" } }, { rate_id: "a", shipping_amount: { amount: 5, currency: "usd" } },
    { rate_id: null }, { rate_id: "c", validation_status: "invalid" }, { rate_id: "d", error_messages: ["x"] },
  ];
  assert.deepEqual(buyable(rates).map((r) => r.rate_id), ["a", "b"]);
});

test("a plan stops at the first failure; a refused void is a failure although it answered 200", async () => {
  const steps: Step[] = ["label.void", "shipment.cancel"].map((o) => ({ op: o, title: o, input: { params: {}, query: {} } }));
  const seen: string[] = [];
  const states: string[] = [];
  const refusing = async (o: string) => { seen.push(o); return { operation: o, method: "PUT", path: "", query: {}, data: o === "label.void" ? { approved: false, message: "no" } : {} }; };
  const out = await executePlan(steps, refusing, (i, s) => { states[i] = s.status; });
  assert.deepEqual(out, { ok: false, failedAt: 0 });
  assert.deepEqual(seen, ["label.void"]);
  assert.deepEqual(states, ["failed", "skipped"]);
  assert.match(refusalOf("label.void", { operation: "", method: "", path: "", query: {}, data: { approved: false, reason_code: "validation_failed" } }) ?? "", /validation_failed/);
  assert.equal(refusalOf("shipment.cancel", { operation: "", method: "", path: "", query: {}, data: { approved: false } }), null);

  const ok = await executePlan(steps, async (o) => ({ operation: o, method: "", path: "", query: {}, data: { approved: true } }), () => {});
  assert.deepEqual(ok, { ok: true, failedAt: null });
  const thrown = await executePlan(steps, async () => { throw new Error("429"); }, (i, s) => { states[i] = s.status; });
  assert.deepEqual(thrown, { ok: false, failedAt: 0 });
});

test("a chosen move lives in the address and is dropped for any other shipment", () => {
  assert.equal(parseView("?open=se-5&move=cancelled").move, "cancelled");
  assert.equal(parseView("?open=se-5&move=shipped").move, "shipped");
  assert.equal(parseView("?open=se-5&move=delivered").move, null); // not a move: the sandbox cannot reach it
  assert.equal(serializeView(parseView("?open=se-5&move=on_hold")), "?open=se-5&move=on_hold");
});

const fulfilled = (over: Partial<Shipment> = {}, extra: Array<Record<string, unknown>> = [{ fulfillment_id: "se-f1", tracking_number: "1Z999", voided: false }]): Context =>
  ({ ...ctx({ shipment_status: "label_purchased", ...over }, []), fulfillments: extra });

test("a shipment marked shipped with no label is Shipped, not Label purchased; it cannot be taken back, only cancelled", () => {
  assert.equal(stageOf(fulfilled()), "shipped");
  // beside a live label the fulfillment is not the parcel (it is not the parcel); a voided fulfillment is nothing
  assert.equal(stageOf({ ...fulfilled(), labels: [label()] }), "label_purchased");
  assert.equal(stageOf(fulfilled({}, [{ fulfillment_id: "se-f1", voided: true }])), "label_purchased");
  const c = fulfilled();
  for (const id of ["pending", "on_hold", "label_purchased"]) assert.match(why(c, id) ?? "", /fulfillment/i, id);
  assert.ok(why(c, "shipped")); // already here
  assert.equal(why(c, "cancelled"), null);
});

test("Shipped: a fulfillment with the tracking number and carrier; a label is voided first, a hold released first", () => {
  const ops = (steps: Step[]) => steps.map((s) => s.op);
  const input = { tracking: " 1Z999AA10123456784 ", carrierCode: "ups" };
  assert.deepEqual(plan("shipped", ctx(), {}), []); // nothing without the tracking number
  assert.ok(shipError({ tracking: "", carrierCode: "ups" }) && shipError({ tracking: "1Z" }) && shipError(input) === null);
  assert.deepEqual(ops(plan("shipped", ctx(), input)), ["fulfillment.create"]);
  assert.deepEqual(ops(plan("shipped", ctx({ shipment_status: "on_hold", hold_until_date: "2026-10-30" }), input)), ["shipment.restore", "fulfillment.create"]);
  const labelled = ctx({ shipment_status: "label_purchased" }, [label({ label_id: "se-9" })]);
  assert.deepEqual(ops(plan("shipped", labelled, input)), ["label.void", "fulfillment.create"]);
  const body = plan("shipped", ctx(), input).at(-1)!.input.body as { fulfillments: Array<Record<string, unknown>> };
  assert.deepEqual(body.fulfillments, [{ shipment_id: "se-1", tracking_number: "1Z999AA10123456784", carrier_code: "ups", notify_customer: false, notify_order_source: false }]);
  assert.ok(op("fulfillment.create")); // the step is an operation of the catalogue
});

test("Shipped starts from the label's carrier and tracking number, never from the sandbox's placeholder", () => {
  assert.equal(defaultCarrierCode(ctx({}, [label({ carrier_code: "stamps_com" })])), "usps");
  assert.equal(defaultCarrierCode(ctx({ service_code: "fedex_ground" })), "fedex");
  assert.equal(defaultCarrierCode(ctx()), "ups");
  assert.equal(defaultTracking(ctx({}, [label({ tracking_number: "9249090388929700006852" })])), "9249090388929700006852");
  assert.equal(defaultTracking(ctx({}, [label({ tracking_number: "1ZXXXXXXXXXXXXXXXX" })])), "");
  assert.equal(defaultTracking(ctx()), "");
});

test("a plan that voids a USPS label with no tracking number warns first; a tracked or UPS label does not", () => {
  const risky = ctx({ shipment_status: "label_purchased" }, [label({ carrier_code: "stamps_com", tracking_number: null })]);
  const warn = (c: Context, id: string) => moves(c).find((m) => m.id === id)!.warn;
  for (const id of ["pending", "cancelled", "shipped"]) assert.equal(warn(risky, id), VOID_RISK, id);
  assert.equal(warn(risky, "on_hold"), null);
  assert.equal(warn(ctx({ shipment_status: "label_purchased" }, [label({ carrier_code: "stamps_com", tracking_number: "9249" })]), "cancelled"), null);
  assert.equal(warn(ctx({ shipment_status: "label_purchased" }, [label()]), "cancelled"), null);
  assert.equal(warn(ctx(), "cancelled"), null); // nothing to void
  assert.match(refusalOf("label.void", { operation: "", method: "", path: "", query: {}, data: { approved: false, reason_code: "validation_failed", message: "x" } }) ?? "", /no tracking number/);
});

test("the package: no size is told, an edit is validated and saved as the whole shipment with the first package replaced", () => {
  const bare = shipment({ warehouse_id: "se-w", created_at: "x", packages: [{ package_code: "package", weight: { value: 10, unit: "ounce" }, dimensions: { length: 0, width: 0, height: 0, unit: "inch" } }] });
  assert.ok(noSize(bare) && noSize(shipment()) && !noSize(shipment({ packages: [{ dimensions: { length: 1, width: 2, height: 3, unit: "inch" } }] })));
  const edit = { ...packageOf(bare), length: "6", width: "4", height: "3" };
  assert.ok(packageChanged(bare, edit) && !packageChanged(bare, packageOf(bare)));
  assert.equal(packageError(edit), null);
  assert.match(packageError({ ...edit, width: "0" }) ?? "", /Width/);
  const step = updatePackageStep(bare, edit);
  const body = step.input.body as Shipment;
  assert.equal(step.op, "shipment.update");
  assert.deepEqual(step.input.params, { shipment_id: "se-1" });
  assert.deepEqual(body.packages, [{ package_code: "package", weight: { value: 10, unit: "ounce" }, dimensions: { length: 6, width: 4, height: 3, unit: "inch" } }]);
  assert.ok(body.warehouse_id === "se-w" && !("created_at" in body) && !("shipment_id" in body));
});
