import { useState } from "react";
import { Check, TriangleAlert, X } from "lucide-react";
import { liveFulfillment, type Context } from "../lib/actions.ts";
import { orderOf } from "../lib/format.ts";
import {
  FULFILLMENT_CARRIERS, STAGE_LABEL, defaultCarrierCode, defaultTracking, holdDateError, moves, parseMove, plan, shipError, stageOf, tomorrow, type Stage,
} from "../lib/moves.ts";
import type { Operation } from "../lib/types.ts";
import { navigate } from "../lib/url-state.ts";
import { BuyLabel } from "./BuyLabel.tsx";
import { PlanRunner, type Report } from "./PlanRunner.tsx";

const TRACK = ["pending", "on_hold", "label_purchased", "shipped", "delivered"] as const;

/** The desk's own controls for one shipment: where it stands, a Move to list of the stages it can be taken to (with the
 * reason beside each it cannot), the ShipStation calls the move is, and the label purchase. The chosen stage lives in
 * the address (`move`), so a row's status list can open the shipment with its move already chosen. */
export function DeskCard({ ctx, move, operations, production }: { ctx: Context; move: string | null; operations: Operation[]; production: boolean }) {
  const [report, setReport] = useState<Report | null>(null);
  const [date, setDate] = useState<string | undefined>(undefined);
  const [tracking, setTracking] = useState<string | undefined>(undefined);
  const [carrier, setCarrier] = useState<string | undefined>(undefined);
  const s = ctx.shipment;
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);
  const here = stageOf(ctx);
  const list = moves(ctx);
  const target = parseMove(move);
  const chosen = target ? list.find((m) => m.id === target) : undefined;
  const runnable = chosen && !chosen.why ? chosen : undefined;
  const holdUntil = date ?? tomorrow(today);
  const dateError = runnable?.needs === "date" ? holdDateError(holdUntil, today) : null;
  const shipInput = { tracking: tracking ?? defaultTracking(ctx), carrierCode: carrier ?? defaultCarrierCode(ctx) };
  const shipProblem = runnable?.needs === "shipment" ? shipError(shipInput) : null;
  // ShipStation lists a fulfillment without its tracking number for a few seconds, and the shipment as pending_fulfillment.
  const settling = (ctx.fulfillments ?? []).some((f) => liveFulfillment(f) && !f.tracking_number);
  const common = { shipmentId: s.shipment_id, order: orderOf(s), operations, production };
  const steps = runnable && runnable.needs !== "purchase" ? plan(runnable.id as Stage, ctx, { holdUntil, ...shipInput }) : [];

  const choose = (value: string) => { setReport(null); navigate({ move: value || null }, { replace: true }); };
  const finished = (r: Report) => { setReport(r); if (r.ok) navigate({ move: null }, { replace: true }); };

  return (
    <div className="card desk">
      <div className="row-between row">
        <div className="card-title">Desk</div>
        <span className="t-xs muted">It stands at <strong>{STAGE_LABEL[here]}</strong>{here === "shipped" ? " (a fulfillment, no label)" : ""}</span>
      </div>

      <ol className="stepper" aria-label="Stages">
        {TRACK.map((id) => (
          <li key={id} className={`${here === id ? "here" : ""}${id === "delivered" ? " dim" : ""}`} title={id === "delivered" ? "The sandbox cannot reach this stage" : undefined}>{STAGE_LABEL[id]}</li>
        ))}
        <li className={`cancelled${here === "cancelled" ? " here" : ""}`}>{STAGE_LABEL.cancelled}</li>
      </ol>

      {settling && (
        <div className="callout tone-yellow accent-left row"><TriangleAlert size={16} />
          <div>ShipStation is still settling the fulfillment (no tracking number yet, status pending_fulfillment). Use Reload in a few seconds.</div></div>
      )}

      <div className="field desk-move">
        <label htmlFor="desk-move">Move to</label>
        <select id="desk-move" className="select" value={target ?? ""} onChange={(e) => choose(e.target.value)}>
          <option value="">Choose a stage…</option>
          {list.map((m) => <option key={m.id} value={m.id} disabled={Boolean(m.why) && m.id !== target}>{m.label}{m.short ? ` — ${m.short}` : ""}</option>)}
        </select>
      </div>

      {chosen?.why && <div className="callout tone-yellow accent-left row" style={{ alignItems: "flex-start" }}><TriangleAlert size={16} /><div>{chosen.label}: {chosen.why}.</div></div>}

      {runnable && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="t-xs muted">{runnable.hint}</div>
          {runnable.warn && <div className="callout tone-yellow accent-left row" style={{ alignItems: "flex-start" }}><TriangleAlert size={16} /><div>{runnable.warn}</div></div>}
          {runnable.needs === "date" && (
            <div className="field" style={{ maxWidth: 220 }}>
              <label htmlFor="desk-hold">Hold until (a date after today, UTC)</label>
              <input id="desk-hold" className="input" type="date" min={tomorrow(today)} value={holdUntil} onChange={(e) => setDate(e.target.value || undefined)} />
              {dateError && <span className="t-xs" style={{ color: "var(--destructive)" }}>{dateError}</span>}
            </div>
          )}
          {runnable.needs === "shipment" && (
            <div className="grid">
              <div className="field">
                <label htmlFor="desk-tracking">Tracking number</label>
                <input id="desk-tracking" className="input mono" value={shipInput.tracking} onChange={(e) => setTracking(e.target.value)} autoComplete="off" placeholder="1Z999AA10123456784" />
              </div>
              <div className="field">
                <label htmlFor="desk-carrier">Carrier</label>
                <select id="desk-carrier" className="select" value={shipInput.carrierCode} onChange={(e) => setCarrier(e.target.value)}>
                  {FULFILLMENT_CARRIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {shipProblem && <span className="t-xs" style={{ color: "var(--destructive)" }}>{shipProblem}</span>}
            </div>
          )}
          {runnable.needs === "purchase" ? (
            <BuyLabel ctx={ctx} {...common} prelude={plan("label_purchased", ctx)} onReport={finished} />
          ) : (
            <PlanRunner key={`${runnable.id}-${holdUntil}-${shipInput.tracking}-${shipInput.carrierCode}`} title={`Move to ${runnable.label}`} steps={steps}
              kind={steps.some((x) => x.op === "label.void" || x.op === "shipment.cancel") ? "danger" : "write"} blocked={dateError ?? shipProblem}
              runLabel={`Move to ${runnable.label}`} {...common} onReport={finished} />
          )}
        </div>
      )}

      {report && (
        <div className={`callout ${report.ok ? "tone-green" : "tone-red"}`}>
          <div className="row-between row">
            <strong>{report.ok ? <Check size={14} style={{ display: "inline" }} /> : <X size={14} style={{ display: "inline" }} />} {report.title}: {report.ok ? "done" : "stopped"}</strong>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setReport(null)}>Dismiss</button>
          </div>
          <ul className="t-xs">{report.steps.map((step, i) => <li key={i}>{i + 1}. {step.title} — {report.states[i]?.status}{report.states[i]?.message ? `: ${report.states[i]!.message}` : ""}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
