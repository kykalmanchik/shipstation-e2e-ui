# shipstation-e2e-ui

A local stand-in for the ShipStation web UI, for end-to-end testing.

The ShipStation **sandbox** has no web UI (docs.shipstation.com/sandbox: "not available to ShipStation platform (web UI)
users"), so the shipments an integration files there can be seen only through the API. This app lists them and does what a
warehouse does in ShipStation: hold and release, buy and void labels, mark shipped, cancel, tags, notes, documents, split and
merge. A test that needs a shipment moved through its life can drive it from the browser instead of hand-written API calls.
It can also be pointed at a **production** account (read-only unless you say otherwise).

## Requirements

- Node **23.6 or newer** (the tests run TypeScript directly) and npm. `node --version` to check.
- A ShipStation API key: a sandbox `TEST_…` key, a production key, or both.

## First run

```bash
git clone https://github.com/kykalmanchik/shipstation-e2e-ui.git
cd shipstation-e2e-ui
npm install
cp .env.example .env        # then put your sandbox key in SHIPSTATION_SANDBOX_API_KEY
npm run dev
```

Open http://127.0.0.1:5190. The app refuses to start without a usable key for the chosen account, and says why.

## Choosing the account — `.env`

| Variable | What it does |
|---|---|
| `SHIPSTATION_ENV` | `sandbox` (default) or `production` — which account the app talks to |
| `SHIPSTATION_SANDBOX_API_KEY` | the sandbox key, must start with `TEST_` |
| `SHIPSTATION_PRODUCTION_API_KEY` | the live key, must **not** start with `TEST_` |
| `SHIPSTATION_PRODUCTION_WRITES` | `false` (default): production is **read-only** — the server refuses every change before ShipStation sees it. `true`: changes go through (real labels are charged) |
| `SHIPSTATION_RATE_LIMIT_PER_MINUTE` | how many calls a minute the app allows itself; empty → the documented limit: 20 sandbox, 200 production |
| `PORT` | empty → 5190 |
| `ACCESS_CODE` | empty (default): the desk is open, as on your own machine. Set: the page asks for this code first, and every `/api` call needs the session it earns (an HttpOnly cookie, 12 hours). See **Deploying it** |
| `HOST` | where the server listens: empty → `127.0.0.1`. Anything else (`0.0.0.0`, the Docker image's) is refused without `ACCESS_CODE` |
| `PUBLIC_ORIGIN` | the address the desk is opened at behind a proxy, e.g. `https://ss-desk.example.com`: its host and origin are let through the server's Host and Origin checks, and the session cookie is `Secure` when it is https. Refused without `ACCESS_CODE` unless it is a localhost address |

`.env` is git-ignored: keys never go into the repository.

**To switch accounts**, change `SHIPSTATION_ENV` (and the key it needs) and save:

- `npm run dev` restarts its server by itself when `.env` changes (`.env changed, restarting server...` in the terminal).
  Reload the browser tab; if a tab still open from the other account gets an answer from the new one, it reloads itself.
- `npm start` reads `.env` once — stop it (Ctrl-C) and start it again.

A variable set in the shell wins over the file, which is handy for one run:

```bash
SHIPSTATION_ENV=production npm run dev
```

…and a trap when you forget it: the terminal line at start says which account and where the key came from —
`shipstation-e2e-ui: ShipStation PRODUCTION (read-only), key from shipstation-e2e-ui/.env, 200 calls a minute`.

The app refuses to start when the chosen account has no key, when a sandbox key lacks `TEST_`, or when a `TEST_` key
is given as the production one.

### Production: what to keep in mind

- The page has a red rule across the top and a **PRODUCTION · read-only** (or **writes on**) badge.
- A production account holds real customers' names and addresses: no screenshots in tickets or chats.
- With writes on, **Buy label is charged to the account**, and Cancel, Void, Hold and Update change real shipments that
  other systems may be watching. Every change asks for a confirmation that names the account.
- Keys never reach the browser and are never logged; the server listens on 127.0.0.1 unless `HOST` says otherwise, and then
  only behind `ACCESS_CODE`.
  Never rename the variables with a `VITE_` prefix — Vite would copy them into the page.

## Running it

| Command | What it is |
|---|---|
| `npm run dev` | Vite + the API in one process on :5190, hot reload, restarts itself on `.env` changes |
| `npm run build` then `npm start` | the built app served by `server/serve.mjs` (no Vite), same port |
| `npm test` | 36 tests: the account loading, the rate limiter, retries, the operation allowlist, the access code, the page's rules, the desk's moves and plans — no network, no key needed |
| `docker build -t shipstation-e2e-ui .` | the image: tests and build inside, then `dist/` and `server/` on Node 24 (no npm packages at run time) — see **Deploying it** |
| `npm run typecheck` | TypeScript, no emit |

## Using it

- **Shipments** — the account's shipments, newest first. Search by your order number (the shipment number), by the external id
  or by a ShipStation id (`se-…`); the status pills and **More filters** cover every parameter of `GET /v2/shipments`.
- **Open a row** to see the shipment, its labels and fulfillments, and **every action** with whether it can run now —
  "available" or why not (a label is out, on hold, not linked to a sales order, read-only production…). Open an action
  for its form: path, query and body prefilled from the shipment, editable (body as fields or as JSON). An action that is
  not available can still be sent with **Send it anyway**, to see ShipStation's own refusal (not in read-only production).
- **Account tools** — operations that are not one shipment's: label and fulfillment lists, bulk hold and restore, tags,
  tracking by number, rates by id, carriers and their services, packages and options.
- **Back / Forward** walk the views: the filters, the page, the open row and the open action are all in the address,
  so a view can also be reloaded or shared as a link.
- The **meter** in the top bar shows ShipStation calls in the last minute. Past the limit the app queues calls instead
  of failing; a 429 from ShipStation is waited out (Retry-After) and a read retried once. A change is never resent: if
  its answer is lost the app says the outcome is unknown and reads the shipment again.

## The desk: moving a shipment between statuses

Open a row and the **Desk** card is at the top: where the shipment stands (Awaiting shipment → On hold → Label purchased →
Shipped, or Cancelled), a **Move to** list, and the ShipStation calls the move is. The row's own **Move to…** list does the same
from the table: it opens the shipment with that move chosen (`&move=` in the address), and the card asks for the confirmation.

| Move to | What it runs | Notes |
|---|---|---|
| Awaiting shipment | from On hold: Release the hold · from a label: Void each live label | a void ShipStation refuses (`approved: false`, answered 200) stops the plan and is reported as a failure |
| On hold | Hold until a date (a day after today, UTC) | a label out ends it: move to Awaiting shipment first |
| Label purchased | Release the hold if it is held, then the **Buy label** wizard | see below |
| Shipped | Release the hold or void the live label first, then **Mark shipped without a label**: a fulfillment with the tracking number and carrier you give (the label's own are the start) | a fulfillment beside a bought label is ambiguous (integrations that follow the label ignore it), which is why a label goes first. The shipment then reads **Shipped (a fulfillment, no label)**; ShipStation calls it `label_purchased` and sends `fulfillment_shipped_v2` after about 20 s. No call here undoes a fulfillment: only Cancelled is left |
| Cancelled | two buttons, each its own call and confirmation: **Void label** (each live label), then **Cancel order** | Cancel order waits while a label is live (ShipStation's docs: void first), unless you tick **Send it anyway** — for a label the sandbox will not void (USPS with no tracking number), to see what ShipStation answers; the void keeps the move chosen, so Cancel order is there once the shipment is read again. Cancelled is final in ShipStation: every other stage is then greyed |
| Delivered · Carrier problem | nothing | greyed with the reason: both come from the carrier's tracking, a fulfillment has no delivered field, and the sandbox gives no USPS tracking (`tracking_not_supported`) and only `UN` for UPS |

Each move shows its **plan** first (the calls, in order, with the real ids), one confirmation covers all of it (Cancelled is two operations, one confirmation each), each step shows
done / failed / skipped as it goes, and the plan **stops at the first step that fails**. A change is never resent; the shipment
is read again afterwards. A line under the move says what ShipStation does with it (the state it ends in, the webhook it sends).
A read-only production account can move nowhere.

**Buy label** — *Buy with* "the shipment's own carrier and service" (one call; only when the shipment names both) or "a rate I
choose": pick the **carrier**, then its **service** and **package type** (both read from the carrier: one call each), **Get rates**
(narrowed by service and package: `rate_options.service_codes` / `package_types`, docs.shipstation.com/rate-shopping), choose a
rate from the list (cheapest first, those ShipStation cannot sell are listed apart), and the label's format and layout. Weight and size
come from the shipment itself.

**A void the sandbox is likely to refuse is announced before the plan runs.** A USPS (`stamps_com`) label with no tracking number
(first-class flats, measured 2026-10-28: `validation_failed`, "mail-in refund requests") is refused, while labels with a tracking
number (UPS, USPS Ground Advantage, Media Mail) voided every time. Awaiting shipment, Shipped and Cancelled (its Void label) show the warning
for such a label; the plan can still be run and stops at its first step. Pick UPS when a test needs a void, a cancel or tracking.

The 52 single operations stay under **All actions** on the shipment, for anything the desk's moves do not name; the section opens by itself
when the address names one of its actions (`&op=…`). The grey clock beside a step is its state, not a choice: a plan is run whole.

## What the sandbox measured to do

Measured on a ShipStation sandbox (2026-10-27/29); the docs describe some of this differently, and the sandbox wins.

- `label_created_v2` arrives about 7 s after a label purchase and `fulfillment_shipped_v2` about 20 s after a fulfillment is created,
  both signed (`x-shipengine-rsa-sha256-*`). `track_event_v2` and `track` never arrived (5 minutes).
- A fulfillment is listed without its tracking number for a few seconds, with the shipment `pending_fulfillment`; then the shipment
  is `label_purchased` and the tracking number is there. The page says so and reads the shipment again by itself.
- `GET /labels/{id}/track`: USPS (`stamps_com`) answers 400 `tracking_not_supported`; a UPS label answers `UN`.
- Updating a shipment is not partial (send the whole shipment) and is silently ignored once a label is bought.

## Deploying it

The desk holds a ShipStation key, so a deployed one is always behind the access code: the server refuses to start reachable
from beyond its machine (`HOST` other than the loopback, or a `PUBLIC_ORIGIN`) without `ACCESS_CODE`.

```bash
docker build -t shipstation-e2e-ui .
docker run --env-file .env -e ACCESS_CODE=… -e PUBLIC_ORIGIN=https://ss-desk.example.com -p 5190:5190 shipstation-e2e-ui
```

- **The image** listens on `0.0.0.0:5190` (`HOST`, `PORT`), runs as `node`, and carries no `.env` (`.dockerignore`): the key,
  `SHIPSTATION_ENV` and the rest come from the environment (`--env-file`, the platform's secrets). Its health check and a
  balancer's go to **`/healthz`**, which answers `ok` whatever the Host and without a session. `SIGTERM` lets the answers
  under way finish.
- **TLS is the proxy's.** Put the desk behind one (nginx, an ALB…) that keeps the `Host` header, and set `PUBLIC_ORIGIN` to the
  address people open: the server answers only its own hosts (`127.0.0.1` / `localhost` on `PORT`, and that one) and takes
  writes only from its own page. Opened on another name it answers 421 `unknown host`; mapped to another port without
  `PUBLIC_ORIGIN` the same (`-p 8080:5190` needs `PUBLIC_ORIGIN=http://localhost:8080`).
- **The access code**: one code for everyone. The page shows a sign-in form; the code earns an HttpOnly, `SameSite=Strict`
  cookie for 12 hours (`Secure` when `PUBLIC_ORIGIN` is https), signed with a key drawn from the code, so it lives through a
  restart and on every copy of the server, and **a new code signs everyone out**. Ten wrong codes in a minute, from all clients
  together, make every sign-in wait the rest of that minute. **Sign out** (top bar) clears the cookie and what the page read.
  Use a long random code (`openssl rand -base64 18`): it is the only thing between the internet and the account.
- **Production with writes on** behind a public address is a live carrier account open to whoever has the code: prefer a
  sandbox deployment, or keep `SHIPSTATION_PRODUCTION_WRITES=false`.

## Troubleshooting

- **`port 5190 is taken`** — another `npm run dev` runs, or set `PORT=` in `.env`.
- **`HOST=… reaches beyond this machine: set ACCESS_CODE`** — a deployed desk needs the code (see **Deploying it**).
- **`421 unknown host` once deployed** — `PUBLIC_ORIGIN` is not the address you opened (or the proxy rewrites `Host`).
- **The sign-in comes back after a while** — the session lasts 12 hours, and a new `ACCESS_CODE` ends every session.
- **`refusing: … is not a TEST_ sandbox key` / `… is a TEST_ key`** — the key is in the wrong slot of `.env`.
- **`SHIPSTATION_ENV=sandbox but SHIPSTATION_SANDBOX_API_KEY is empty`** — put your sandbox key into `.env`.
- **`SHIPSTATION_ENV=production but SHIPSTATION_PRODUCTION_API_KEY is empty`** — add the key or switch back to `sandbox`.
- **Blank page after editing `.env`** — reload the tab (the dev server restarted under it).
- **429 / the meter is red** — wait a minute; the sandbox allows 20 calls a minute (opening a shipment costs 3).
- **`Label does not have a tracking number`** — a sandbox label without one cannot be tracked (Track stays off).

## Files

| Path | What it holds |
|---|---|
| `server/shipstation.mjs` | the account loading, the ShipStation client, the rate limiter and the retry rules |
| `server/operations.mjs` | the 52 operations the app can run — the server's allowlist and the page's menu |
| `server/handler.mjs` | `/api/*`: the list, a shipment's record, and one door that runs an operation by its id |
| `server/access.mjs` | `HOST`, `PUBLIC_ORIGIN` and `ACCESS_CODE`: the refusal to start open beyond the machine, the code's check, the session cookie |
| `server/boot.mjs`, `server/serve.mjs` | start-up (shared with Vite) and the built server (`/healthz`, `SIGTERM`) |
| `Dockerfile`, `.dockerignore` | the image (see **Deploying it**) |
| `src/lib/actions.ts` | what a shipment may do now, and each form's prefill |
| `src/lib/moves.ts` | the desk's stages, which moves are open and why not, each move's plan, the label purchase's requests, the plan runner |
| `src/lib/url-state.ts` | the view in the address (Back / Forward) |
| `src/components/*` | the page (`DeskCard`, `BuyLabel`, `PlanRunner` are the desk; `SignIn` the access code's form) |
| `src/styles/` | `tokens.css` (colours, type, themes), `components.css` (buttons, badges, tables, fields…), `app.css` (this page's own rules) |
