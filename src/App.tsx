import { useEffect, useRef, useSyncExternalStore } from "react";
import { accessStore, describeError } from "./lib/api.ts";
import { useMeta, useView } from "./lib/hooks.ts";
import { serializeView } from "./lib/url-state.ts";
import { Topbar } from "./components/Topbar.tsx";
import { ShipmentsPage } from "./components/ShipmentsPage.tsx";
import { AccountTools } from "./components/AccountTools.tsx";
import { Toasts } from "./components/Toasts.tsx";
import { SignIn } from "./components/SignIn.tsx";

export function App() {
  const view = useView();
  const meta = useMeta();
  const signedOut = useSyncExternalStore(accessStore.subscribe, accessStore.get, accessStore.get);

  useEffect(() => {
    if (signedOut) return;
    const where = view.tab === "account" ? "Account tools" : view.open ? `Shipment ${view.open}` : "Shipments";
    document.title = `${where} · ShipStation sandbox desk`;
  }, [view.tab, view.open, signedOut]);

  // The panel scrolls, not the window, so the browser restores nothing: a new list (tab, filters, page) starts at the
  // top; opening a row or an action keeps the place (the row scrolls itself into view).
  const main = useRef<HTMLElement>(null);
  const listKey = serializeView({ ...view, open: null, op: null, move: null });
  useEffect(() => { main.current?.scrollTo({ top: 0 }); }, [listKey]);

  if (signedOut) return <SignIn />;
  return (
    <div className={`main-col e2e-col${meta.data?.account.environment === "production" ? " env-production" : ""}`}>
      <Topbar view={view} account={meta.data?.account} accessRequired={meta.data?.access.required} />
      <main className="main" ref={main}>
        {meta.isError ? (
          <div className="callout tone-red">{describeError(meta.error)}</div>
        ) : !meta.data ? (
          <p className="muted">Loading…</p>
        ) : view.tab === "account" ? (
          <AccountTools view={view} meta={meta.data} />
        ) : (
          <ShipmentsPage view={view} meta={meta.data} />
        )}
      </main>
      <Toasts />
    </div>
  );
}
