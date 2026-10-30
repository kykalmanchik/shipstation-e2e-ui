// The desk's own vocabulary: where a shipment stands, where it may be moved, and the ShipStation calls each move is.
// Pure: the record in, a verdict or a plan out. A plan is a list of steps; each step is one operation of the catalogue
// (server/operations.mjs), so the server's allowlist and the read-only guard of production apply to it unchanged.
import { READ_ONLY as SHIPMENT_READ_ONLY, standing, type Context } from "./actions.ts";
import type { Shipment } from "./types.ts";
import type { OpInput, OpResult } from "./types.ts";

/** The stages a shipment can be moved to: the ones this sandbox can reach. Delivered and a carrier problem come from the
 * carrier's tracking, which no call of ours can set. */
export type Stage = "pending" | "on_hold" | "label_purchased" | "shipped" | "cancelled";
export type MoveId = Stage | "delivered" | "problem";

export const STAGE_LABEL: Record<MoveId, string> = {
  pending: "Awaiting shipment", on_hold: "On hold", label_purchased: "Label purchased", cancelled: "Cancelled",
  shipped: "Shipped", delivered: "Delivered", problem: "Carrier problem",
};
export const MOVABLE: readonly Stage[] = ["pending", "on_hold", "label_purchased", "shipped", "cancelled"];
const isStage = (id: string): id is Stage => (MOVABLE as readonly string[]).includes(id);
export const parseMove = (value: string | null | undefined): Stage | null => (value && isStage(value) ? value : null);

/** Where the shipment stands now, in the desk's words. Any status ShipStation has no word of ours for is Awaiting. */
export function stageOf(ctx: Context): Stage {
  const { cancelled, liveLabel, shipped, held } = standing(ctx);
  return cancelled ? "cancelled" : shipped ? "shipped" : liveLabel ? "label_purchased" : held ? "on_hold" : "pending";
}

export interface Move {
  id: MoveId;
  label: string;
  /** `null` when the move can run now; otherwise why not, in a sentence. */
  why: string | null;
  /** The same reason in two or three words, for an option of a list. */
  short: string | null;
  /** What ShipStation does with the move: the state it ends in and the webhook it sends. */
  hint: string;
  /** What the move still asks for before it can run. */
  needs: "date" | "purchase" | "shipment" | null;
  /** A risk the plan carries although it can run (a void the sandbox is likely to refuse), or `null`. */
  warn: string | null;
}

const DELIVERED_WHY = "Delivered comes from the carrier's tracking (DE): no call of ours sets it — a fulfillment has no delivered field, and the sandbox gives no tracking for USPS and only UN for UPS";
const PROBLEM_WHY = "A carrier problem comes from the carrier's tracking too, and the sandbox gives none";
const FINAL = "A shipment cancelled in ShipStation stays cancelled";
const FULFILLED = "Already shipped by a fulfillment — it cannot be taken back from here";
const READ_ONLY = "Production is read-only here — SHIPSTATION_PRODUCTION_WRITES=true in shipstation-e2e-ui/.env";
/** What a plan that voids a USPS label with no tracking number is up against (measured 2026-10-28: `validation_failed`). */
export const VOID_RISK = "This label is USPS (stamps_com) with no tracking number: the sandbox has refused to void such a label (validation_failed, \"mail-in refund requests\"), so the plan will most likely stop at its first step. A label with a tracking number (UPS, USPS Ground Advantage, Media Mail) voided every time.";

const HINTS: Record<MoveId, string> = {
  pending: "Releases the hold, or voids the label: the shipment goes back to pending.",
  on_hold: "A label cannot be bought on a held shipment until it is restored.",
  label_purchased: "ShipStation sends label_created_v2 about 7 s after the purchase.",
  shipped: "Creates a fulfillment: ShipStation lists it without tracking for a few seconds, then reports the shipment as label_purchased and sends fulfillment_shipped_v2 after about 20 s. Integrations that follow the label ignore a fulfillment beside a bought label, so a live label is voided first.",
  cancelled: "Voids any live label, then cancels. A cancelled shipment stays cancelled.",
  delivered: DELIVERED_WHY, problem: PROBLEM_WHY,
};

/** Every stage with the verdict on moving this shipment there now. */
export function moves(ctx: Context): Move[] {
  const here = stageOf(ctx);
  const { liveLabel, labelsLive } = standing(ctx);
  const verdict = (id: MoveId): [string, string] | null => {
    if (id === "delivered") return [DELIVERED_WHY, "needs carrier tracking"];
    if (id === "problem") return [PROBLEM_WHY, "needs carrier tracking"];
    if (ctx.readOnly && id !== here) return [READ_ONLY, "read-only"];
    if (id === here && id !== "on_hold") return [id === "cancelled" ? "Already cancelled" : "Already here", "already here"];
    if (here === "cancelled") return [FINAL, "cancelled"];
    // A fulfillment is not undone by any call of the catalogue: only a cancel is left to try.
    if (here === "shipped" && id !== "cancelled") return [FULFILLED, "already shipped"];
    if (id === "on_hold" && liveLabel) return ["A label is out — move it to Awaiting shipment first (that voids the label)", "label out"];
    if (id === "label_purchased" && liveLabel) return ["Already has a label", "already here"];
    return null;
  };
  const needs = (id: MoveId): Move["needs"] => (id === "on_hold" ? "date" : id === "label_purchased" ? "purchase" : id === "shipped" ? "shipment" : null);
  // The moves whose plan voids the live labels: Awaiting shipment from a label, Cancelled, and Shipped (a fulfillment is read only without one).
  const risk = labelsLive && voidRisk(ctx);
  const voids = (id: MoveId) => id === "cancelled" || id === "shipped" || (id === "pending" && labelsLive);
  return (["pending", "on_hold", "label_purchased", "shipped", "cancelled", "delivered", "problem"] as MoveId[]).map((id) => {
    const v = verdict(id);
    return { id, label: STAGE_LABEL[id], why: v?.[0] ?? null, short: v?.[1] ?? null, hint: HINTS[id], needs: needs(id), warn: !v && risk && voids(id) ? risk : null };
  });
}

/** The warning of a plan that would void a USPS label the sandbox cannot void, or `null`. */
function voidRisk(ctx: Context): string | null {
  return ctx.labels.some((l) => l.status === "completed" && !l.voided && isStamps(l.carrier_code) && !l.tracking_number) ? VOID_RISK : null;
}

export interface Step { op: string; title: string; input: OpInput }

const restoreStep = (shipmentId: string): Step => ({ op: "shipment.restore", title: "Release the hold", input: { params: { shipment_id: shipmentId }, query: {} } });

/** What the Shipped move asks for: the fulfillment's tracking number and carrier. */
export interface ShipInput { tracking?: string; carrierCode?: string }
export const FULFILLMENT_CARRIERS = ["ups", "usps", "fedex", "dhl_express"] as const;

/** The carrier code of the account's carrier, in a fulfillment's words (docs: "ups", "fedex", "usps"). */
export function defaultCarrierCode(ctx: Context): string {
  const code = [...ctx.labels].reverse().find((l) => l.carrier_code)?.carrier_code ?? ctx.shipment.service_code?.split("_")[0] ?? "ups";
  return code === "stamps_com" ? "usps" : (FULFILLMENT_CARRIERS as readonly string[]).includes(code) ? code : "ups";
}
/** The newest label's tracking number, voided or not, as a starting point; a placeholder number is not offered. */
export function defaultTracking(ctx: Context): string {
  const number = [...ctx.labels].reverse().find((l) => l.tracking_number)?.tracking_number ?? "";
  return /^1Z[X0]+$/.test(number) ? "" : number;
}

export function shipError(input: ShipInput): string | null {
  if (!input.tracking?.trim()) return "A tracking number is required";
  return input.carrierCode ? null : "Choose the carrier";
}

/** The calls that take the shipment to `id`; a move that needs more (a date, a purchase) is completed by the caller. */
export function plan(id: Stage, ctx: Context, opts: { holdUntil?: string } & ShipInput = {}): Step[] {
  const sid = ctx.shipment.shipment_id;
  const { liveLabel, held } = standing(ctx);
  const voids: Step[] = ctx.labels.filter((l) => l.status === "completed" && !l.voided)
    .map((l) => ({ op: "label.void", title: `Void label ${l.label_id}`, input: { params: { label_id: l.label_id }, query: {} } }));
  switch (id) {
    case "pending": return liveLabel ? voids : held ? [restoreStep(sid)] : [];
    case "on_hold": return opts.holdUntil
      ? [{ op: "shipment.hold", title: `Hold until ${opts.holdUntil}`, input: { params: { shipment_id: sid }, query: {}, body: { hold_until_date: opts.holdUntil } } }]
      : [];
    // The purchase is the caller's; a held shipment must be restored before it.
    case "label_purchased": return held ? [restoreStep(sid)] : [];
    // A fulfillment is read only beside no bought label, and only on a released shipment: void or release first.
    case "shipped": return shipError(opts) ? [] : [
      ...(liveLabel ? voids : held ? [restoreStep(sid)] : []),
      { op: "fulfillment.create", title: `Mark shipped (${opts.carrierCode}, ${opts.tracking!.trim()})`,
        input: { params: {}, query: {}, body: { fulfillments: [{ shipment_id: sid, tracking_number: opts.tracking!.trim(), carrier_code: opts.carrierCode, notify_customer: false, notify_order_source: false }] } } },
    ];
    case "cancelled": return [...voids, { op: "shipment.cancel", title: "Cancel the shipment", input: { params: { shipment_id: sid }, query: {} } }];
  }
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const tomorrow = (today: string) => addDays(today, 1);

/** ShipStation's rule: the hold date is date-only and later than today (UTC). */
export function holdDateError(date: string | undefined, today: string): string | null {
  if (!date) return "Pick a date";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return "Not a date";
  return date > today ? null : "Must be later than today (UTC)";
}

/* ---------- buying a label ---------- */

export interface LabelFile { label_format: string; label_layout: string }
export const LABEL_FORMATS = ["pdf", "png", "zpl"] as const;
export const LABEL_LAYOUTS = ["4x6", "letter"] as const;
const fileBody = (file: LabelFile) => ({ label_format: file.label_format, label_layout: file.label_layout, label_download_type: "url" });

export const buyFromRateStep = (rateId: string, file: LabelFile): Step =>
  ({ op: "label.buyFromRate", title: "Buy the label from the chosen rate", input: { params: { rate_id: rateId }, query: {}, body: fileBody(file) } });
export const buyOwnStep = (shipmentId: string, file: LabelFile): Step =>
  ({ op: "label.buyForShipment", title: "Buy the label with the shipment's own carrier and service", input: { params: { shipment_id: shipmentId }, query: {}, body: fileBody(file) } });

/** `POST /v2/rates` for a stored shipment, narrowed by the carrier's service and package type when chosen
 * (docs.shipstation.com/rate-shopping: `rate_options.service_codes` and `package_types` with a `shipment_id`). */
export function rateRequest(shipmentId: string, carrierIds: string[], serviceCode?: string, packageCode?: string) {
  return {
    shipment_id: shipmentId,
    rate_options: { carrier_ids: carrierIds, ...(serviceCode ? { service_codes: [serviceCode] } : {}), ...(packageCode ? { package_types: [packageCode] } : {}) },
  };
}

export interface Rate {
  rate_id?: string | null; carrier_friendly_name?: string; carrier_code?: string; service_type?: string; service_code?: string;
  shipping_amount?: { amount: number; currency: string }; delivery_days?: number | null; error_messages?: string[] | null; validation_status?: string;
}

export function ratesOf(data: unknown): Rate[] {
  const d = data as { rate_response?: { rates?: Rate[] }; rates?: Rate[] } | null;
  return d?.rate_response?.rates ?? d?.rates ?? [];
}
export const purchasable = (r: Rate) => Boolean(r.rate_id) && r.validation_status !== "invalid" && !(r.error_messages?.length);
/** The rates that can be bought, cheapest first. */
export const buyable = (rates: Rate[]) => rates.filter(purchasable).sort((a, b) => (a.shipping_amount?.amount ?? Infinity) - (b.shipping_amount?.amount ?? Infinity));
export function rateText(r: Rate): string {
  const price = r.shipping_amount ? `${r.shipping_amount.amount.toFixed(2)} ${r.shipping_amount.currency.toUpperCase()}` : "no price";
  return `${r.carrier_friendly_name ?? r.carrier_code ?? "?"} · ${r.service_type ?? r.service_code ?? "?"} · ${price}${r.delivery_days ? ` · ${r.delivery_days} d` : ""}`;
}

/* ---------- the package: its size and weight ---------- */

/** The first package's size and weight as the form holds them (text, so a half-typed number stays typed). */
export interface PackageEdit { length: string; width: string; height: string; dimUnit: string; weight: string; weightUnit: string }
export const DIMENSION_UNITS = ["inch", "centimeter"] as const;
export const WEIGHT_UNITS = ["ounce", "pound", "gram", "kilogram"] as const;

export function packageOf(s: Shipment): PackageEdit {
  const p = s.packages?.[0];
  const n = (v: number | undefined) => (v === undefined ? "" : String(v));
  return {
    length: n(p?.dimensions?.length), width: n(p?.dimensions?.width), height: n(p?.dimensions?.height), dimUnit: p?.dimensions?.unit ?? "inch",
    weight: n(p?.weight?.value), weightUnit: p?.weight?.unit ?? "ounce",
  };
}

/** ShipStation's carriers refuse a package with no size ("Dimensions are required in order to use the service specified"):
 * a size of zero is the same as none. */
export const noSize = (s: Shipment): boolean => {
  const d = s.packages?.[0]?.dimensions;
  return !d || !(d.length > 0 && d.width > 0 && d.height > 0);
};

export function packageError(e: PackageEdit): string | null {
  for (const [name, v] of [["Length", e.length], ["Width", e.width], ["Height", e.height], ["Weight", e.weight]] as const) {
    if (!(Number(v) > 0)) return `${name} must be a number above 0`;
  }
  return null;
}
export const packageChanged = (s: Shipment, e: PackageEdit): boolean => JSON.stringify(packageOf(s)) !== JSON.stringify(e);

/** `PUT /v2/shipments/{id}` with the whole shipment and its first package replaced (measured: the update is not partial). */
export function updatePackageStep(s: Shipment, e: PackageEdit): Step {
  const [first, ...rest] = s.packages ?? [];
  const edited = { ...first, weight: { value: Number(e.weight), unit: e.weightUnit }, dimensions: { length: Number(e.length), width: Number(e.width), height: Number(e.height), unit: e.dimUnit } };
  const body = { ...Object.fromEntries(Object.entries(s).filter(([key]) => !SHIPMENT_READ_ONLY.includes(key))), packages: [edited, ...rest] };
  return { op: "shipment.update", title: `Set the package to ${e.length}×${e.width}×${e.height} ${e.dimUnit}, ${e.weight} ${e.weightUnit}`, input: { params: { shipment_id: s.shipment_id }, query: {}, body } };
}

/** A USPS label from this sandbox has no tracking number, and the sandbox has refused to void one; a void of a
 * usps_ground_advantage label was approved on 2026-10-27. */
export const STAMPS_WARNING = "A USPS (stamps_com) sandbox label has no tracking number, and the sandbox has refused to void one before — use UPS when the test needs a void, a cancel or tracking.";
export const isStamps = (carrierCode?: string | null) => carrierCode === "stamps_com";

/* ---------- running a plan ---------- */

export interface StepState { status: "pending" | "running" | "done" | "failed" | "skipped"; message?: string }

/** A 200 that is still a refusal: a void answers `approved: false` (docs: "a refused void is a 200"). */
export function refusalOf(op: string, result: OpResult): string | null {
  if (op !== "label.void") return null;
  const d = result.data as { approved?: boolean; message?: string; reason_code?: string } | null;
  if (d?.approved !== false) return null;
  const hint = d.reason_code === "validation_failed" ? " — in this sandbox a USPS label with no tracking number cannot be voided" : "";
  return `Void refused — ${d.message ?? "no reason given"}${d.reason_code ? ` (${d.reason_code})` : ""}${hint}`;
}

/** Runs the steps in order and stops at the first one that fails or is refused; the rest are skipped. A change is never
 * resent: the caller reads the record again afterwards, which settles an outcome that is unknown. */
export async function executePlan(
  steps: Step[],
  run: (op: string, input: OpInput) => Promise<OpResult>,
  onState: (index: number, state: StepState) => void,
  explain: (error: unknown) => string = (e) => (e instanceof Error ? e.message : String(e)),
): Promise<{ ok: boolean; failedAt: number | null }> {
  for (let i = 0; i < steps.length; i++) {
    onState(i, { status: "running" });
    try {
      const result = await run(steps[i]!.op, steps[i]!.input);
      const refusal = refusalOf(steps[i]!.op, result);
      if (refusal) { onState(i, { status: "failed", message: refusal }); for (let j = i + 1; j < steps.length; j++) onState(j, { status: "skipped" }); return { ok: false, failedAt: i }; }
      onState(i, { status: "done" });
    } catch (error) {
      onState(i, { status: "failed", message: explain(error) });
      for (let j = i + 1; j < steps.length; j++) onState(j, { status: "skipped" });
      return { ok: false, failedAt: i };
    }
  }
  return { ok: true, failedAt: null };
}
