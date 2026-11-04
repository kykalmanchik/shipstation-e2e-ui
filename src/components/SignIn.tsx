import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader, LogIn } from "lucide-react";
import { ApiError, accessStore, api, describeError } from "../lib/api.ts";

/** The door the server's ACCESS_CODE puts in front of the desk: one field. The session it earns is the server's own
 * HttpOnly cookie; the page never holds the code once it is sent. */
export function SignIn() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { document.title = "Sign in · ShipStation desk"; }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.signIn(code);
      // Everything read before (or refused) is read again with the session; then the desk replaces this form.
      await qc.resetQueries();
      accessStore.set(false);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "access_code_wrong" ? "Wrong access code."
        : e instanceof ApiError && e.code === "access_code_wait" ? "Too many wrong codes — wait a minute and try again." : describeError(e));
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <form className="card signin-card" onSubmit={submit}>
        <div className="row"><div className="brand-mark" aria-hidden>SS</div><strong>ShipStation desk</strong></div>
        <p className="t-sm muted">This desk is behind an access code. Ask whoever runs it for the code.</p>
        {/* A password manager files a password under a user name: this desk has one code, so one fixed name. */}
        <input type="text" name="username" autoComplete="username" value="shipstation-desk" readOnly hidden />
        <div className="field">
          <label htmlFor="access-code">Access code</label>
          <input id="access-code" className="input" type="password" autoComplete="current-password" autoFocus value={code}
            onChange={(e) => { setCode(e.target.value); setError(null); }} />
        </div>
        {error && <div className="callout tone-red" role="alert">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={!code || busy}>
          {busy ? <Loader size={14} className="spin" /> : <LogIn size={14} />} Sign in</button>
      </form>
    </main>
  );
}
