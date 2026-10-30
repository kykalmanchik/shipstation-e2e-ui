import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, retryOnce } from "./api.ts";
import { currentView, subscribe } from "./url-state.ts";

/** The view, from the address: re-renders on Back, Forward and every `navigate`. */
export function useView() {
  return useSyncExternalStore(subscribe, currentView, currentView);
}

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: ({ signal }) => api.meta(signal), staleTime: Infinity, retry: retryOnce });
}

/** The account's carrier ids, for a rate request; read once per ten minutes at most. */
export function useCarrierIds(enabled: boolean) {
  return useQuery({
    queryKey: ["carriers"], enabled, staleTime: 10 * 60_000, retry: retryOnce,
    queryFn: async () => {
      const result = await api.run("carriers.list", { params: {}, query: {} });
      const carriers = (result.data as { carriers?: Array<{ carrier_id: string }> })?.carriers ?? [];
      return carriers.map((c) => c.carrier_id);
    },
  });
}

export interface Carrier { carrier_id: string; carrier_code?: string; friendly_name?: string; nickname?: string }
export interface CarrierService { service_code: string; name?: string }
export interface CarrierPackage { package_code: string; name?: string }

/** The account's carriers with their names, for the label purchase's dropdowns. */
export function useCarriers(enabled: boolean) {
  return useQuery({
    queryKey: ["carriers", "full"], enabled, staleTime: 10 * 60_000, retry: retryOnce,
    queryFn: async () => ((await api.run("carriers.list", { params: {}, query: {} })).data as { carriers?: Carrier[] })?.carriers ?? [],
  });
}
/** One carrier's services or package types (one call each, read once per ten minutes). */
export function useCarrierList<T>(kind: "services" | "packages", carrierId: string) {
  return useQuery({
    queryKey: ["carrier", kind, carrierId], enabled: Boolean(carrierId), staleTime: 10 * 60_000, retry: retryOnce,
    queryFn: async () => {
      const data = (await api.run(kind === "services" ? "carrier.services" : "carrier.packages", { params: { carrier_id: carrierId }, query: {} })).data as Record<string, T[]> | null;
      return data?.[kind] ?? [];
    },
  });
}

/** Whether a media query holds now, re-rendering when it changes. */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => { const m = matchMedia(query); m.addEventListener("change", onChange); return () => m.removeEventListener("change", onChange); },
    () => matchMedia(query).matches, () => false,
  );
}

/* ---------- toasts ---------- */

export interface Toast { id: number; text: string; kind: "ok" | "error" }
let toasts: Toast[] = [];
let nextId = 1;
const toastListeners = new Set<() => void>();
const emit = () => { for (const listener of toastListeners) listener(); };
export function toast(text: string, kind: Toast["kind"] = "ok") {
  const item = { id: nextId++, text, kind };
  toasts = [...toasts.slice(-3), item];
  emit();
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== item.id); emit(); }, kind === "error" ? 12_000 : 5_000);
}
export function dismissToast(id: number) { toasts = toasts.filter((t) => t.id !== id); emit(); }
export function useToasts() {
  return useSyncExternalStore((l) => { toastListeners.add(l); return () => { toastListeners.delete(l); }; }, () => toasts, () => toasts);
}

/* ---------- theme ---------- */

const THEME_KEY = "shipstation-e2e-ui:theme";
function storedTheme(): "light" | "dark" | null {
  try { const value = localStorage.getItem(THEME_KEY); return value === "light" || value === "dark" ? value : null; } catch { return null; }
}
/** The os theme class on <html>: the stored choice, else the system's. */
export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => storedTheme() ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  useEffect(() => { document.documentElement.classList.toggle("dark", theme === "dark"); }, [theme]);
  const toggle = () => setTheme((t) => {
    const next = t === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch { /* a private window keeps it for this tab only */ }
    return next;
  });
  return { theme, toggle };
}

/* ---------- a rate picked in Get rates, for Buy label from a rate ---------- */

const chosenRates = new Map<string, string>();
export const rateChoice = {
  set: (shipmentId: string, rateId: string) => { chosenRates.set(shipmentId, rateId); },
  get: (shipmentId: string) => chosenRates.get(shipmentId),
};
