import type { Context } from "../lib/actions.ts";
import type { Meta } from "../lib/types.ts";
import type { View } from "../lib/url-state.ts";
import { ActionList } from "./ActionList.tsx";

/** The account's own operations: lists across shipments, bulk hold and restore, tags, tracking by number, carriers. */
export function AccountTools({ view, meta }: { view: View; meta: Meta }) {
  const ctx: Context = { shipment: { shipment_id: "" }, labels: [], today: new Date().toISOString().slice(0, 10), readOnly: !meta.account.writes };
  return (
    <div className="page">
      <div className="page-head">
        <h1>Account tools</h1>
        <div className="sub">Operations that are not one shipment's. Each one is its ShipStation call, with every parameter the API takes.</div>
      </div>
      <div className="card"><ActionList ops={meta.operations.filter((op) => op.scope === "account")} ctx={ctx} view={view} keySuffix="" production={meta.account.environment === "production"} /></div>
    </div>
  );
}
