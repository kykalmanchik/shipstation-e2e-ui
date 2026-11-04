import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader, TriangleAlert } from "lucide-react";
import type { Context } from "../lib/actions.ts";
import { api, describeError } from "../lib/api.ts";
import { orderOf } from "../lib/format.ts";
import { useCarrierList, useCarriers, type CarrierPackage, type CarrierService } from "../lib/hooks.ts";
import {
  DHL_IMP_WARNING, DIMENSION_UNITS, LABEL_FORMATS, isDhlExpress, LABEL_LAYOUTS, STAMPS_WARNING, WEIGHT_UNITS, buyFromRateStep, buyOwnStep, buyable, isStamps, noSize, packageChanged, packageError, packageOf,
  packagePlan, purchasable, purchasePlan, rateRequest, rateText, ratesOf, type PackageEdit,
  type LabelFile, type Rate, type Step,
} from "../lib/moves.ts";
import type { Operation } from "../lib/types.ts";
import { PlanRunner, type Report } from "./PlanRunner.tsx";

/** The warehouse's label purchase: pick the carrier, its service and package type from the account's own lists, get the
 * rates, choose one and buy — or buy with the carrier and service the shipment already names. `prelude` is whatever must
 * run first (a held shipment is restored before a label can be bought). An edited package is saved by the purchase itself,
 * one plan and one confirmation; with "a rate I choose" it is saved first (`onSaved`, the move stays chosen), because the
 * rates are quoted for the package ShipStation holds. */
export function BuyLabel({ ctx, operations, production, prelude, onReport, onSaved }: {
  ctx: Context; operations: Operation[]; production: boolean; prelude: Step[]; onReport: (report: Report) => void; onSaved: (report: Report) => void;
}) {
  const s = ctx.shipment;
  const carriers = useCarriers(true);
  const own = Boolean(s.carrier_id && s.service_code);
  const [how, setHow] = useState<"own" | "rate">(own ? "own" : "rate");
  const [carrierId, setCarrierId] = useState("");
  const [serviceCode, setServiceCode] = useState("");
  const [packageCode, setPackageCode] = useState("");
  const [file, setFile] = useState<LabelFile>({ label_format: "pdf", label_layout: "4x6" });
  const [pkg, setPkg] = useState<PackageEdit | null>(null);
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [rateId, setRateId] = useState("");
  const services = useCarrierList<CarrierService>("services", carrierId);
  const packages = useCarrierList<CarrierPackage>("packages", carrierId);

  const carrierName = (c: { carrier_id: string; carrier_code?: string; friendly_name?: string; nickname?: string }) => c.friendly_name ?? c.nickname ?? c.carrier_code ?? c.carrier_id;
  const carrierIds = carrierId ? [carrierId] : (carriers.data?.map((c) => c.carrier_id) ?? ctx.carrierIds ?? []);
  const forget = () => { setRates(null); setRateId(""); };

  const quote = useMutation({
    mutationFn: () => api.run("rates.calculate", { params: {}, query: {}, body: rateRequest(s.shipment_id, carrierIds, serviceCode || undefined, packageCode || undefined) }),
    onSuccess: (answer) => { const all = ratesOf(answer.data); setRates(all); setRateId(buyable(all)[0]?.rate_id ?? ""); },
  });

  const list = rates ? buyable(rates) : [];
  const chosen = list.find((r) => r.rate_id === rateId);
  const ownCarrier = carriers.data?.find((c) => c.carrier_id === s.carrier_id);
  const dhl = how === "own" ? isDhlExpress(ownCarrier?.carrier_code ?? s.service_code) : isDhlExpress(chosen?.carrier_code);
  const stamps = how === "own" ? isStamps(ownCarrier?.carrier_code) : isStamps(chosen?.carrier_code);
  const edit = pkg ?? packageOf(s);
  const setEdit = (patch: Partial<PackageEdit>) => { setPkg({ ...edit, ...patch }); forget(); };
  const changed = packageChanged(s, edit);
  const editProblem = changed ? packageError(edit) : null;
  const steps = purchasePlan(s, prelude, edit, how === "own" ? buyOwnStep(s.shipment_id, file) : rateId ? buyFromRateStep(rateId, file) : null);
  // The edit stays as typed after a save: the record read again agrees with it, and nothing flashes back to the old size.
  const saveFirst = how === "rate" && changed;
  const SAVE_FIRST = "Save the package first — the rates are quoted for the package ShipStation holds.";

  return (
    <div className="stack" style={{ gap: 10 }}>
      {prelude.length > 0 && <div className="callout tone-yellow accent-left row"><TriangleAlert size={16} /><div>On hold: it is released first — a label cannot be bought on a held shipment.</div></div>}
      <div className="grid">
        <div className="field">
          <label htmlFor="buy-how">Buy with</label>
          <select id="buy-how" className="select" value={how} onChange={(e) => setHow(e.target.value as "own" | "rate")}>
            {own && <option value="own">The shipment's own carrier and service ({s.service_code})</option>}
            <option value="rate">A rate I choose</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="buy-format">Label format</label>
          <select id="buy-format" className="select" value={file.label_format} onChange={(e) => setFile((f) => ({ ...f, label_format: e.target.value }))}>
            {LABEL_FORMATS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="buy-layout">Layout</label>
          <select id="buy-layout" className="select" value={file.label_layout} onChange={(e) => setFile((f) => ({ ...f, label_layout: e.target.value }))}>
            {LABEL_LAYOUTS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="semibold t-sm">Package</div>
        {noSize(s) && <div className="callout tone-yellow accent-left row"><TriangleAlert size={16} /><div>The shipment has no package size (length, width, height): carriers refuse to sell a label without one. Set it below{how === "own" ? " — Buy label saves it on the shipment, then buys." : ", save it, then get the rates."}</div></div>}
        <div className="grid">
          {(["length", "width", "height"] as const).map((k) => (
            <div className="field" key={k}>
              <label htmlFor={`pkg-${k}`}>{k[0]!.toUpperCase() + k.slice(1)}</label>
              <input id={`pkg-${k}`} className="input" inputMode="decimal" value={edit[k]} placeholder="0" onChange={(e) => setEdit({ [k]: e.target.value })} autoComplete="off" />
            </div>
          ))}
          <div className="field">
            <label htmlFor="pkg-dim-unit">Size unit</label>
            <select id="pkg-dim-unit" className="select" value={edit.dimUnit} onChange={(e) => setEdit({ dimUnit: e.target.value })}>
              {DIMENSION_UNITS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pkg-weight">Weight</label>
            <input id="pkg-weight" className="input" inputMode="decimal" value={edit.weight} placeholder="0" onChange={(e) => setEdit({ weight: e.target.value })} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="pkg-weight-unit">Weight unit</label>
            <select id="pkg-weight-unit" className="select" value={edit.weightUnit} onChange={(e) => setEdit({ weightUnit: e.target.value })}>
              {WEIGHT_UNITS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
        {saveFirst && (
          <PlanRunner key={JSON.stringify(edit)} title="Save package" steps={packagePlan(s, prelude, edit)} kind="write" shipmentId={s.shipment_id} order={orderOf(s)} operations={operations} production={production}
            blocked={editProblem} runLabel="Save package" onReport={onSaved} />
        )}
      </div>

      {how === "rate" && (
        <>
          <div className="grid">
            <div className="field">
              <label htmlFor="buy-carrier">Carrier</label>
              <select id="buy-carrier" className="select" value={carrierId} disabled={carriers.isPending}
                onChange={(e) => { setCarrierId(e.target.value); setServiceCode(""); setPackageCode(""); forget(); }}>
                <option value="">All the account's carriers</option>
                {(carriers.data ?? []).map((c) => <option key={c.carrier_id} value={c.carrier_id}>{carrierName(c)}{c.carrier_code ? ` (${c.carrier_code})` : ""}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="buy-service">Service</label>
              <select id="buy-service" className="select" value={serviceCode} disabled={!carrierId || services.isPending}
                onChange={(e) => { setServiceCode(e.target.value); forget(); }}>
                <option value="">{carrierId ? "Any service" : "Choose a carrier first"}</option>
                {/* UPS lists some codes twice (domestic and international): the index keeps the keys unique. */}
                {(services.data ?? []).map((v, i) => <option key={`${v.service_code}-${i}`} value={v.service_code}>{v.name ?? v.service_code}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="buy-package">Package type</label>
              <select id="buy-package" className="select" value={packageCode} disabled={!carrierId || packages.isPending}
                onChange={(e) => { setPackageCode(e.target.value); forget(); }}>
                <option value="">{carrierId ? "The shipment's own package" : "Choose a carrier first"}</option>
                {(packages.data ?? []).map((v, i) => <option key={`${v.package_code}-${i}`} value={v.package_code}>{v.name ?? v.package_code}</option>)}
              </select>
            </div>
          </div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button type="button" className="btn btn-outline" disabled={quote.isPending || carrierIds.length === 0 || saveFirst} onClick={() => quote.mutate()}>
              {quote.isPending ? <Loader size={14} className="spin" /> : null} Get rates</button>
            <span className="t-xs muted">{saveFirst ? SAVE_FIRST : "1 call"}</span>
          </div>
          {quote.isError && <div className="callout tone-red">{describeError(quote.error)}</div>}
          {rates && (
            <div className="field">
              <label htmlFor="buy-rate">Rate ({list.length} to choose from)</label>
              {list.length === 0 ? <p className="muted t-xs">No rate can be bought.</p> : (
                <select id="buy-rate" className="select" value={rateId} onChange={(e) => setRateId(e.target.value)}>
                  {list.map((r) => <option key={r.rate_id!} value={r.rate_id!}>{rateText(r)}</option>)}
                </select>
              )}
              {rates.some((r) => !purchasable(r)) && (
                <details><summary className="t-xs muted">{rates.filter((r) => !purchasable(r)).length} not purchasable</summary>
                  <ul className="t-xs muted">{rates.filter((r) => !purchasable(r)).map((r, i) => <li key={i}>{rateText(r)} — {r.error_messages?.join("; ") || "no rate id"}</li>)}</ul></details>
              )}
            </div>
          )}
        </>
      )}

      {dhl && <div className="callout tone-yellow accent-left row"><TriangleAlert size={16} /><div>{DHL_IMP_WARNING}</div></div>}
      {stamps && <div className="callout tone-yellow accent-left row"><TriangleAlert size={16} /><div>{STAMPS_WARNING}</div></div>}

      <PlanRunner title="Buy label" steps={steps} kind="spend" shipmentId={s.shipment_id} order={orderOf(s)} operations={operations} production={production}
        blocked={saveFirst ? SAVE_FIRST : how === "rate" && !rateId ? "Get the rates and choose one first." : editProblem} runLabel="Buy label" onReport={onReport} />
    </div>
  );
}
