import { ChevronDown, ChevronRight } from "lucide-react";
import { unavailable, type Context } from "../lib/actions.ts";
import { KIND_TONE } from "../lib/format.ts";
import type { Operation } from "../lib/types.ts";
import { navigate, type View } from "../lib/url-state.ts";
import { ActionForm } from "./ActionForm.tsx";

/** The record's actions, grouped as the catalogue groups them: what can run now first in each group, what cannot with
 * the reason. Opening one is a history entry (`op` in the address), so Back closes it. */
export function ActionList({ ops, ctx, view, keySuffix, compact = false, production = false }: { ops: Operation[]; ctx: Context; view: View; keySuffix: string; compact?: boolean; production?: boolean }) {
  const verdicts = ops.map((op) => ({ op, why: unavailable(op, ctx) }));
  const available = verdicts.filter((v) => !v.why).length;
  // The desk's own actions first; the plain reads close the list.
  const groups = [...new Set(ops.map((op) => op.group))].sort((a, b) => Number(a === "Read") - Number(b === "Read"));

  return (
    <div className="actions">
      {!compact && <div className="row-between row"><div className="card-title">Actions</div><span className="t-xs muted">{available} of {ops.length} available now</span></div>}
      {groups.map((group) => {
        const items = verdicts.filter((v) => v.op.group === group).sort((a, b) => Number(Boolean(a.why)) - Number(Boolean(b.why)));
        return (
          <div className="action-group" key={group}>
            {!compact && <div className="eyebrow">{group}</div>}
            {items.map(({ op, why }) => {
              const key = `${op.id}${keySuffix}`;
              const open = view.op === key;
              return (
                <div key={key} className={`action${why ? " off" : ""}`}>
                  <button type="button" className="head" aria-expanded={open} onClick={() => navigate({ op: open ? null : key })}>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="name">
                      <span className="row" style={{ gap: 6 }}><span className="title">{op.title}</span><span className={`badge b-xs ${KIND_TONE[op.kind]}`}>{op.kind}</span></span>
                      <span className="route">{op.method} /v2{op.path}</span>
                    </span>
                    <span className="why">{why ?? "available"}</span>
                  </button>
                  {open && <div className="body"><ActionForm op={op} ctx={ctx} why={why} production={production} /></div>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
