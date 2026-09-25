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
| Website (Astro 7, Tailwind 4) | `src/` | **Live on www.kedservice.com** (nameservers moved to Cloudflare 2026-09-24, `KED_NOINDEX` removed). Also on `ked-detailing.pages.dev` and `brettboggs.dev/ked/` |
| Instant quote + booking calendar | `src/pages/quote.astro`, `src/scripts/booking.ts` | Built and live on staging, hidden. **Placeholder prices and booking rules** until Jacob answers |
| Pricing engine | `packages/pricing` | Pure TS. The site, API and app all use it |
| Scheduling (slots, rules, time zones) | `packages/scheduling` | Pure TS |
| Books (ledger, bank files, rules, reports) | `packages/books` | Pure TS |
| API (Cloudflare Worker, Hono, D1, KV) | `api/` | Deployed at `https://ked-api.ked-api.workers.dev`. Migrations through 0017 |
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
- **Customer booking links:** every job has a private link
  (`/booking/?b=<token>`, `src/pages/booking.astro`) where the customer can
  see it, move it (same calendar as /quote, `src/scripts/slot-picker.ts`) or
  cancel, until the booking notice window. Jacob gets a push for each change.
  /quote shows the link after booking, and `POST /jobs/:id/confirmation`
  gives Jacob a text to send with it. `MANAGE_URL` also switches to
  kedservice.com at cutover.
- **Cutover importer:** `packages/import`. It reads Housecall Pro's
  customer and job CSVs and QuickBooks' Journal report (Excel saved as CSV),
  shows what it understood, and only writes with `--go`. Upcoming HCP jobs
  land on the calendar. Past ones come in as `history`, which never asks for
  payment or mileage. QuickBooks accounts are matched to ours through a
  `<file>.map.json` it writes with guesses. Everything is keyed to its
  source, so re-running is safe. Written against the files' likely shape:
  **check the preview on Jacob's real exports first.** It needs `KED_TOKEN`:
  set the Worker's `ADMIN_TOKEN` secret for the day, and delete it after.
- **Web admin:** `kedservice.com/admin` (`src/pages/admin.astro`,
  `src/scripts/admin/`, one file per tab over `core.ts`). Jacob's main tool
  for running the business: **Calendar** (week view, jobs, new job by phone,
  time off), **Customers**, quote requests, **Invoices** (send, record
  payments, void), **Books** (weekly to-do, bank files, entries, reports),
  **Inventory** (barcodes, stock, package usage), a prices editor with a
  live preview of what customers see, hours, and **Website**
  (`src/scripts/admin/website*.ts`): Jacob changes the site's words (top of
  the page, about, each package's name, text and what's included, also
  available, reviews, questions, contact, service area, scrolling names) and
  photos (each package's, and the recent-work row). Saved in D1 as only what
  differs from `src/data/site.ts` (`PUT /v1/site`, validated in
  `api/src/site.ts`), then the site rebuilds. The build reads `GET /v1/site`
  in `src/lib/live-site.ts` and merges it field by field
  (`src/lib/site-content.ts`), falling back to the built-in value for
  anything missing or bad. Uploaded photos (KV, `site/<id>`) are downloaded
  at build and written out as resized WebP at `/site-photos/<id>-<w>.webp`
  (`src/pages/site-photos/[file].ts`, rendered by `SitePhoto.astro`); built-in
  photos still go through astro:assets. Prices stay on the Prices tab. Sign-in is a one-time link
  emailed to an address in `OWNER_EMAILS` (`POST /v1/auth/email`, then
  `/verify`). Sends go through Email Routing, so each owner address must be
  a verified destination in Cloudflare → Email → Destination addresses.
- **CRM** (live 2026-09-25; plan and ownership in `docs/crm.md`): Today
  (daily follow-ups: reviews, reminders, rebooks, win-backs, quote chases),
  Customers (profiles, timeline, tags, referral links, merge), Insights
  (every metric with a ranked next step, and a Monday note built from the
  numbers by fixed rules; Brett isn't spending AI credits on this project, so
  leave `ANTHROPIC_API_KEY` unset) and Marketing (campaigns, tracking links and QR
  codes, referrals, reviews, lead playbook). Customer email goes through
  Resend (`RESEND_API_KEY` set, kedservice.com verified; DMARC `p=none` added 2026-09-25). Crons: daily 14:00 UTC, Monday 13:00 UTC, hourly :30 for
  campaign batches. Migrations through 0016 are applied.
- **Branding** (2026-09-25): every customer email is branded automatically.
  Senders write plain text; `sendEmail` (`api/src/crm-email.ts`) lays it into
  the HTML layout in `api/src/email-html.ts` (logo on black, gold rule,
  business details, unsubscribe line for marketing) and turns the first link
  to a customer page (pay, approve, booking, quote) into a gold button. The
  business's details live in `api/src/brand.ts`; phone, email and social links
  follow the site document Jacob edits. The logo is `public/email/logo.png`.
  Paying an invoice in full emails a receipt (only if it was sent). The
  invoice page prints, or saves as a PDF, as a letterhead invoice.
- **Add-ons found at the car** (2026-09-25): on a job, Jacob offers a fix
  from his price list or his own ("pet hair, $40") with a note and a photo,
  then texts the customer a link (`/approve/?a=<token>`,
  `src/pages/approve.astro`) where they tap yes or no. A yes goes on the job's
  price and invoice by itself (`api/src/extras.ts`, migration 0017). He can
  also mark an answer given in person. Admin: the job screen's "Add-ons found
  at the car" block (`src/scripts/admin/calendar-extras.ts`).
- **Drive time** (2026-09-25): jobs are spaced by the estimated drive
  between them plus pack-up time, not a flat hour. Estimates come from ZIP
  code centers (`packages/scheduling/src/travel.ts`, table generated by
  `tools/zips.py` from the Census Gazetteer; no maps service, $0) and err
  long. Online booking only offers reachable times and marks days Jacob is
  already nearby. The admin calendar draws each drive, flags tight gaps and
  totals the week's driving; Jacob's own bookings warn when the drive won't
  fit. Settings on the Hours page (`rules.travel`); rules saved before it
  existed have it off.
- **Other detailers, later:** not now, by Brett's choice. Every
  single-business assumption is tagged `TENANT:` in the code, and
  `docs/multi-tenant.md` has the plan and the rules to follow meanwhile.
- **Online booking is live** (`quoteLive = true`, 2026-09-25). Jacob still
  needs to save real prices and hours; until then customers see the samples.
- **Deploy from a clean copy** while agents are editing the tree:
  `git worktree add /tmp/ked-deploy HEAD && cd /tmp/ked-deploy && npm ci`,
  then migrate and deploy from its `api/`.
- **Jacob's edits go live without git.** Everything he changes (prices,
  hours, bookings) is saved in D1. Online booking reads it on every request.
  The pieces the site bakes in at build time (prices, and the hours line in
  the footer, intro and search listing via `GET /v1/hours`, and his website
  words and photos via `GET /v1/site`) are refreshed by a Pages rebuild that
  each pricing, hours or website save triggers through the
  `PAGES_DEPLOY_HOOK` secret. Only code changes need a commit and push.
- **Email:** Email Routing is on for kedservice.com. Alerts go from
  `alerts@kedservice.com` to `ALERT_EMAIL`, and verified destinations are
  Brett's Gmail, Jacob's Gmail and his Yahoo.
- **The cutover switch:** `quoteLive` in `src/data/site.ts`. On sends every
  Book button to /quote and makes /quote public. **Turn it on once Jacob's
  prices and hours are saved in the admin.**
- **Photos:** receipts and before/after job photos, stored in **KV**, not R2.
  R2 requires a credit card on the account, and Brett won't put his own card
  on Jacob's business. The storage interface prefers R2 if it's ever bound.

## How to work in this repo

- **Node 22 is required** (see `.nvmrc`). The shell defaults to 20. Start every
  command with `source ~/.nvm/nvm.sh && nvm use 22`, and include that in any
  command you hand to Brett.
- **Tests:** `npm test` at the root runs every workspace: pricing (16),
  scheduling (15), books (18) and API (121), import (6). The API tests
  (`api/test/run.sh`) start a real local Worker with a throwaway D1 and run
  serially (`--test-concurrency=1`), because the suites share one database.
  New API suites should use their own year or their own account
  (`POST /books/accounts`) so other suites' data can't interfere. `run.sh`
  needs `setsid`, which macOS lacks: put a shim on PATH that runs
  `perl -e 'setpgrp(0,0); exec @ARGV' -- "$@"`.
- **Type checks:** `npm run check -w @ked/api` for the API, and
  `npx astro check` or `npm run verify` for the site.
- **Free-plan query cap:** Cloudflare's docs say a free-plan request may make
  50 database queries, and every statement in a `batch` counts. Local dev
  doesn't enforce it, so the test Worker runs with `COUNT_QUERIES=1`, reports
  each response's count in `X-D1-Queries`, and `test/queries.test.ts` holds
  the heavy paths under 50. Bulk writes go through `json_each` in one
  statement (`entryStatements`, `markMatched`). Anything that loops over rows
  must do the same, and needs a case in that test.
- **npm bug:** installing `@cloudflare/vitest-pool-workers` crashes npm's
  resolver (`reading 'edgesOut'`). That's why the API tests are node:test
  against `wrangler dev`. Don't add vitest back.
- **Killing processes:** `pkill -f "wrangler dev --port 8787"` matches its own
  shell and kills it. Use `pkill -f "[w]rangler.*dev --port 8787"`.
- **Browser checks:** the site uses Lenis smooth scroll, so `scrollIntoView`
  and `window.scrollTo` don't move the page. Page scripts scroll by
  dispatching a cancelable `ked:scroll-to` event (see `motion.ts`). Scroll with the mouse-wheel
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
| Zone | `kedservice.com`, on Cloudflare since 2026-09-24. Registration is still at Squarespace (Jacob's account). Nameservers `georgia.ns.cloudflare.com`, `lou.ns.cloudflare.com` |
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
   `PAY_URL` and `MANAGE_URL` to kedservice.com. Push alerts already tell Jacob about
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
7. **His data:** Housecall Pro's customer and job exports (Customers or
   Jobs → Actions → Export) and QuickBooks' Journal report, all dates. Then:
   ```sh
   cd packages/import
   npm run import -- customers ~/hcp-customers.csv     # look first
   npm run import -- jobs ~/hcp-jobs.csv
   npm run import -- quickbooks ~/journal.csv          # writes journal.csv.map.json
   # fix any unmapped accounts in the .map.json, then repeat each with --go
   ```
   Import QuickBooks **before** the first bank statement here, so the bank
   lines match QuickBooks' entries instead of doubling them.

## What to build next (none of it needs Jacob)

1. Flip `quoteLive` once the prices and hours are in.

Deliberately **not** built: payroll. When Jacob hires, he uses a payroll
service (Gusto or similar), and its totals get recorded in the books.
Contractors and 1099s are covered.
