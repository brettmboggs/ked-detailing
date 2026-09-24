# Handoff: KED ops platform

Start here in a new session. This covers where the work stands on 2026-09-24,
how it's built, how to ship it, and what's next. Read it with `CLAUDE.md`,
`NOTES.md` (the website's history) and `docs/mobile-app.md` (the app spec and
API contract, which is the source of truth for endpoints).

## The goal, in one paragraph

Jacob runs Knock Em' Down Auto & Marine Detailing on Housecall Pro (booking,
jobs) and QuickBooks (books). **We are replacing both.** The website takes
instant quotes and bookings, an iPhone app runs his day (schedule, jobs, money,
inventory), and one Cloudflare backend serves both. Ongoing cost should stay at
$0 apart from Stripe's per-payment fee. **Nothing customer-facing is switched
over until the whole system can replace Housecall Pro and QuickBooks at
once.** Until then, the header's "Book Now" still points at Housecall Pro, and
`/quote` stays hidden (noindex, out of the sitemap and the nav).

## Who's who

- **Brett** builds it. He's an experienced React/Expo developer and ships iOS
  apps himself, with a paid Apple developer account. Pitch at that level; don't
  explain basics.
- **Jacob** owns the business. He isn't technical and says he's "bad at keeping
  books". Anything he has to do must be written for a fifth grader
  (`docs/jacob-steps.md` is the model). He is the only user of the app.
- Brett runs every **deploy and push** himself. Claude Code's safety check
  blocks production deploys, so give him the exact command (below) and verify
  after. The exception is `npm run stage`: Brett pre-authorized it, so run it
  after every change that ships.

## What exists

| Piece | Where | State |
| --- | --- | --- |
| Website (Astro 7, Tailwind 4) | `src/` | Live on `ked-detailing.pages.dev` and `brettboggs.dev/ked/`. `kedservice.com` still points at Squarespace until Jacob switches nameservers |
| Instant quote + booking calendar | `src/pages/quote.astro`, `src/scripts/booking.ts` | Built and live on staging, hidden. **Placeholder prices and booking rules** until Jacob answers |
| Pricing engine | `packages/pricing` | Pure TS. The site, API and app all use it |
| Scheduling (slots, rules, time zones) | `packages/scheduling` | Pure TS |
| Books (ledger, bank files, rules, reports) | `packages/books` | Pure TS |
| API (Cloudflare Worker, Hono, D1, KV) | `api/` | Deployed at `https://ked-api.ked-api.workers.dev`. Migrations 0001–0008 applied |
| iPhone app (Expo) | private repo `brettmboggs/ked-app` | Built by a separate session on Brett's Mac from `docs/mobile-app.md`. Milestones 1–2 done (shell, Apple sign-in, Quote, Pricing editor, booking screens); Money tab (milestone 3) in progress |
| Staging refresh | `tools/stage.sh` (`npm run stage`) | Builds the staging site, commits it into `../brettboggs.dev/public/ked/` and pushes |

### Backend: what's built (all tested)

- **Auth:** Sign in with Apple, limited to an allowlist (`OWNER_EMAILS` /
  `OWNER_APPLE_SUBS` in `api/wrangler.jsonc`), plus an optional `ADMIN_TOKEN`
  secret (not set in production yet). `APPLE_AUDIENCE` is `com.brettboggs.ked`,
  which matches the app's bundle ID.
- **Pricing:** GET is public, PUT is validated and versioned. A save POSTs the
  Pages deploy hook (secret `PAGES_DEPLOY_HOOK`, set), so the site rebuilds
  with the new prices.
- **Leads** from the website, re-priced on the server.
- **Booking:** open slots, and bookings made with one conditional insert so
  two customers can't take the same time. Also jobs, customers (matched by
  phone), time off, and booking rules.
- **Books:** accounts (31 seeded, mapped to Schedule C lines), expenses,
  income, transfers, and void-by-reversal (entries are never edited or
  deleted). Payees and contractors with a 1099 report, the mileage log,
  profit and loss, balances, and CSV exports.
- **Bank import:** QFX/OFX/QBO and CSV, deduplicated by the bank's own
  transaction ID. Entries already in the books auto-match. **Learned rules**
  (by merchant) file future lines automatically. Otherwise there are
  suggestions: a deposit matching an unpaid job is offered as its payment, and
  common merchants get their usual category. "That was personal" records an
  owner draw. `/books/inbox` is the weekly check-in list.
- **Invoices:** one live invoice per job, built from its quote, numbered
  from 1001. Paid status is read from the books (the job's income entries,
  tips excluded), so every way of recording a payment settles it. Sending
  returns a text message with the pay link for the app's SMS composer, since
  email waits on the domain. The customer's page is `src/pages/pay.astro`
  (`/pay/?i=<token>`, noindex, no referrer). `PAY_URL` in `wrangler.jsonc`
  points at pages.dev and **must change to kedservice.com at cutover**.
  `startCheckout` and `recordInvoicePayment` in `api/src/invoices.ts` are where
  Stripe plugs in.
- **Inventory:** items with barcodes (UPC stored in its 13-digit form so
  either scan matches), counts that only change through logged movements, a
  low-stock list, each package's usual products, and product use per job
  (saved as differences, so it's safe to save twice). `productCost` on a job
  is the start of per-job profit.
- **Alerts:** push to Jacob's phones through Expo (free, works now) on an
  online booking, a quote request, and an invoice's first open. Every alert
  is stored in `alerts` first, so a failed push still shows in the app.
  Email is built in `src/notify.ts` but off: alerts to Jacob's own inbox
  are free once the domain is on Cloudflare (setup steps are in
  `wrangler.jsonc`). **Customer email needs Brett's call:** it needs the
  Workers Paid plan, $5/month, which breaks the $0 goal. Until then,
  customers get the on-page confirmation, and Jacob texts invoice links.
- **Photos:** receipts and before/after job photos, stored in **KV**, not R2.
  R2 requires a credit card on the account, and Brett won't put his own card
  on Jacob's business. The storage interface prefers R2 if it's ever bound.

## How to work in this repo

- **Node 22 is required** (see `.nvmrc`). The shell defaults to 20. Start every
  command with `source ~/.nvm/nvm.sh && nvm use 22`, and include that in any
  command you hand to Brett.
- **Tests:** `npm test` at the root runs every workspace: pricing (15),
  scheduling (11), books (18) and API (58). The API tests
  (`api/test/run.sh`) start a real local Worker with a throwaway D1 and run
  serially (`--test-concurrency=1`), because the suites share one database.
  New API suites should use their own year or their own account
  (`POST /books/accounts`) so other suites' data can't interfere.
- **Type checks:** `npm run check -w @ked/api` for the API, and
  `npx astro check` or `npm run verify` for the site.
- **npm bug:** installing `@cloudflare/vitest-pool-workers` crashes npm's
  resolver (`reading 'edgesOut'`). That's why the API tests are node:test
  against `wrangler dev`. Don't add vitest back.
- **Killing processes:** `pkill -f "wrangler dev --port 8787"` matches its own
  shell and kills it. Use `pkill -f "[w]rangler.*dev --port 8787"`.
- **Browser checks:** the site uses Lenis smooth scroll, so `scrollIntoView`
  and `window.scrollTo` don't move the page. Scroll with the mouse-wheel
  action, or read state through JavaScript.
- **Tailwind** only scans `src/` (`@import 'tailwindcss' source('..')` in
  `src/styles/global.css`), so words in `api/`, `docs/` and `packages/` can't
  leak into the site's CSS.
- **Design rules** for anything visual, on the site or in the app: the site's
  own look (ink/gold/bone tokens, Archivo + Inter, square 2px corners,
  hairline rules). **No pill chips, card grids, numbered "01/02" steps or other
  stock "AI" patterns.** Brett called these out.
- **Commits:** small and descriptive, with a why in the body, ending with the
  attribution lines from the session's system reminder. Commit when a piece
  is done and tested; Brett pushes.

## Shipping routine

```sh
# API: database changes, then deploy. Brett runs this.
source ~/.nvm/nvm.sh && nvm use 22 && cd /home/brett/dev/ked-detailing/api \
  && npx wrangler d1 migrations apply ked --remote && npx wrangler deploy

# Site and spec. Brett runs this. It triggers the Cloudflare Pages build.
cd /home/brett/dev/ked-detailing && git push

# Staging copy for Jacob. Claude runs this after anything that ships, unasked.
source ~/.nvm/nvm.sh && nvm use 22 && npm run stage
```

After a deploy, smoke-test read-only: public endpoints return 200, owner
endpoints return 401 without a token. Allow a few seconds for a new version to
spread; the first request can briefly 404. When the API contract changes,
update `docs/mobile-app.md` in the same commit and give Brett a one-line
message to paste to the Mac session ("Re-read docs/mobile-app.md … new: …").

### IDs and addresses

| What | Value |
| --- | --- |
| Cloudflare account | Knock Em Down Detailing, `c743385f5d44d1945d3696877c5286cb` (Brett's login; wrangler is authorized) |
| D1 database | `ked`, `2affc5fe-4049-4575-abfc-13193c95d52e` |
| KV namespace (photos) | `PHOTO_KV`, `ffcb3a9165a243488fafa424ec08fd39` |
| API | `https://ked-api.ked-api.workers.dev` |
| Pages project | `ked-detailing` (env vars `PUBLIC_KED_API_URL`, `KED_NOINDEX=true`) |
| Zone | `kedservice.com`, pending. Nameservers `georgia.ns.cloudflare.com`, `lou.ns.cloudflare.com` |
| App bundle ID | `com.brettboggs.ked` |
| Jacob's steps page | https://claude.ai/artifact/UKW361pRA3X3vfQDvgaGY4 (source: `docs/jacob-steps.md`; republish the page if the doc changes) |

## Waiting on Jacob

Brett is having a call with him. `docs/jacob-call.md` is Brett's checklist and
`docs/jacob-steps.md` is Jacob's. When the answers come back:

1. **Prices:** replace `packages/pricing/src/defaults.ts`, or better, `PUT
   /v1/pricing` once the Pricing editor is in his hands.
2. **Booking rules:** days and hours, jobs per day, time between jobs, notice,
   horizon, per-package durations (`PUT /v1/settings/booking`).
3. **His Apple ID email:** add it to `OWNER_EMAILS` and deploy.
4. **Domain switched:** remove `KED_NOINDEX` from Pages (GOING-LIVE.md step 4).
   Then switch on email (steps in `api/wrangler.jsonc`) and change
   `PAY_URL` to kedservice.com. Push alerts already tell Jacob about
   bookings, as long as the app has notifications on.
5. **Stripe:** once he adds Brett as a Developer, fill in Checkout behind the
   existing pay links (`startCheckout`, plus a webhook calling
   `recordInvoicePayment` with `depositToId: 'stripe'`, and `payOnline: true`),
   then Tap to Pay (Stripe Terminal in the app needs Apple's Tap to Pay
   entitlement; request it early). Payments should post into the books
   automatically.
6. **Bank:** Commerce Bank. **Teller doesn't support it** (checked against
   Teller's institution list). Plaid probably does, but is paid and custom
   quoted, and is optional. The default is Jacob downloading a QFX weekly or
   monthly and sharing it to the app.
7. **His data:** Housecall Pro customer export and QuickBooks general ledger,
   to import at cutover.

## What to build next (none of it needs Jacob)

1. **Customer self-service:** a link in the confirmation to view, reschedule
   or cancel a booking.
2. **Wire the website into the navigation** behind one switch (`quoteLive` in
   `src/data/site.ts`): header "Get a quote", "from $X" on the packages, the
   CTA. It stays off until cutover.
3. **Housecall Pro and QuickBooks importers** for the cutover.

Deliberately **not** built: payroll. When Jacob hires, he uses a payroll
service (Gusto or similar), and its totals get recorded in the books.
Contractors and 1099s are covered.
