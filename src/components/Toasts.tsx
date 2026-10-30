import { X } from "lucide-react";
import { dismissToast, useToasts } from "../lib/hooks.ts";

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.kind === "error" ? " error" : ""}`} role={t.kind === "error" ? "alert" : undefined}>
          <span>{t.text}</span>
          <button className="btn btn-ghost btn-icon-xs" onClick={() => dismissToast(t.id)} aria-label="Dismiss"><X size={12} /></button>
        </div>
      ))}
    </div>
  );
}
