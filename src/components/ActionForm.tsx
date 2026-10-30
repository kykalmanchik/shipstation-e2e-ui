import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader, Play, TriangleAlert } from "lucide-react";
import { ApiError, api, describeError } from "../lib/api.ts";
import { changes, draft, type Context } from "../lib/actions.ts";
import { orderOf } from "../lib/format.ts";
import { rateChoice, toast } from "../lib/hooks.ts";
import type { FieldSpec, Operation, OpInput, OpResult } from "../lib/types.ts";
import { navigate } from "../lib/url-state.ts";

const RUN_LABEL = { read: "Run", write: "Run", spend: "Buy", danger: "Run" } as const;

/** One action's request: its path parameters, query and body, prefilled from the record and editable, then the
 * answer. A change asks to be confirmed; an action not available now can still be sent, on purpose, to see what
 * ShipStation answers. */
export function ActionForm({ op, ctx, why, production = false }: { op: Operation; ctx: Context; why: string | null; production?: boolean }) {
  const qc = useQueryClient();
  // The draft is taken once, when the form opens: a record read again later must not wipe what was typed.
  const initial = useMemo<OpInput>(() => {
    const d = draft(op, ctx);
    if (op.id === "label.buyFromRate") d.params.rate_id = rateChoice.get(ctx.shipment.shipment_id) ?? "";
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fieldsSpec = op.body && op.body !== true && op.method !== "GET" ? op.body : null;
  const hasBody = Boolean(op.body) && op.method !== "GET";
  const [params, setParams] = useState(initial.params);
  const [query, setQuery] = useState(initial.query);
  const [body, setBody] = useState<Record<string, unknown>>((initial.body ?? {}) as Record<string, unknown>);
  const [jsonMode, setJsonMode] = useState(!fieldsSpec);
  const [jsonText, setJsonText] = useState(() => (initial.body === undefined ? "{}" : JSON.stringify(initial.body, null, 2)));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [anyway, setAnyway] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<OpResult | null>(null);

  // The account's carriers arrive after the form may have opened: a rate request still empty takes them.
  useEffect(() => {
    if (op.id !== "rates.calculate" || !ctx.carrierIds?.length || jsonError) return;
    const current = safeParse(jsonText);
    const ids = (current as { rate_options?: { carrier_ids?: string[] } })?.rate_options?.carrier_ids;
    if (current && Array.isArray(ids) && ids.length === 0) {
      const next = { ...(current as object), rate_options: { ...(current as { rate_options: object }).rate_options, carrier_ids: ctx.carrierIds } };
      setJsonText(JSON.stringify(next, null, 2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.carrierIds]);

  const currentBody = (): unknown => {
    if (!hasBody) return undefined;
    if (jsonMode) return safeParse(jsonText);
    return Object.fromEntries(Object.entries(body).filter(([key, value]) => value !== undefined && !(value === "" && !(key in (initial.body as object ?? {})))));
  };

  const mutation = useMutation({
    mutationFn: (input: OpInput) => api.run(op.id, input),
    onSuccess: (answer) => {
      setResult(answer);
      setConfirming(false);
      const refused = op.id === "label.void" && (answer.data as { approved?: boolean })?.approved === false;
      if (refused) toast(`${op.title}: refused — ${(answer.data as { message?: string })?.message ?? "no reason given"}`, "error");
      else toast(`${op.title}: done.$`);
      if (changes(op)) refresh();
    },
    onError: (error) => {
      setConfirming(false);
      toast(`${op.title} failed — ${describeError(error)}`, "error");
      if (error instanceof ApiError && error.outcome === "unknown") refresh();
    },
  });
  const refresh = () => {
    if (ctx.shipment.shipment_id) void qc.invalidateQueries({ queryKey: ["record", ctx.shipment.shipment_id] });
    void qc.invalidateQueries({ queryKey: ["shipments"] });
  };

  const send = () => {
    const payload = currentBody();
    if (hasBody && payload === undefined) { setJsonError("The body is not valid JSON"); return; }
    mutation.mutate({ params, query, ...(hasBody ? { body: payload } : {}) });
  };
  const blocked = mutation.isPending || (Boolean(why) && !anyway) || (jsonMode && Boolean(jsonError));
  const switchMode = () => {
    if (jsonMode) {
      const parsed = safeParse(jsonText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { setJsonError("Fix the JSON first: the fields show an object"); return; }
      setBody(parsed as Record<string, unknown>);
    } else setJsonText(JSON.stringify(currentBody() ?? {}, null, 2));
    setJsonError(null);
    setJsonMode((m) => !m);
  };

  return (
    <>
      {op.notes?.length ? <ul className="notes">{op.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
      {why && (
        <div className="callout tone-yellow accent-left row" style={{ alignItems: "flex-start" }}>
          <TriangleAlert size={16} />
          <div><div>Not available now: {why}.</div>
            {/* The server refuses a read-only account's writes whatever the page sends: no way around it here. */}
            {!(ctx.readOnly && op.kind !== "read") && (
              <label className="row t-xs" style={{ marginTop: 6 }}><input type="checkbox" checked={anyway} onChange={(e) => setAnyway(e.target.checked)} /> Send it anyway, to see what ShipStation answers</label>
            )}</div>
        </div>
      )}

      {(Object.keys(params).length > 0 || (op.query?.length ?? 0) > 0) && (
        <div className="grid">
          {Object.keys(params).map((name) => (
            <div className="field" key={`p-${name}`}>
              <label htmlFor={`${op.id}-p-${name}`}>{name} <span className="muted">· path</span></label>
              <input id={`${op.id}-p-${name}`} className="input mono" value={params[name] ?? ""} onChange={(e) => setParams((p) => ({ ...p, [name]: e.target.value }))} autoComplete="off" />
            </div>
          ))}
          {(op.query ?? []).map((q) => (
            <div className="field" key={`q-${q.name}`}>
              <label htmlFor={`${op.id}-q-${q.name}`}>{q.name} <span className="muted">· query</span></label>
              {q.enum ? (
                <select id={`${op.id}-q-${q.name}`} className="select" value={query[q.name] ?? ""} onChange={(e) => setQuery((v) => ({ ...v, [q.name]: e.target.value }))}>
                  <option value="">—</option>{q.enum.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : (
                <input id={`${op.id}-q-${q.name}`} className="input" value={query[q.name] ?? ""} placeholder={q.type === "date-time" ? "2026-10-22T00:00:00Z" : q.type === "integer" ? "number" : ""}
                  onChange={(e) => setQuery((v) => ({ ...v, [q.name]: e.target.value }))} autoComplete="off" />
              )}
            </div>
          ))}
        </div>
      )}

      {hasBody && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row-between row">
            <span className="t-xs muted">Body</span>
            {fieldsSpec && <button type="button" className="btn btn-ghost btn-xs" onClick={switchMode}>{jsonMode ? "Edit as fields" : "Edit as JSON"}</button>}
          </div>
          {jsonMode || !fieldsSpec ? (
            <>
              <textarea className="textarea code" spellCheck={false} value={jsonText} aria-label="Body JSON"
                onChange={(e) => { setJsonText(e.target.value); setJsonError(safeParse(e.target.value) === undefined ? "Not valid JSON yet" : null); }} />
              {jsonError && <span className="t-xs" style={{ color: "var(--destructive)" }}>{jsonError}</span>}
            </>
          ) : (
            <div className="grid">
              {Object.entries(fieldsSpec).map(([name, spec]) => (
                <BodyField key={name} id={`${op.id}-b-${name}`} name={name} spec={spec} value={body[name]} today={ctx.today}
                  onChange={(value) => setBody((b) => { const next = { ...b }; if (value === undefined) delete next[name]; else next[name] = value; return next; })} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="row" style={{ flexWrap: "wrap" }}>
        {confirming ? (
          <>
            <span className="t-sm">{op.title} on {orderOf(ctx.shipment) || "the account"}?{production
              ? <strong style={{ color: "var(--destructive)" }}> PRODUCTION account: {op.kind === "spend" ? "buys a real label, charged to the account." : op.kind === "danger" ? "a real shipment, hard to undo." : "changes a real shipment."}</strong>
              : op.kind === "spend" ? " Buys a free test label." : op.kind === "danger" ? " Hard to undo." : ""}</span>
            <button type="button" className={`btn ${op.kind === "danger" ? "btn-destructive-outline" : "btn-primary"}`} onClick={send} disabled={mutation.isPending}>
              {mutation.isPending ? <Loader size={14} className="spin" /> : null} Confirm</button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={mutation.isPending}>Back</button>
          </>
        ) : (
          <button type="button" className={`btn ${op.kind === "danger" ? "btn-destructive-outline" : op.kind === "read" ? "btn-outline" : "btn-primary"}`} disabled={blocked}
            onClick={() => (op.kind === "read" ? send() : setConfirming(true))}>
            {mutation.isPending ? <Loader size={14} className="spin" /> : <Play size={14} />} {RUN_LABEL[op.kind]}</button>
        )}
      </div>

      {mutation.isError && <ErrorView error={mutation.error} />}
      {result && <ResultView op={op} ctx={ctx} result={result} />}
    </>
  );
}

function BodyField({ id, name, spec, value, today, onChange }: { id: string; name: string; spec: FieldSpec; value: unknown; today?: string; onChange: (v: unknown) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{name}</label>
      {spec.enum ? (
        <select id={id} className="select" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">— leave out —</option>{spec.enum.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      ) : spec.type === "date" ? (
        <input id={id} className="input" type="date" min={today ? new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : undefined}
          value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || undefined)} />
      ) : spec.type === "array" ? (
        <input id={id} className="input mono" placeholder="se-1, se-2" value={Array.isArray(value) ? value.join(", ") : ""}
          onChange={(e) => onChange(e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} autoComplete="off" />
      ) : (
        <input id={id} className="input" value={typeof value === "string" ? value : value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
      )}
    </div>
  );
}

function ErrorView({ error }: { error: unknown }) {
  const e = error instanceof ApiError ? error : null;
  return (
    <div className="callout tone-red result">
      <div>{describeError(error)}</div>
      {e?.outcome === "unknown" && <div className="t-xs">The answer was lost, so nobody knows whether it applied: the record has been read again — check it before repeating.</div>}
      {e?.errors.length ? (
        <div className="scroll"><table className="tbl"><thead><tr><th>code</th><th>field</th><th>message</th></tr></thead>
          <tbody>{e.errors.map((x, i) => <tr key={i}><td className="mono">{x.code ?? "—"}</td><td className="mono">{x.field ?? "—"}</td><td>{x.message}</td></tr>)}</tbody></table></div>
      ) : null}
    </div>
  );
}

interface Rate { rate_id?: string | null; carrier_friendly_name?: string; carrier_code?: string; service_type?: string; service_code?: string;
  shipping_amount?: { amount: number; currency: string }; delivery_days?: number | null; error_messages?: string[] | null; validation_status?: string }

function ResultView({ op, ctx, result }: { op: Operation; ctx: Context; result: OpResult }) {
  const query = new URLSearchParams(result.query).toString();
  const data = result.data as Record<string, unknown> | null;
  const rates = op.id === "rates.calculate" ? (((data?.rate_response as { rates?: Rate[] })?.rates ?? (data?.rates as Rate[] | undefined)) ?? []) : null;
  const voided = op.id === "label.void" ? (data as { approved?: boolean; message?: string; reason_code?: string } | null) : null;
  return (
    <div className="result">
      <div className="route">answered · {result.method} {result.path}{query ? `?${query}` : ""}</div>
      {voided && (
        <div className={`callout ${voided.approved ? "tone-green" : "tone-red"}`}>{voided.approved ? "Void approved" : "Void refused"}{voided.message ? ` — ${voided.message}` : ""}{voided.reason_code ? ` (${voided.reason_code})` : ""}</div>
      )}
      {rates && (rates.length === 0 ? <p className="muted t-xs">No rates.</p> : (
        <div className="scroll"><table className="tbl">
          <thead><tr><th>Carrier</th><th>Service</th><th className="num">Price</th><th className="num">Days</th><th /></tr></thead>
          <tbody>{rates.map((r, i) => {
            const refused = !r.rate_id || r.validation_status === "invalid" || (r.error_messages?.length ?? 0) > 0;
            return (
              <tr key={r.rate_id ?? i}>
                <td>{r.carrier_friendly_name ?? r.carrier_code}</td>
                <td>{r.service_type ?? r.service_code}<div className="sub mono">{r.service_code}</div></td>
                <td className="num">{r.shipping_amount ? `${r.shipping_amount.amount.toFixed(2)} ${r.shipping_amount.currency.toUpperCase()}` : "—"}</td>
                <td className="num">{r.delivery_days ?? "—"}</td>
                <td>{refused ? <span className="t-xs muted">{r.error_messages?.join("; ") || "not purchasable"}</span> : (
                  <button type="button" className="btn btn-outline btn-xs" onClick={() => { rateChoice.set(ctx.shipment.shipment_id, r.rate_id!); navigate({ op: "label.buyFromRate" }); }}>Use this rate</button>
                )}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      ))}
      <details open={!rates}><summary className="t-xs muted">JSON</summary><pre className="json">{JSON.stringify(result.data, null, 2)}</pre></details>
    </div>
  );
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}
