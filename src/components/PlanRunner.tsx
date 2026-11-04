import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Clock, Loader, Minus, Play, TriangleAlert, X } from "lucide-react";
import { api, describeError } from "../lib/api.ts";
import { toast } from "../lib/hooks.ts";
import { executePlan, type Step, type StepState } from "../lib/moves.ts";
import type { Operation } from "../lib/types.ts";

export interface Report { title: string; steps: Step[]; states: StepState[]; ok: boolean }

const ICON = {
  pending: <Clock size={14} />, running: <Loader size={14} className="spin" />, done: <Check size={14} />, failed: <X size={14} />, skipped: <Minus size={14} />,
} as const;

/** A plan as the person sees it before and while it runs: the ShipStation calls in order, one confirmation for all of
 * them, each step's state as it goes. It stops at the first step that fails or is refused. An `overridable` block can be
 * sent anyway, as an action of All actions can, to see what ShipStation answers. */
export function PlanRunner({ title, steps, kind, shipmentId, order, operations, production, blocked = null, overridable = false, runLabel = "Run", empty = "Nothing to run.", onReport }: {
  title: string; steps: Step[]; kind: "write" | "spend" | "danger"; shipmentId: string; order: string; operations: Operation[];
  production: boolean; blocked?: string | null; overridable?: boolean; runLabel?: string; empty?: string; onReport: (report: Report) => void;
}) {
  const qc = useQueryClient();
  const [states, setStates] = useState<StepState[] | null>(null);
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [anyway, setAnyway] = useState(false);
  const held = Boolean(blocked) && !(overridable && anyway);
  const route = (s: Step) => {
    const o = operations.find((x) => x.id === s.op);
    return o ? `${o.method} /v2${o.path.replace(/\{(\w+)\}/g, (_, name) => s.input.params[name] ?? `{${name}}`)}` : s.op;
  };

  const go = async () => {
    setConfirming(false);
    setRunning(true);
    let latest: StepState[] = steps.map(() => ({ status: "pending" }));
    setStates(latest);
    const outcome = await executePlan(steps, (op, input) => api.run(op, input), (i, state) => { latest = latest.map((x, j) => (j === i ? state : x)); setStates(latest); }, describeError);
    setRunning(false);
    // Whatever happened — and an unknown outcome most of all — the record is read again.
    void qc.invalidateQueries({ queryKey: ["record", shipmentId] });
    void qc.invalidateQueries({ queryKey: ["shipments"] });
    // ShipStation settles a fulfillment after it answers (no tracking number, pending_fulfillment, for a few seconds): read it again.
    if (steps.some((s) => s.op === "fulfillment.create")) setTimeout(() => { void qc.invalidateQueries({ queryKey: ["record", shipmentId] }); void qc.invalidateQueries({ queryKey: ["shipments"] }); }, 8000);
    if (outcome.ok) toast(`${title}: done.`);
    else toast(`${title}: stopped at step ${(outcome.failedAt ?? 0) + 1} — ${latest[outcome.failedAt ?? 0]?.message ?? "failed"}`, "error");
    onReport({ title, steps, states: latest, ok: outcome.ok });
  };

  const warning = production
    ? <strong style={{ color: "var(--destructive)" }}> PRODUCTION account: {kind === "spend" ? "buys a real label, charged to the account." : kind === "danger" ? "a real shipment, hard to undo." : "changes a real shipment."}</strong>
    : kind === "spend" ? " Buys a free test label." : kind === "danger" ? " Hard to undo." : "";
  const against = blocked && !held ? " Sent against the rule: ShipStation may refuse it." : "";

  return (
    <div className="stack" style={{ gap: 8 }}>
      {steps.length === 0 ? <p className="muted t-xs">{empty}</p> : (
        <ol className="plan" aria-label="Steps of the plan, in order — not choices">
          {steps.map((s, i) => {
            const st = states?.[i]?.status ?? "pending";
            return (
              <li key={`${s.op}-${i}`} className={`plan-${st}`}>
                <span className="state">{ICON[st]}</span>
                <span className="body"><span className="semibold">{i + 1}. {s.title}</span> <span className="route">{route(s)}</span>
                  {states?.[i]?.message && <div className="t-xs" style={{ color: "var(--destructive)" }}>{states[i]!.message}</div>}</span>
              </li>
            );
          })}
        </ol>
      )}
      {blocked && (overridable ? (
        <div className="callout tone-yellow accent-left row" style={{ alignItems: "flex-start" }}><TriangleAlert size={16} />
          <div><div>{blocked}.</div>
            <label className="row t-xs" style={{ marginTop: 6 }}><input type="checkbox" checked={anyway} onChange={(e) => setAnyway(e.target.checked)} /> Send it anyway, to see what ShipStation answers</label></div>
        </div>
      ) : <p className="t-xs" style={{ color: "var(--destructive)" }}>{blocked}</p>)}
      <div className="row" style={{ flexWrap: "wrap" }}>
        {confirming ? (
          <>
            <span className="t-sm">{title} on {order}?{warning}{against}</span>
            <button type="button" className={`btn ${kind === "danger" ? "btn-destructive-outline" : "btn-primary"}`} onClick={go}>Confirm</button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Back</button>
          </>
        ) : (
          <button type="button" className={`btn ${kind === "danger" ? "btn-destructive-outline" : "btn-primary"}`} disabled={running || steps.length === 0 || held} onClick={() => setConfirming(true)}>
            {running ? <Loader size={14} className="spin" /> : <Play size={14} />} {runLabel}</button>
        )}
        <span className="t-xs muted">{steps.length} ShipStation call{steps.length === 1 ? "" : "s"}, then 3 to read the shipment again</span>
      </div>
    </div>
  );
}
