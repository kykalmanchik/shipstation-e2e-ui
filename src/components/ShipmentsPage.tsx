import { Fragment, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader, RefreshCw } from "lucide-react";
import { api, describeError, retryOnce } from "../lib/api.ts";
import { useMedia } from "../lib/hooks.ts";
import { day, orderOf, tone, when } from "../lib/format.ts";
import type { Meta, Shipment } from "../lib/types.ts";
import { PAGE_SIZES, navigate, serializeView, type View } from "../lib/url-state.ts";
import { Filters } from "./Filters.tsx";
import { RecordPanel } from "./RecordPanel.tsx";
import { moves } from "../lib/moves.ts";

type Column = "order" | "status" | "shipTo" | "service" | "store" | "created" | "modified";
const WIDE: Column[] = ["order", "status", "shipTo", "service", "store", "created", "modified"];
const NARROW: Column[] = ["order", "status", "shipTo", "created"];
const HEAD: Record<Column, [string, string?]> = {
  order: ["Order", "c-order"], status: ["Status", "c-status"], shipTo: ["Ship to"], service: ["Service"], store: ["Store"], created: ["Created"], modified: ["Modified"],
};

export function ShipmentsPage({ view, meta }: { view: View; meta: Meta }) {
  const list = useQuery({
    queryKey: ["shipments", view.filters, view.page, view.pageSize],
    queryFn: ({ signal }) => api.shipments({ ...view.filters, page: String(view.page), page_size: String(view.pageSize) }, signal),
    placeholderData: keepPreviousData, retry: retryOnce,
  });
  const shipments = list.data?.shipments ?? [];
  const pages = Math.max(1, Number(list.data?.pages) || 1);
  const openOutsideList = view.open && list.isSuccess && !shipments.some((s) => s.shipment_id === view.open);
  // Fewer columns on a narrow window — never hidden cells, which a fixed table still gives their share of the width.
  const columns = useMedia("(max-width: 1000px)") ? NARROW : WIDE;
  const span = columns.length + 1;

  return (
    <div className="page">
      <div className="page-head row-between row">
        <div>
          <h1>Shipments</h1>
          <div className="sub">The account's shipments. Open a row for everything it can do now.</div>
        </div>
        <button className="btn btn-outline" onClick={() => list.refetch()} disabled={list.isFetching} title="Read the page again">
          {list.isFetching ? <Loader size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>

      <Filters key={serializeView({ ...view, page: 1, open: null, op: null, move: null })} view={view} query={meta.shipmentListQuery} statuses={meta.statuses} />

      {openOutsideList && (
        <div className="card">
          <div className="row-between row"><div className="card-title">Opened from the address</div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate({ open: null, op: null })}>Close</button></div>
          <RecordPanel shipmentId={view.open!} view={view} meta={meta} />
        </div>
      )}

      <div className="tbl-wrap">
        <table className="tbl list">
          <thead>
            <tr><th className="chev" />{columns.map((c) => <th key={c} className={HEAD[c][1]}>{HEAD[c][0]}</th>)}</tr>
          </thead>
          <tbody>
            {list.isError && !list.data ? (
              <tr><td colSpan={span}><div className="callout tone-red">{describeError(list.error)}</div></td></tr>
            ) : list.isPending ? (
              Array.from({ length: 6 }, (_, i) => <tr key={i} className="skeleton-row">{Array.from({ length: span }, (__, j) => <td key={j}><span /></td>)}</tr>)
            ) : shipments.length === 0 ? (
              <tr><td colSpan={span} className="empty">No shipments match.</td></tr>
            ) : (
              shipments.map((s) => <Row key={s.shipment_id} s={s} view={view} meta={meta} columns={columns} />)
            )}
          </tbody>
        </table>
        {list.isError && list.data && <div className="callout tone-red" style={{ margin: 12 }}>{describeError(list.error)} — showing the last page read.</div>}
        <div className="pager">
          <span className="t-xs muted">
            {list.data?.searched === "order" ? `${list.data.total} found by order number and id` : `page ${view.page} of ${pages}${list.data?.total !== undefined ? ` · ${list.data.total} in all` : ""}`}
          </span>
          <div className="row">
            <select className="select select-xs" style={{ width: 90 }} value={view.pageSize} aria-label="Rows per page"
              onChange={(e) => navigate({ pageSize: Number(e.target.value), page: 1, open: null, op: null })}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} rows</option>)}
            </select>
            <button className="btn btn-outline btn-sm" disabled={view.page <= 1} onClick={() => navigate({ page: view.page - 1, open: null, op: null })}>‹ Newer</button>
            <button className="btn btn-outline btn-sm" disabled={view.page >= pages || list.data?.searched !== undefined} onClick={() => navigate({ page: view.page + 1, open: null, op: null })}>Older ›</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ s, view, meta, columns }: { s: Shipment; view: View; meta: Meta; columns: Column[] }) {
  const open = view.open === s.shipment_id;
  const toggle = () => navigate({ open: open ? null : s.shipment_id, op: null });
  const cell: Record<Column, () => ReactNode> = {
    order: () => <><div className="semibold" title={orderOf(s)}>{orderOf(s)}</div><div className="sub mono">{s.shipment_id}</div></>,
    status: () => <><span className={`badge b-xs ${tone(s.shipment_status)}`}>{s.shipment_status ?? "?"}</span>
      {s.hold_until_date && <div className="sub">hold until {day(s.hold_until_date)}</div>}
      <RowMove s={s} readOnly={!meta.account.writes} /></>,
    shipTo: () => <>{s.ship_to?.name ?? "—"}<div className="sub">{[s.ship_to?.city_locality, s.ship_to?.state_province].filter(Boolean).join(", ")}</div></>,
    service: () => <span className="sub">{s.service_code ?? "—"}</span>,
    store: () => <span className="sub mono">{String(s.store_id ?? "—")}</span>,
    created: () => <span className="sub">{when(s.created_at)}</span>,
    modified: () => <span className="sub">{when(s.modified_at)}</span>,
  };
  return (
    <Fragment>
      <tr className={`clickable${open ? " open" : ""}`} aria-expanded={open} tabIndex={0} onClick={toggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
        <td className="chev">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
        {columns.map((c) => <td key={c}>{cell[c]()}</td>)}
      </tr>
      {open && (
        <tr className="detail"><td colSpan={columns.length + 1}><RecordPanel shipmentId={s.shipment_id} view={view} meta={meta} /></td></tr>
      )}
    </Fragment>
  );
}

/** A status list in the row: choosing a stage opens the shipment with that move chosen, where the plan is shown and
 * confirmed. The row knows only the status, so its verdicts are a first look — the card, which has read the labels,
 * is the last word. */
function RowMove({ s, readOnly }: { s: Shipment; readOnly: boolean }) {
  const list = moves({ shipment: s, labels: [], readOnly });
  return (
    <select className="select select-xs row-move" value="" aria-label={`Move ${orderOf(s)} to`}
      onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => { if (e.target.value) navigate({ open: s.shipment_id, op: null, move: e.target.value }); }}>
      <option value="">Move to…</option>
      {list.map((m) => <option key={m.id} value={m.id} disabled={Boolean(m.why)}>{m.label}{m.short ? ` — ${m.short}` : ""}</option>)}
    </select>
  );
}
