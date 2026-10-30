import { useState, type FormEvent } from "react";
import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import type { QuerySpec } from "../lib/types.ts";
import { navigate, type View } from "../lib/url-state.ts";

const MAIN = new Set(["shipment_status", "store_id", "page", "page_size"]);
const LABELS: Record<string, string> = {
  shipment_number: "Shipment number", external_shipment_id: "External shipment id", ship_to_name: "Ship to name",
  item_keyword: "Item keyword (SKU, description)", sales_order_id: "Sales order id", batch_id: "Batch id", tag: "Tag",
  created_at_start: "Created from", created_at_end: "Created to", modified_at_start: "Modified from", modified_at_end: "Modified to",
  payment_date_start: "Paid from", payment_date_end: "Paid to", sort_by: "Sort by", sort_dir: "Order",
};

/** An ISO instant as a `datetime-local` value, in this browser's zone; anything else as it is. */
const toLocal = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (value: string) => (value ? new Date(value).toISOString() : "");

/** The list's filters — every query parameter of GET /v2/shipments. A draft until Search: the address changes then,
 * once, so Back returns to the filters that were applied, not to each keystroke. Remounted (by its key) when the
 * address changes, so Back also puts the boxes back. */
export function Filters({ view, query, statuses }: { view: View; query: QuerySpec[]; statuses: string[] }) {
  const [draft, setDraft] = useState<Record<string, string>>(view.filters);
  const advanced = query.filter((q) => !MAIN.has(q.name));
  const advancedSet = advanced.filter((q) => view.filters[q.name]).length;
  const [more, setMore] = useState(advancedSet > 0);
  const set = (name: string, value: string) => setDraft((d) => ({ ...d, [name]: value }));
  const apply = (filters: Record<string, string>) => navigate({ filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v.trim())), page: 1, open: null, op: null });
  const submit = (event: FormEvent) => { event.preventDefault(); apply(draft); };
  const status = view.filters.shipment_status ?? "";

  return (
    <form className="card filters" onSubmit={submit} role="search">
      <div className="line">
        <input className="input search" value={draft.q ?? ""} onChange={(e) => set("q", e.target.value)} placeholder="Order (#10001), external id or shipment id (se-…)" aria-label="Search" autoComplete="off" />
        <input className="input" style={{ width: 150 }} value={draft.store_id ?? ""} onChange={(e) => set("store_id", e.target.value)} placeholder="Store id" aria-label="Store id" autoComplete="off" />
        <button type="submit" className="btn btn-primary"><Search size={14} /> Search</button>
        <button type="button" className={`btn btn-outline${advancedSet ? " btn-accent" : ""}`} onClick={() => setMore((m) => !m)} aria-expanded={more}>
          <SlidersHorizontal size={14} /> More filters{advancedSet ? ` (${advancedSet})` : ""}
        </button>
        {Object.keys(view.filters).length > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => apply({})}><RotateCcw size={14} /> Reset</button>
        )}
      </div>
      <div className="line" role="group" aria-label="Status">
        {["", ...statuses].map((s) => (
          <button key={s || "all"} type="button" className={`pill-filter${status === s ? " active" : ""}`} aria-pressed={status === s}
            onClick={() => apply({ ...view.filters, shipment_status: s })}>{s || "All statuses"}</button>
        ))}
      </div>
      {more && (
        <div className="more">
          {advanced.map((q) => (
            <div className="field" key={q.name}>
              <label htmlFor={`f-${q.name}`}>{LABELS[q.name] ?? q.name}</label>
              {q.enum ? (
                <select id={`f-${q.name}`} className="select" value={draft[q.name] ?? ""} onChange={(e) => set(q.name, e.target.value)}>
                  <option value="">Default</option>
                  {q.enum.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : q.type === "date-time" ? (
                <input id={`f-${q.name}`} className="input" type="datetime-local" value={toLocal(draft[q.name])} onChange={(e) => set(q.name, fromLocal(e.target.value))} />
              ) : (
                <input id={`f-${q.name}`} className="input" value={draft[q.name] ?? ""} onChange={(e) => set(q.name, e.target.value)} autoComplete="off" />
              )}
            </div>
          ))}
        </div>
      )}
    </form>
  );
}
