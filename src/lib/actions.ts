// What a record may do now, and what each action's form starts with. Pure: the record in, a verdict or a draft out.
// The rules are ShipStation's own (operations.mjs `notes`, from the v2 spec): a label once out ends hold, cancel and a
// second label.
import type { Label, Operation, OpInput, Shipment } from "./types.ts";

export interface Context {
  shipment: Shipment;
  labels: Label[];
  /** The label a label-scope action is for. */
  label?: Label;
  /** The account's carriers, for a rate request's `carrier_ids`. */
  carrierIds?: string[];
  /** The shipment's fulfillments (marked shipped with no ShipStation label), as the record read them. */
  fulfillments?: Array<Record<string, unknown>>;
  /** Today, as `YYYY-MM-DD` in UTC (ShipStation's hold date is a UTC date). */
  today?: string;
  /** The account runs reads only (production without SHIPSTATION_PRODUCTION_WRITES=true). */
  readOnly?: boolean;
}

const SPLITTABLE = new Set(["pending", "awaiting_payment", "on_hold"]);
/** `PUT /v2/shipments/{id}`'s read-only fields (the spec's `partial_shipment`). */
export const READ_ONLY = ["shipment_id", "created_at", "modified_at", "shipment_status", "tags", "total_weight", "batch_ids"];

/** A fulfillment that still stands: not voided. (ShipStation lists it without a tracking number for a few seconds first.) */
export const liveFulfillment = (f: Record<string, unknown>) => !f.voided && !f.voided_at;

export function standing(ctx: Context) {
  const s = ctx.shipment;
  const cancelled = s.shipment_status === "cancelled";
  const labelsLive = ctx.labels.some((l) => l.status === "completed" && !l.voided);
  // ShipStation calls a shipment marked shipped with no label `label_purchased` too, so the status alone cannot tell the two apart:
  // a live fulfillment beside no live label is the parcel the carrier has; beside a bought label the label wins.
  const shipped = !labelsLive && (ctx.fulfillments ?? []).some(liveFulfillment);
  const liveLabel = labelsLive || s.shipment_status === "label_purchased";
  const held = s.shipment_status === "on_hold" || Boolean(s.hold_until_date);
  return { cancelled, liveLabel, labelsLive, shipped, held };
}

/** `null` when the action is available now; otherwise why not, in a few words. */
export function unavailable(op: Operation, ctx: Context): string | null {
  if (ctx.readOnly && op.kind !== "read") return "Production is read-only here — SHIPSTATION_PRODUCTION_WRITES=true in shipstation-e2e-ui/.env";
  const { cancelled, liveLabel, held } = standing(ctx);
  const s = ctx.shipment;
  const l = ctx.label;
  const liveLabelOf = (x?: Label) => Boolean(x && x.status === "completed" && !x.voided);
  switch (op.id) {
    case "rates.calculate":
      return cancelled ? "The shipment is cancelled" : null;
    case "label.buyForShipment":
    case "label.buyFromRate":
      if (cancelled) return "The shipment is cancelled";
      if (liveLabel) return "A label is out — void it first";
      if (held) return "On hold — a label cannot be bought until it is restored";
      if (op.id === "label.buyForShipment" && !(s.carrier_id && s.service_code)) return "The shipment names no carrier and service — use Get rates";
      return null;
    case "shipment.hold":
    case "shipment.update":
      if (cancelled) return "The shipment is cancelled";
      return liveLabel ? "A label is out — ShipStation refuses (or silently ignores) this after a label" : null;
    case "shipment.restore":
      if (cancelled) return "The shipment is cancelled";
      return held ? null : "The shipment is not on hold";
    case "shipment.cancel":
      if (cancelled) return "Already cancelled";
      return liveLabel ? "Void the label first" : null;
    case "fulfillment.create":
      if (cancelled) return "The shipment is cancelled";
      return liveLabel ? "A label is out — this is for a shipment sent without one" : null;
    case "shipment.split":
    case "shipment.merge":
      if (!SPLITTABLE.has(s.shipment_status ?? "")) return "Needs status pending, awaiting_payment or on_hold";
      return s.sales_order_ids?.length ? null : "Not linked to a sales order (sales_order_ids is empty)";
    case "shipment.tagRemove":
      return s.tags?.length ? null : "The shipment has no tags";
    case "label.void":
    case "label.return":
      return liveLabelOf(l) ? null : "Only a completed label that is not voided";
    case "label.track":
      return l?.tracking_number ? null : "No tracking number — ShipStation answers 400";
    case "label.cancelRefund":
      return l?.voided || l?.status === "voided" ? null : "Only a voided label has a refund request to cancel";
    case "tracking.start":
    case "tracking.stop":
      return l?.tracking_number && l.carrier_code ? null : "The label has no tracking number or carrier";
    default:
      return null;
  }
}

const tomorrow = (today?: string) => {
  const base = today ? Date.parse(`${today}T00:00:00Z`) : Date.now();
  return new Date(base + 86_400_000).toISOString().slice(0, 10);
};
const LABEL_FILE = { label_format: "pdf", label_layout: "4x6", label_download_type: "url" };

/** What the action's form starts with: the record's own ids in the path, sensible defaults in the body. */
export function draft(op: Operation, ctx: Context): OpInput {
  const s = ctx.shipment;
  const l = ctx.label;
  const params: Record<string, string> = {};
  for (const name of Object.keys(op.params ?? {})) {
    if (name === "shipment_id") params[name] = s.shipment_id;
    else if (name === "label_id") params[name] = l?.label_id ?? "";
    else if (name === "external_shipment_id") params[name] = (l?.external_shipment_id ?? s.external_shipment_id ?? "") as string;
    else if (name === "carrier_id") params[name] = l?.carrier_id ?? s.carrier_id ?? "";
    else params[name] = "";
  }
  const query: Record<string, string> = {};
  for (const q of op.query ?? []) {
    if (q.name === "shipment_id") query[q.name] = s.shipment_id;
    else if (q.name === "carrier_code" && l?.carrier_code) query[q.name] = l.carrier_code;
    else if (q.name === "tracking_number" && l?.tracking_number) query[q.name] = l.tracking_number;
    else if (q.name === "label_download_type") query[q.name] = "url";
  }
  const body = ((): unknown => {
    switch (op.id) {
      case "rates.calculate": return { shipment_id: s.shipment_id, rate_options: { carrier_ids: ctx.carrierIds ?? [] } };
      case "label.buyForShipment": case "label.buyFromRate": case "label.return": return { ...LABEL_FILE };
      case "shipment.hold": return { hold_until_date: tomorrow(ctx.today) };
      case "shipments.holdMany": return { shipment_ids: s.shipment_id ? [s.shipment_id] : [], hold_until_date: tomorrow(ctx.today) };
      case "shipments.restoreMany": return { shipment_ids: s.shipment_id ? [s.shipment_id] : [] };
      case "shipment.update": return Object.fromEntries(Object.entries(s).filter(([key]) => !READ_ONLY.includes(key)));
      case "shipment.notes": return { note: "", mode: "append" };
      case "fulfillment.create": return { fulfillments: [{ shipment_id: s.shipment_id, tracking_number: "", carrier_code: l?.carrier_code ?? "ups", notify_customer: false, notify_order_source: false }] };
      case "shipment.assignUser": return { shipment_ids: [s.shipment_id], user_id: "" };
      case "shipment.split": return { shipments: [{ items: [{ item_id: s.items?.[0]?.item_id ?? "", quantity: 1 }] }] };
      case "shipment.merge": return { shipment_ids: [] };
      case "shipment.documentRegister": case "label.documentRegister": return { type: "commercial_invoice", format: "PDF", file_name: "invoice.pdf" };
      case "tags.create": return { name: "", color: "" };
      default: return op.body && op.method !== "GET" ? {} : undefined;
    }
  })();
  return body === undefined ? { params, query } : { params, query, body };
}

/** Which records the action can change, so the page reads them again afterwards. */
export const changes = (op: Operation) => op.kind !== "read";
