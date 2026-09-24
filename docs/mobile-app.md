# KED Ops — iPhone app spec

The brief for Jacob's iPhone app, which lives in its own repo. Point that repo's
`CLAUDE.md` / `AGENTS.md` here (snippet at the bottom). This file is the source of
truth for **what** the app does and **how it talks to everything else**. If the
app and this doc disagree, fix one of them in the same change.

Last updated: 2026-09-24.

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
├── packages/pricing   quote formula, shared: TypeScript, zero dependencies
├── api/               Cloudflare Worker + D1: the one backend   ← NOT BUILT YET
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

## The pricing engine

### Getting it into the app

`@ked/pricing` isn't published to a registry. The app **vendors** it, pinned to
a commit of this repo, with a sync script. Never edit the vendored files. Change
them here and re-sync.

Add `scripts/sync-pricing.mjs` to the app repo:

```js
// Vendors packages/pricing/src from ked-detailing at a pinned ref.
// Usage: node scripts/sync-pricing.mjs [ref]   (default: main)
import { mkdir, rm, writeFile } from 'node:fs/promises';

const REPO = 'brettmboggs/ked-detailing';
const ref = process.argv[2] ?? 'main';
const out = new URL('../src/vendor/pricing/', import.meta.url);

const sha = (await (await fetch(`https://api.github.com/repos/${REPO}/commits/${ref}`)).json()).sha;
if (!sha) throw new Error(`Could not resolve ${ref}`);
const listing = await (
  await fetch(`https://api.github.com/repos/${REPO}/contents/packages/pricing/src?ref=${sha}`)
).json();

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const f of listing.filter((f) => f.type === 'file' && !f.name.endsWith('.test.ts'))) {
  const body = await (await fetch(f.download_url)).text();
  await writeFile(
    new URL(f.name, out),
    `// VENDORED from ${REPO}@${sha.slice(0, 7)} — do not edit. Run \`npm run sync:pricing\`.\n${body}`,
  );
}
await writeFile(new URL('SOURCE', out), `${REPO}@${sha}\n`);
console.log(`pricing synced from ${sha.slice(0, 7)}`);
```

Then add `"sync:pricing": "node scripts/sync-pricing.mjs"` to its package.json,
commit `src/vendor/pricing/`, and import from `@/vendor/pricing` (or add a path
alias). The source uses `.ts` import specifiers, so the app's `tsconfig` needs
`"allowImportingTsExtensions": true` (with `noEmit`, which Expo already sets).
Metro resolves them as-is.

Re-sync whenever `packages/pricing` changes here. The API reports the config
version it holds, so a stale vendored engine shows up quickly.

### What it exposes

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

## Backend API (contract v0)

> **Status: not built.** The Worker gets built in `api/` in this repo against
> this contract. Until then, the app builds against a typed client with an
> in-memory mock, selected when `EXPO_PUBLIC_API_URL` is unset. When the real
> API lands, only the client's transport changes.

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
| `GET/POST/PATCH /v1/customers[/:id]` | owner | Name, phone, email, address, notes |
| `GET/POST/PATCH /v1/customers/:id/vehicles` | owner | Year, make, model, class, colour, notes |
| `GET /v1/jobs?from=&to=` | owner | Schedule |
| `POST/PATCH /v1/jobs[/:id]` | owner | Customer, vehicle, `QuoteInput`, quoted range, final price, start/end, address, status (`scheduled` → `in_progress` → `done` / `cancelled`), notes |
| `POST /v1/jobs/:id/photos` | owner | Before/after photos, returns an upload URL (R2) |
| `POST /v1/jobs/:id/invoice` | owner | Create or send an invoice. Emails a pay link |
| `POST /v1/terminal/connection-token` | owner | Stripe Terminal token for Tap to Pay |
| `POST /v1/jobs/:id/payment-intent` | owner | Create a PaymentIntent for the job's final amount |
| `GET/POST/PATCH /v1/inventory[/:id]` | owner | Items: name, barcode, unit, on hand, reorder at, reorder URL, cost |
| `GET /v1/inventory/barcode/:code` | owner | Look an item up by scanned code. `404` means not known yet |
| `POST /v1/inventory/:id/movements` | owner | `{ delta, reason: 'restock' \| 'used' \| 'adjust', jobId? }` |

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
- **Schedule**: a week view. Add a job from a lead, a customer or scratch, and
  block time off.
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

1. App shell, Sign in with Apple against the mock, and the Pricing editor plus
   Quote screen using the vendored engine. This is the first thing to show Jacob.
2. The real API from this repo: customers, jobs, schedule, leads.
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

- Pricing: never reimplement. `src/vendor/pricing` is vendored from
  ked-detailing/packages/pricing. Don't edit it. Run `npm run sync:pricing`.
- The backend is the Worker in ked-detailing/api. If the app needs an endpoint
  that isn't in the spec, change the spec there first.
```
