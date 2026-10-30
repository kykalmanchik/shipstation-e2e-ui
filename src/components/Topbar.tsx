import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { meterStore } from "../lib/api.ts";
import { useTheme } from "../lib/hooks.ts";
import type { Account } from "../lib/types.ts";
import { navigate, type View } from "../lib/url-state.ts";

export function Topbar({ view, account }: { view: View; account?: Account }) {
  const production = account?.environment === "production";
  const meter = useSyncExternalStore(meterStore.subscribe, meterStore.get, meterStore.get);
  const { theme, toggle } = useTheme();
  const hot = meter.calls >= meter.limit * 0.75 || meter.queued > 0;
  return (
    <header className="topbar">
      <div className="brand-mark" aria-hidden>SS</div>
      <div>
        <div className="row">
          <strong className="t-sm">ShipStation {production ? "production" : "sandbox"} desk</strong>
          {production ? (
            <span className="badge tone-red b-xs" title={`Live ShipStation account, key from ${account?.keySource}. Writes ${account?.writes ? "are ON: labels are real and charged" : "are off (SHIPSTATION_PRODUCTION_WRITES)"}.`}>
              PRODUCTION · {account?.writes ? "writes on" : "read-only"}</span>
          ) : (
            <span className="badge tone-yellow b-xs" title={`Sandbox (TEST_ key, from ${account?.keySource ?? "…"}): free test labels, nothing real`}>Sandbox · TEST_ key</span>
          )}
        </div>
        <div className="t-xs muted tagline">api.shipstation.com/v2 · switch accounts in shipstation-e2e-ui/.env</div>
      </div>
      <nav className="tabs" aria-label="Sections">
        <button className={`tab${view.tab === "shipments" ? " active" : ""}`} aria-current={view.tab === "shipments" ? "page" : undefined}
          onClick={() => navigate({ tab: "shipments", op: null })}>Shipments</button>
        <button className={`tab${view.tab === "account" ? " active" : ""}`} aria-current={view.tab === "account" ? "page" : undefined}
          onClick={() => navigate({ tab: "account", open: null, op: null })}>Account tools</button>
      </nav>
      <div className="grow" />
      <span className={`meter${hot ? " hot" : ""}`} title={`ShipStation calls in the last minute — this account allows ${meter.limit}; past that this tool queues them`}>
        <span className="bar"><span style={{ width: `${Math.min(100, (meter.calls / meter.limit) * 100)}%` }} /></span>
        {meter.calls}/{meter.limit} a minute{meter.queued ? ` · ${meter.queued} waiting` : ""}
      </span>
      <button className="btn btn-ghost btn-icon-sm" onClick={toggle} aria-label={theme === "dark" ? "Light theme" : "Dark theme"} title={theme === "dark" ? "Light theme" : "Dark theme"}>
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </header>
  );
}
