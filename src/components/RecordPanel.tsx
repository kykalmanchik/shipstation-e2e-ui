import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader, RefreshCw } from "lucide-react";
import { api, describeError, retryOnce } from "../lib/api.ts";
import type { Context } from "../lib/actions.ts";
import { day, money, orderOf, tone, when } from "../lib/format.ts";
import { useCarrierIds } from "../lib/hooks.ts";
import type { Label, Meta, Shipment } from "../lib/types.ts";
import type { View } from "../lib/url-state.ts";
import { ActionList } from "./ActionList.tsx";
import { DeskCard } from "./DeskCard.tsx";

/** One shipment opened: what it is, its labels, and every action of the catalogue with whether it can run now. */
export function RecordPanel({ shipmentId, view, meta }: { shipmentId: string; view: View; meta: Meta }) {
  const record = useQuery({ queryKey: ["record", shipmentId], queryFn: ({ signal }) => api.record(shipmentId, signal), staleTime: 15_000, retry: retryOnce });
  const carriers = useCarrierIds(record.isSuccess);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "nearest" }); }, [shipmentId]);
  // The shipment's own actions sit in All actions, which opens by itself when the address names one of them (a label's carry `@`).
  const namesShipmentAction = Boolean(view.op && !view.op.includes("@"));
  const [allOpen, setAllOpen] = useState(namesShipmentAction);
  useEffect(() => { if (namesShipmentAction) setAllOpen(true); }, [namesShipmentAction, view.op]);

  if (record.isPending) return <div className="record" ref={ref}><p className="muted">Reading the shipment…</p></div>;
  if (record.isError && !record.data) {
    return <div className="record" ref={ref}><div className="callout tone-red">{describeError(record.error)}
      <div style={{ marginTop: 8 }}><button className="btn btn-outline btn-sm" onClick={() => record.refetch()}>Try again</button></div></div></div>;
  }
  const { shipment: s, labels, fulfillments, fulfillmentsUnavailable } = record.data;
  const ctx: Context = { shipment: s, labels, fulfillments, carrierIds: carriers.data, today: new Date().toISOString().slice(0, 10), readOnly: !meta.account.writes };
  const shipmentOps = meta.operations.filter((op) => op.scope === "shipment");
  const labelOps = meta.operations.filter((op) => op.scope === "label");
  const production = meta.account.environment === "production";

  return (
    <div className="record" ref={ref}>
      <DeskCard ctx={ctx} move={view.move} operations={meta.operations} production={production} />
      <div className="stack">
        <div className="row-between row">
          <div className="row"><span className="t-h2">{orderOf(s)}</span><span className={`badge ${tone(s.shipment_status)}`}>{s.shipment_status}</span></div>
          <button className="btn btn-ghost btn-sm" onClick={() => record.refetch()} disabled={record.isFetching} title="Read it again (3 calls)">
            {record.isFetching ? <Loader size={14} className="spin" /> : <RefreshCw size={14} />} Reload</button>
        </div>
        {record.isError && <div className="callout tone-red">{describeError(record.error)} — showing what was read before.</div>}
        <Details s={s} />
        <section className="stack" style={{ gap: 8 }}>
          <div className="eyebrow">Labels ({labels.length})</div>
          {labels.length === 0 ? <p className="muted t-xs">None.</p> : labels.map((l) => (
            <LabelCard key={l.label_id} l={l}>
              <ActionList ops={labelOps} ctx={{ ...ctx, label: l }} view={view} keySuffix={`@${l.label_id}`} compact production={production} />
            </LabelCard>
          ))}
        </section>
        <section className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">Fulfillments ({fulfillments.length})</div>
          {fulfillmentsUnavailable && <p className="t-xs" style={{ color: "var(--destructive)" }}>{fulfillmentsUnavailable}</p>}
          {fulfillments.length === 0 ? <p className="muted t-xs">None.</p> : (
            <ul className="t-xs">{fulfillments.map((f, i) => (
              <li key={String(f.fulfillment_id ?? i)}><span className="mono">{String(f.fulfillment_id ?? "")}</span> · {String(f.tracking_number ?? "no tracking")} · {when(f.created_at as string)}{f.voided ? " · voided" : ""}</li>
            ))}</ul>
          )}
        </section>
        <details><summary className="t-xs muted">Raw JSON</summary><pre className="json">{JSON.stringify(record.data, null, 2)}</pre></details>
      </div>
      <div className="stack">
        <details open={allOpen} onToggle={(e) => setAllOpen(e.currentTarget.open)}><summary className="card-title">All actions</summary>
          <ActionList ops={shipmentOps} ctx={ctx} view={view} keySuffix="" production={production} /></details>
      </div>
    </div>
  );
}

function Details({ s }: { s: Shipment }) {
  const to = s.ship_to ?? {};
  const tags = (s.tags ?? []).map((t) => (typeof t === "string" ? t : t.name));
  return (
    <dl className="kv">
      <dt>Shipment</dt><dd className="mono">{s.shipment_id}</dd>
      <dt>External id</dt><dd className="mono">{s.external_shipment_id ?? "—"}</dd>
      <dt>Store</dt><dd className="mono">{String(s.store_id ?? "—")}</dd>
      <dt>Warehouse</dt><dd className="mono">{s.warehouse_id ?? "—"}</dd>
      <dt>Carrier / service</dt><dd>{s.carrier_id ?? "—"} · {s.service_code ?? "—"}</dd>
      <dt>Hold until</dt><dd>{day(s.hold_until_date) ?? "—"}</dd>
      <dt>Sales orders</dt><dd className="mono">{s.sales_order_ids?.join(", ") || "—"}</dd>
      <dt>Ship to</dt><dd>{[to.name, to.address_line1, to.address_line2, [to.city_locality, to.state_province, to.postal_code].filter(Boolean).join(", "), to.country_code].filter(Boolean).join(" · ") || "—"}
        {to.phone ? <div className="t-xs muted">☎ {to.phone}</div> : null}</dd>
      <dt>Packages</dt><dd>{(s.packages ?? []).map((p, i) => <div key={i}>{p.weight ? `${p.weight.value} ${p.weight.unit}` : "no weight"}{p.dimensions ? ` · ${p.dimensions.length}×${p.dimensions.width}×${p.dimensions.height} ${p.dimensions.unit}` : ""}{p.package_code ? ` · ${p.package_code}` : ""}</div>)}</dd>
      <dt>Items</dt><dd>{(s.items ?? []).map((it, i) => <div key={i}>{it.quantity ?? 1} × {it.name ?? it.sku ?? "item"} <span className="t-xs muted mono">{it.item_id ?? ""}</span></div>)}{!s.items?.length && "—"}</dd>
      <dt>Tags</dt><dd>{tags.length ? <span className="row" style={{ flexWrap: "wrap", gap: 4 }}>{tags.map((t) => <span key={t} className="badge b-xs tone-default">{t}</span>)}</span> : "—"}</dd>
      <dt>Internal notes</dt><dd style={{ whiteSpace: "pre-wrap" }}>{s.internal_notes || "—"}</dd>
      <dt>Created · modified</dt><dd className="t-xs">{when(s.created_at)} · {when(s.modified_at)}</dd>
    </dl>
  );
}

function LabelCard({ l, children }: { l: Label; children: ReactNode }) {
  const pdf = l.label_download?.pdf ?? l.label_download?.href;
  return (
    <div className="card card-sm">
      <div className="row-between row">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className="mono">{l.label_id}</span>
          <span className={`badge b-xs ${tone(l.voided ? "voided" : l.status)}`}>{l.voided ? "voided" : l.status}</span>
          {l.tracking_status && <span className="badge b-xs tone-blue">{l.tracking_status}</span>}
        </div>
        {pdf && /^https?:\/\//.test(pdf) && <a className="btn btn-outline btn-xs" href={pdf} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> PDF</a>}
      </div>
      <div className="t-xs muted">{l.carrier_code} {l.service_code} · tracking {l.tracking_number || "—"} · {money(l.shipment_cost)} · {when(l.created_at)}</div>
      {children}
    </div>
  );
}
