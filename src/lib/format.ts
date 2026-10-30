import type { Shipment } from "./types.ts";

export const when = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};
export const day = (value?: string | null) => (value ? value.slice(0, 10) : null);
export const money = (m?: { amount: number; currency: string } | null) =>
  m && typeof m.amount === "number" ? `${m.amount.toFixed(2)} ${String(m.currency ?? "").toUpperCase()}` : "—";
export const orderOf = (s: Shipment) => s.shipment_number || s.external_shipment_id || s.shipment_id;

/** The os badge tone of a status. */
export function tone(status?: string | null): string {
  switch (status) {
    case "label_purchased": case "completed": case "delivered": return "tone-green";
    case "on_hold": case "awaiting_payment": return "tone-yellow";
    case "cancelled": case "voided": case "error": return "tone-red";
    case "processing": case "in_transit": return "tone-blue";
    case "pending_fulfillment": return "tone-purple";
    default: return "tone-default";
  }
}

export const KIND_TONE = { read: "tone-default", write: "tone-blue", spend: "tone-orange", danger: "tone-red" } as const;
