# KED Ops — iPhone app spec

The brief for Jacob's iPhone app, which lives in its own repo. Point that repo's
`CLAUDE.md` / `AGENTS.md` here (snippet at the bottom). This file is the source of
truth for **what** the app does and **how it talks to everything else**. If the
app and this doc disagree, fix one of them in the same change.

Last updated: 2026-09-24 (booking calendar added).

---

## Why it exists

Jacob (Knock Em' Down Auto & Marine Detailing) runs his business on Housecall Pro.
The goal is to **replace Housecall Pro entirely**, not sit beside it. When this
app plus the website cover everything he uses there, he exports his data and
cancels it.

Jacob is the only user. He is on job sites all day, often with wet or gloved
hands, and is not technical. Every screen has to work one-handed, outdoors, in a
few taps.

He called it an "AI estimator". It is not AI. Quotes come from a tunable formula
(below) and no quote ever calls a language model. Don't add one.

## How the pieces fit

```
ked-detailing  (this repo, github.com/brettmboggs/ked-detailing)
├── packages/pricing     quote formula, shared: TypeScript, zero dependencies
├── packages/scheduling  booking rules + open-slot maths, shared, zero dependencies
├── api/                 Cloudflare Worker + D1: the one backend   ← partly built
└── src/               the website (Astro), incl. /quote

ked-app  (the mobile repo)
└── the Expo app. Owns UI only. No business rules of its own.
```

- **One backend.** The website and the app both talk to the same Worker. The app
  never talks to D1, Stripe's secret API or email directly.
- **One pricing formula.** It lives in `packages/pricing`. The app must never
  reimplement or "tweak" it locally. A quote in the app has to match the website
  to the cent.
- **Hosting cost target is $0.** Cloudflare free tier (Workers, D1, R2 for photos).
  The only running costs should be Stripe's per-payment fee and, optionally,
  about 1¢ per reminder text.

## The shared packages

### Getting them into the app

`@ked/pricing` and `@ked/scheduling` aren't published to a registry. The app
**vendors** them, pinned to a commit of this repo, with one sync script. Never
edit the vendored files. Change them here and re-sync.

Add `scripts/sync-shared.mjs` to the app repo. If you already added the older
`sync-pricing.mjs`, this replaces it.

```js
// Vendors packages/{pricing,scheduling}/src from ked-detailing at a pinned ref.
// Usage: node scripts/sync-shared.mjs [ref]   (default: main)
import { mkdir, rm, writeFile } from 'node:fs/promises';

const REPO = 'brettmboggs/ked-detailing';
const PACKAGES = ['pricing', 'scheduling'];
const ref = process.argv[2] ?? 'main';

const sha = (await (await fetch(`https://api.github.com/repos/${REPO}/commits/${ref}`)).json()).sha;
if (!sha) throw new Error(`Could not resolve ${ref}`);

for (const pkg of PACKAGES) {
  const out = new URL(`../src/vendor/${pkg}/`, import.meta.url);
  const listing = await (
    await fetch(`https://api.github.com/repos/${REPO}/contents/packages/${pkg}/src?ref=${sha}`)
  ).json();
  if (!Array.isArray(listing)) throw new Error(`No packages/${pkg} at ${sha}`);

  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const f of listing.filter((f) => f.type === 'file' && !f.name.endsWith('.test.ts'))) {
    const body = await (await fetch(f.download_url)).text();
    await writeFile(
      new URL(f.name, out),
      `// VENDORED from ${REPO}@${sha.slice(0, 7)} — do not edit. Run \`npm run sync:shared\`.\n${body}`,
    );
  }
  await writeFile(new URL('SOURCE', out), `${REPO}@${sha}\n`);
}
console.log(`${PACKAGES.join(' + ')} synced from ${sha.slice(0, 7)}`);
```

Then add `"sync:shared": "node scripts/sync-shared.mjs"` to its package.json,
commit `src/vendor/`, and import from `@/vendor/pricing` and
`@/vendor/scheduling` (or add path aliases). The source uses `.ts` import
specifiers, so the app's `tsconfig` needs `"allowImportingTsExtensions": true`
(with `noEmit`, which Expo already sets). Metro resolves them as-is.

Re-sync whenever either package changes here. The API reports the pricing
version it holds, so a stale vendored engine shows up quickly.

### Pricing: what it exposes

| Export | Use in the app |
| --- | --- |
| `quote(config, input)` | Price a job. Pure and synchronous, so it works offline. |
| `fromPrice(config, serviceId)` | "From $X" labels. |
| `applicableConditions` / `applicableAddOns` | Which questions and extras to show for a service. |
| `validateConfig(config)` | Run before saving the pricing editor. It returns plain-English errors, so show them as they are. |
| `formatMoney` / `formatRange` / `formatHours` | Display. Never format money by hand. |
| `defaultConfig` | Fallback only, used when the API can't be reached and nothing is cached. |
| Types: `PricingConfig`, `QuoteInput`, `Quote`, … | Everything else. |

The formula: package base × vehicle size multiplier (per foot for boats), plus
condition charges, extras and a travel fee by ZIP, then the minimum job, shown as
a range rounded to $5. Some cases are flagged for Jacob to see in person. All
money is **integer cents**.

### Scheduling: what it exposes

| Export | Use in the app |
| --- | --- |
| `BookingRules` | Jacob's booking settings: on/off, time zone, hours per weekday (Sunday first, `null` = closed), slot step, buffer between jobs, jobs per day, notice, how far ahead. |
| `validateRules(rules)` | Run before saving the booking-rules editor. Show its messages as they are. |
| `defaultRules` | Fallback only. |
| `jobMinutes(quote.hours, rules)` | How long a job holds the calendar: the high end of the quote, rounded up to the slot step. Show it on the job and when adding one. |
| `openSlots` / `slotProblem` | Only needed to preview availability offline. The API is the authority. |
| `zonedToUtc` / `localDate` / `addDays` / `weekday` | Time-zone-safe date maths using only Intl, which works on Hermes. Always show times in `rules.timezone` (America/Chicago), never in the phone's zone. |

## Backend API (contract v0)

> **Status:** the Worker lives in `api/` in this repo (Hono, D1 database `ked`).
> **Built and tested:** auth, pricing, leads, **online booking, jobs, customers,
> time off and booking rules**. Still to come: photos, invoices, Stripe and
> inventory. For endpoints that don't exist yet, the app uses a typed client
> with an in-memory mock, selected per endpoint or when `EXPO_PUBLIC_API_URL` is
> unset. When an endpoint lands, only the client's transport changes.
>
> The website reads prices **at build time** from `GET /v1/pricing`, using the
> Pages env var `PUBLIC_KED_API_URL`, and falls back to the defaults if the API
> is down. A pricing save POSTs the Pages deploy hook (Worker secret
> `PAGES_DEPLOY_HOOK`), so the site shows new prices about a minute after Jacob
> saves. `/quote` posts to `POST /v1/leads` when that env var is set.
>
> Sign-in allowlist: `OWNER_EMAILS` / `OWNER_APPLE_SUBS` in `api/wrangler.jsonc`.
> `APPLE_AUDIENCE` there must match the app's bundle ID. It's currently a
> placeholder, `com.brettboggs.ked`, so tell this repo the real one.

**Conventions**
- Base URL comes from `EXPO_PUBLIC_API_URL`: a `*.workers.dev` URL until
  kedservice.com's DNS moves to Cloudflare, then `https://api.kedservice.com`.
- JSON in and out. Money in integer cents, times in ISO 8601 UTC, and IDs are
  string ULIDs.
- Errors: `{ "error": { "code": string, "message": string, "details"?: string[] } }`.
  `422` means validation failed, and `details` is what to show him.
- Owner endpoints take `Authorization: Bearer <session token>`.

**Auth**: Sign in with Apple (`expo-apple-authentication`). The app sends the
identity token to `POST /v1/auth/apple`. The Worker verifies it against Apple's
keys and checks it against an allowlist of Apple user IDs (Jacob, plus Brett for
support). It returns `{ token, expiresAt }`. Store the token in `expo-secure-store`.
There are no passwords and no sign-up screen.

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `POST /v1/auth/apple` | – | Exchange an Apple identity token for a session |
| `GET /v1/pricing` | – | `{ config, version, updatedAt }`. The website reads this too |
| `PUT /v1/pricing` | owner | Save a config. The server re-runs `validateConfig` and bumps `version`, and old versions are kept |
| `POST /v1/leads` | – | Website quote submissions: contact, vehicle, `QuoteInput`, quote snapshot |
| `GET /v1/leads?status=` | owner | New quote requests |
| `PATCH /v1/leads/:id` | owner | `status`: `new` → `contacted` → `booked` / `lost` |
| `POST /v1/availability` | – | `{ input: QuoteInput }` → `{ bookable, reason?, timezone, minutes, quote, days: [{ date, slots: [ISO] }] }`. `reason` is customer-facing text when it can't be booked online |
| `POST /v1/bookings` | – | Website booking: `{ input, start, name, phone, address, email?, zip?, vehicle?, notes? }` → `201 { id, start, end, quote }`. `409 slot_taken` means someone else got it, so refetch availability |
| `GET/PUT /v1/settings/booking` | owner | `{ rules: BookingRules, updatedAt }`. PUT runs `validateRules` (`422` with `details`) |
| `GET /v1/jobs?from=&to=` | owner | `{ jobs }` overlapping the range (ISO). Defaults to yesterday through two weeks out. Each job embeds `customer: { id, name, phone, email }` |
| `GET /v1/jobs/:id` | owner | One job |
| `POST /v1/jobs` | owner | Jacob adds a job: `{ customerId \| customer: { name, phone?, email?, address? }, input, start, address?, zip?, vehicle?, notes?, minutes? }` → `201 { job, warnings: string[] }`. He can book anything. Clashes (overlap, day limit, closed day, outside hours) come back as warnings to show him, not errors |
| `PATCH /v1/jobs/:id` | owner | Any of `status` (`scheduled` → `in_progress` → `done` / `cancelled`), `start` (moving the start keeps the length), `end`, `notes`, `address`, `vehicle`, `finalPrice` (cents) |
| `GET /v1/customers?q=` | owner | `{ customers }`. Search by name, phone digits or email. Empty `q` lists the newest |
| `GET /v1/customers/:id` | owner | The customer plus `jobs`, newest first |
| `PATCH /v1/customers/:id` | owner | `name`, `phone`, `email`, `address`, `notes` |
| `GET /v1/time-off` | owner | `{ timeOff: [{ id, start, end, reason }] }`, recent and upcoming |
| `POST /v1/time-off` | owner | `{ start, end, reason? }`. Blocks online booking in that span |
| `DELETE /v1/time-off/:id` | owner | `204` |
| `POST /v1/jobs/:id/photos` | owner | Before/after photos, returns an upload URL (R2) |
| `POST /v1/jobs/:id/invoice` | owner | Create or send an invoice. Emails a pay link |
| `POST /v1/terminal/connection-token` | owner | Stripe Terminal token for Tap to Pay |
| `POST /v1/jobs/:id/payment-intent` | owner | Create a PaymentIntent for the job's final amount |
| `GET/POST/PATCH /v1/inventory[/:id]` | owner | Items: name, barcode, unit, on hand, reorder at, reorder URL, cost |
| `GET /v1/inventory/barcode/:code` | owner | Look an item up by scanned code. `404` means not known yet |
| `POST /v1/inventory/:id/movements` | owner | `{ delta, reason: 'restock' \| 'used' \| 'adjust', jobId? }` |

**Job shape** (what `GET /v1/jobs` returns per job): `id`, `status`, `source`
(`web` = customer booked online, `app` = Jacob added it), `service`,
`customer { id, name, phone, email }`, `vehicle`, `address`, `zip`, `notes`,
`input` (the `QuoteInput`), `quote` (`{ service, lines, total, range, hours,
inspection, notes }`), `configVersion`, `finalPrice`, `start`, `end`, `date`
(the local day), `createdAt`, `updatedAt`.

**How online booking works.** The website posts the customer's answers to
`/availability`. The server prices them, sizes the job with `jobMinutes`, and
lists open starts under Jacob's `BookingRules`. Jobs, their buffer either side
and time off all block time, and the daily job limit applies. Inspection-only
work and jobs longer than a working day can't be booked online: they go to
Jacob as leads. `/bookings` checks the slot again and inserts it with one
conditional statement, so two customers can never get the same time. A
returning customer is matched by phone (last 10 digits), then email, and the
job attaches to their existing record.

Stripe secret keys only ever live in the Worker. The app only holds a Terminal
connection token.

## Screens (v1)

A tab bar with five tabs: **Today · Schedule · Leads · Inventory · More**.

- **Today**: today's jobs in order. Each shows the customer, vehicle, address and
  quoted range. Tap an address for directions in Apple Maps (a `Linking` URL,
  no map SDK needed). There's a big "Start" / "Done" action per job.
- **Job**: the details, notes, before/after photos (`expo-image-picker` with the
  camera) and the price. **Get paid** runs Tap to Pay, or sends an invoice link.
  Marking a job done asks what product was used, pre-filled from the package.
- **Schedule**: a week view from `GET /v1/jobs` and `GET /v1/time-off`. Jobs
  the customer booked online (`source: 'web'`) are marked so he knows which ones
  still need a confirmation text. Add a job from a lead, a customer or scratch,
  and show any `warnings` it returns. Block time off with a start, an end and a
  reason. Drag or edit to reschedule (`PATCH` with a new `start`).
- **Leads**: quotes from the website, newest first. Call, text or book with one tap.
- **Customers**: search, history, vehicles, total spend.
- **Quote**: the same formula as the website, for pricing a job in the
  driveway. It can become a job directly.
- **Inventory**: a list sorted by what's low. **Scan** uses `expo-camera`'s
  barcode scanning. A known code opens the item, where he taps + or − to change
  the count. An unknown code asks him to name it once, and it's remembered.
  Includes a reorder link per item.
- **More → Pricing**: edit every number in the `PricingConfig`. `validateConfig`
  runs on save and shows its messages. Show a preview quote live while he edits,
  so he can see what a change does before saving.
- **More → Booking**: online booking on/off, hours for each day (or closed),
  jobs per day, time between jobs, notice needed, how far ahead. Validate with
  `validateRules` before saving to `PUT /v1/settings/booking`. Label everything
  in his words: "Time between jobs", not "bufferMinutes".
- **More → Settings**: sign out, app version, pricing version.

Out of scope for v1: multiple staff, payroll, recurring maintenance plans,
marketing email, Android.

## Build notes

- Expo SDK (latest), `expo-router`, TypeScript `strict`, TanStack Query for
  server state.
- **Dev client, not Expo Go.** Stripe Terminal needs native code. Build with EAS.
- Distribution: TestFlight while it's being built, then an unlisted App Store
  listing so Jacob gets automatic updates. Brett's Apple Developer account
  publishes it.
- **Tap to Pay on iPhone** needs Apple's Tap to Pay entitlement on the app ID.
  Request it early, because approval can take a while. Until it's granted,
  payments go out as invoice links.
- Jacob creates the Stripe account himself so payouts go to his bank. The Worker
  holds its keys.
- Offline: Today, the job screen and Quote must work with no signal. Cache the
  pricing config and today's jobs, and queue status changes and stock movements
  to send when the connection is back.

## Design

It should look like it belongs to the same business as kedservice.com, and
**not like a component-kit template**.

Tokens (from the website's `src/styles/global.css`):

| Token | Hex | Use |
| --- | --- | --- |
| ink-950 | `#07080a` | Background |
| ink-900 | `#0b0d11` | Raised surfaces |
| ink-800 | `#171b22` | Hairline dividers |
| ink-700 | `#232832` | Borders |
| gold-500 | `#e8b14c` | The one accent: selection, primary action |
| gold-400 | `#f5c76a` | Pressed/hover accent |
| bone-50 | `#f6f7f9` | Primary text |
| bone-200 | `#d3d7de` | Secondary text |
| bone-400 | `#8a919e` | Muted text |

Type: **Archivo** (variable, condensed widths, heavy weights, uppercase) for
headings and numbers, **Inter** for body. Both are on Google Fonts and load with
`expo-font`.

Do:
- Ruled rows with hairline dividers, like a work order or spec sheet.
- A thin gold rule marks the selected or active row.
- Square corners (2px at most), square selectors, and joined segmented controls.
- Big, tabular numbers for money and times.
- Native iOS behaviour where it helps: large titles, swipe actions, haptics on
  a completed payment.

Don't:
- Rounded pill chips or tag clouds.
- A dashboard made of rounded cards with icons in coloured circles.
- Gradients, glassmorphism, emoji, stock illustrations, or "✨ AI" anything.
- Numbered "Step 01 / 02" flows.

Copy: short and plain, in Jacob's voice. "Get paid", not "Process payment".

## Milestones

1. App shell, Sign in with Apple, and the Pricing editor plus Quote screen
   using the vendored engine. This is the first thing to show Jacob.
2. Today, Schedule, Leads, Customers and Booking settings against the live API.
   All of these endpoints exist now.
3. Stripe: invoices and pay links first, then Tap to Pay.
4. Inventory and scanning, then product use per job.
5. Import Housecall Pro's customer/job export, cut over, and cancel it.

---

### Snippet for the mobile repo's CLAUDE.md

```md
## Spec

The app spec, API contract and design rules live in the website repo:
https://github.com/brettmboggs/ked-detailing/blob/main/docs/mobile-app.md
(locally: ../ked-detailing/docs/mobile-app.md). Read it before starting work.

- Pricing and scheduling: never reimplement. `src/vendor/pricing` and
  `src/vendor/scheduling` are vendored from ked-detailing/packages. Don't edit
  them. Run `npm run sync:shared`.
- The backend is the Worker in ked-detailing/api. If the app needs an endpoint
  that isn't in the spec, change the spec there first.
```
