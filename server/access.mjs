// Who may use this tool, and where it listens. With ACCESS_CODE set, every /api call but the sign-in needs the session
// cookie the sign-in sets; without it the tool is open, as on a developer's own machine. A server reachable from beyond
// this machine (a HOST other than the loopback, or a PUBLIC_ORIGIN) refuses to start without the code: the tool holds a
// ShipStation key, and an open door to it is a door to the account.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "ss_desk_session";
export const SESSION_HOURS = 12;
/** Wrong codes allowed in a minute, from everyone together: behind a proxy every client has the proxy's address. */
export const MAX_WRONG_PER_MINUTE = 10;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** `HOST`, `ACCESS_CODE` and `PUBLIC_ORIGIN`, from the shell first, then shipstation-e2e-ui/.env (`file`). */
export function loadDeploy({ env = process.env, file = {} } = {}) {
  const from = (name) => String(env[name] || file[name] || "").trim();
  const host = from("HOST") || "127.0.0.1";
  const accessCode = from("ACCESS_CODE") || null;
  const given = from("PUBLIC_ORIGIN");
  let publicOrigin = null;
  if (given) {
    let url = null;
    try { url = new URL(given); } catch { /* reported below */ }
    if (!url || !/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search || url.hash) {
      throw new Error(`PUBLIC_ORIGIN must be the address the tool is opened at, like https://desk.example.com — not "${given}"`);
    }
    publicOrigin = url.origin;
  }
  const exposed = !LOOPBACK.has(host) || (publicOrigin && !LOOPBACK.has(new URL(publicOrigin).hostname));
  if (exposed && !accessCode) {
    throw new Error(`${LOOPBACK.has(host) ? `PUBLIC_ORIGIN=${publicOrigin}` : `HOST=${host}`} reaches beyond this machine: set ACCESS_CODE (shell or shipstation-e2e-ui/.env), or keep HOST=127.0.0.1 with no PUBLIC_ORIGIN`);
  }
  return { host, accessCode, publicOrigin };
}

function cookieValue(header, name) {
  for (const part of String(header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/** The code's check and the session cookie. The cookie is `expiry.signature`, signed with a key drawn from the code: it
 * lives through a restart and on every copy of the server, and a new code ends every session. */
export function createAccess({ code, now = () => Date.now(), secure = false }) {
  const digest = (text) => createHash("sha256").update(String(text)).digest();
  const expected = digest(code);
  const key = digest(`shipstation-e2e-ui session\0${code}`);
  const sign = (expiry) => createHmac("sha256", key).update(String(expiry)).digest("base64url");
  const attrs = `Path=/; HttpOnly; SameSite=Strict`;
  const wrong = [];

  return {
    /** "ok", "wrong", or "wait" once too many wrong codes came in the last minute (the right one waits too). */
    check(given) {
      const t = now();
      while (wrong.length && wrong[0] <= t - 60_000) wrong.shift();
      if (wrong.length >= MAX_WRONG_PER_MINUTE) return "wait";
      if (typeof given === "string" && timingSafeEqual(digest(given), expected)) return "ok";
      wrong.push(t);
      return "wrong";
    },
    cookie() {
      const expiry = now() + SESSION_HOURS * 3_600_000;
      return `${SESSION_COOKIE}=${expiry}.${sign(expiry)}; ${attrs}; Max-Age=${SESSION_HOURS * 3600}${secure ? "; Secure" : ""}`;
    },
    clear: () => `${SESSION_COOKIE}=; ${attrs}; Max-Age=0${secure ? "; Secure" : ""}`,
    /** Whether the request's Cookie header carries a session this code signed, not yet expired. */
    signedIn(cookieHeader) {
      const value = cookieValue(cookieHeader, SESSION_COOKIE);
      const match = value && /^(\d{1,15})\.([\w-]{43})$/.exec(value);
      if (!match) return false;
      const good = Buffer.from(sign(match[1]));
      return timingSafeEqual(good, Buffer.from(match[2])) && Number(match[1]) > now();
    },
  };
}
