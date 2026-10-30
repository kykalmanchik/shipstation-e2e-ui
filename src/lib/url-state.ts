// THE VIEW LIVES IN THE ADDRESS. Every filter, the page, the expanded row and the open action are query parameters,
// so Back and Forward walk the views exactly as they were seen, a reload lands on the same view, and a view can be
// shared as a link. Nothing on screen keeps a copy that could disagree with the address.

export type Tab = "shipments" | "account";

export interface View {
  tab: Tab;
  /** The list's filters: `q` (an order or a shipment id) and any `GET /v2/shipments` query parameter. */
  filters: Record<string, string>;
  page: number;
  pageSize: number;
  /** The expanded shipment. */
  open: string | null;
  /** The open action: an operation id, `id@label` for a label's (`label.void@se-1`). */
  op: string | null;
  /** The Desk card's chosen target stage (`pending`, `on_hold`, `label_purchased`, `shipped`, `cancelled`). */
  move: string | null;
}

export const PAGE_SIZES = [25, 50, 100] as const;
const RESERVED = new Set(["tab", "page", "page_size", "open", "op", "move"]);
const MOVES = new Set(["pending", "on_hold", "label_purchased", "shipped", "cancelled"]);
const SE_ID = /^se(-[a-z0-9]+)+$/;

export function parseView(search: string): View {
  const params = new URLSearchParams(search);
  const filters: Record<string, string> = {};
  for (const [key, value] of params) if (!RESERVED.has(key) && value.trim()) filters[key] = value;
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("page_size"));
  const open = params.get("open");
  const op = params.get("op");
  const move = params.get("move");
  return {
    tab: params.get("tab") === "account" ? "account" : "shipments",
    filters,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: (PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : 25,
    open: open && SE_ID.test(open) ? open : null,
    op: op && /^[a-zA-Z.]+(@se(-[a-z0-9]+)+)?$/.test(op) ? op : null,
    move: move && MOVES.has(move) ? move : null,
  };
}

/** The canonical query string of a view: defaults left out, filters in a stable order. */
export function serializeView(view: View): string {
  const params = new URLSearchParams();
  if (view.tab !== "shipments") params.set("tab", view.tab);
  for (const key of Object.keys(view.filters).sort()) {
    const value = view.filters[key];
    if (value && value.trim()) params.set(key, value.trim());
  }
  if (view.page > 1) params.set("page", String(view.page));
  if (view.pageSize !== 25) params.set("page_size", String(view.pageSize));
  if (view.open) params.set("open", view.open);
  if (view.op) params.set("op", view.op);
  if (view.move) params.set("move", view.move);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/* ---------- the address as a store ---------- */

const CHANGE = "shipstation-e2e-ui:navigate";
let cachedSearch: string | null = null;
let cachedView: View = parseView("");

export function currentView(): View {
  const search = typeof window === "undefined" ? "" : window.location.search;
  if (search !== cachedSearch) { cachedSearch = search; cachedView = parseView(search); }
  return cachedView;
}

export function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGE, onChange);
  return () => { window.removeEventListener("popstate", onChange); window.removeEventListener(CHANGE, onChange); };
}

/** A new history entry for a new view (Back returns to this one); `replace` for a correction of the same view. */
export function navigate(patch: Partial<View> | ((view: View) => Partial<View>), { replace = false } = {}): void {
  const view = currentView();
  const change = typeof patch === "function" ? patch(view) : patch;
  const next = { ...view, ...change };
  // A chosen move belongs to the shipment that is open: another row, or none, starts without one.
  if (next.open !== view.open && !("move" in change)) next.move = null;
  const search = serializeView(next);
  if (search === window.location.search) return;
  const url = `${window.location.pathname}${search}`;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(CHANGE));
}
