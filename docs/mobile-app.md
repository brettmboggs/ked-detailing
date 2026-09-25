# KED Ops — iPhone app spec

The brief for Jacob's iPhone app, which lives in its own repo. Point that repo's
`CLAUDE.md` / `AGENTS.md` here (snippet at the bottom). This file is the source of
truth for **what** the app does and **how it talks to everything else**. If the
app and this doc disagree, fix one of them in the same change.

Last updated: 2026-09-24 (the Money tab is now Books; Today leads with what needs him).

---

## Why it exists

Jacob (Knock Em' Down Auto & Marine Detailing) runs his business on Housecall Pro
and QuickBooks. The goal is to **replace both entirely**, not sit beside them. When this
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
├── packages/books       bookkeeping: accounts, balanced entries, bank CSVs, reports
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
- **Hosting cost target is $0.** Cloudflare free tier (Workers, D1, KV for photos).
  The only running costs should be Stripe's per-payment fee and, optionally,
  about 1¢ per reminder text.

## The shared packages

### Getting them into the app

`@ked/pricing`, `@ked/scheduling` and `@ked/books` aren't published to a registry. The app
**vendors** them, pinned to a commit of this repo, with one sync script. Never
edit the vendored files. Change them here and re-sync.

Add `scripts/sync-shared.mjs` to the app repo. If you already added the older
`sync-pricing.mjs`, this replaces it.

```js
// Vendors packages/{pricing,scheduling,books}/src from ked-detailing at a pinned ref.
// Usage: node scripts/sync-shared.mjs [ref]   (default: main)
import { mkdir, rm, writeFile } from 'node:fs/promises';

const REPO = 'brettmboggs/ked-detailing';
const PACKAGES = ['pricing', 'scheduling', 'books'];
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
commit `src/vendor/`, and import from `@/vendor/pricing`, `@/vendor/scheduling`
and `@/vendor/books` (or add path aliases). The source uses `.ts` import
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
| `BookingRules` | Jacob's booking settings: on/off, time zone, hours per weekday (Sunday first, `null` = closed), slot step, buffer between jobs, jobs per day, notice, how far ahead, and `travel` (`{ on, homeZip, packUpMinutes }`; missing means off). With travel on, the gap between two jobs is the estimated drive plus pack-up, and `bufferMinutes` only applies when a job's ZIP is unknown. |
| `driveMinutes(zipA, zipB)` / `roadMiles` / `zipOf(zip, address)` | Drive estimates from ZIP code centers, no maps service. Always say "about". `zipOf` finds the ZIP in a job's `zip` or its address. On the Schedule and Today screens, show the drive between consecutive jobs and flag it when it doesn't fit (the admin's `calendar-drives.ts` does this). |
| `validateRules(rules)` | Run before saving the booking-rules editor. Show its messages as they are. |
| `defaultRules` | Fallback only. |
| `jobMinutes(quote.hours, rules)` | How long a job holds the calendar: the high end of the quote, rounded up to the slot step. Show it on the job and when adding one. |
| `openSlots` / `slotProblem` | Only needed to preview availability offline. The API is the authority. |
| `zonedToUtc` / `localDate` / `addDays` / `weekday` | Time-zone-safe date maths using only Intl, which works on Hermes. Always show times in `rules.timezone` (America/Chicago), never in the phone's zone. |

### Books: what it exposes

The books are real double-entry underneath, but **Jacob never sees debits or
credits**. He picks a category ("Supplies") and where the money came from or
went to ("Business checking"). Never show him the word "debit".

| Export | Use in the app |
| --- | --- |
| `Account`, `defaultAccounts` | The chart. `type` is asset / liability / equity / income / expense. `moneyAccount: true` means it can pay, receive and take bank imports (checking, cash, Stripe, credit card). Income and expense accounts carry `scheduleC`, the tax-form line. Use `hint` as the subtitle when he picks a category. |
| `SCHEDULE_C_LINES` | Labels for those lines, for the tax-summary report. |
| `expenseLines` / `incomeLines` / `transferLines` | Only for previewing an entry before saving. The API builds the real one. |
| `readBankFile(text, { invert })` | Preview a statement before uploading: show the row count and any `problems`. Reads OFX, QFX and QBO (what Commerce Bank calls Money, Quicken and QuickBooks downloads) and CSV. **Steer Jacob to QFX**: every line carries the bank's own ID, so nothing can ever import twice. `invert` only applies to CSVs from cards that list purchases as positive numbers. |
| `merchantKey(description)` | The merchant name the books learn by ("POS DEBIT AUTOZONE #4412 HIGH RIDGE MO" becomes "AUTOZONE"). Show it as the line's title, with the full description under it. |
| `BooksSettings`, `validateBooksSettings` | Mileage rate per year, sales tax (off by default), and the 1099 threshold. |

All money is **integer cents**. For amounts in books entries and reports, `+`
means money in and `−` means money out, from the account's point of view.

## Backend API (contract v0)

> **Status:** the Worker lives in `api/` in this repo (Hono, D1 database `ked`).
> **Built and tested:** auth, pricing, leads, online booking, jobs, customers,
> time off, booking rules, and **the books**: accounts, expenses, income,
> transfers, voids, payees, bank CSV import with auto-matching, mileage,
> reports and CSV exports, **the smart layer** (QFX/OFX/QBO import, rules
> learned from how Jacob files, starter suggestions for common merchants,
> deposits matched to unpaid jobs, "That was personal", the inbox), and
> **photos** (receipts and before/after job shots), and **invoices** (pay
> links texted from his phone, paid status read from the books), and
> **inventory** (barcodes, stock history, low-stock list, product use per job),
> **alerts** (push to his phone on a booking, a quote request, or an invoice opened), and
> **customer booking links** (customers see, move or cancel their own booking).
> Photos are stored in Cloudflare KV (free plan: 1 GB, 1,000 uploads a day),
> so **downscale to about 1600 px and JPEG quality 0.7 before uploading**, which
> keeps each photo around 200 KB. If storage is ever missing, calls return `503
> photos_off`, so show "Photo storage isn't on" rather than failing silently. Still to come: Stripe. A live
> bank feed (Plaid) is optional; Teller doesn't support Commerce Bank. It
> would feed the same import path, so nothing in the app changes except
> gaining a "Connect bank" button. For endpoints that don't exist yet, the app uses a typed client
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
| `GET /v1/hours` | – | `{ timezone, week, updatedAt }`. The working days only, for the website's footer and search listing |
| `GET /v1/site` | – | `{ content, updatedAt }`: the website's words and photos as Jacob changed them in the web admin's Website tab. `content` holds only the changed fields (`hero`, `intro`, `area`, `contact`, `reviews`, `packages['level-1'…'level-4']`, `also`, `faqs`, `marquee`, `recent`) and is `{}` until the first save. The site's build lays it over `src/data/site.ts` (`src/lib/site-content.ts` has the shape). The app doesn't need it |
| `PUT /v1/site` | owner | Replace the document. Strict: unknown fields, over-long text and `<` `>` are refused (`422 invalid_site` with `details`). Photos are a built-in file name or a site upload's id. Rebuilds the website, like a pricing save, and deletes site uploads no longer used (after an hour) |
| `POST /v1/site/photos` | owner | Raw image bytes, JPEG, PNG or WebP (convert HEIC first), up to 5 MB → `201 { id, contentType, bytes, url }`. Kept apart from job photos and receipts. Private until a `PUT /v1/site` uses it |
| `GET /v1/site/photos/:id` | – | A website photo, only while the saved site uses it (else `404`). Cached for a year. The build copies these into the site, so pages never load them from here |
| `PUT /v1/pricing` | owner | Save a config. The server re-runs `validateConfig` and bumps `version`, and old versions are kept |
| `POST /v1/leads` | – | Website quote submissions: contact, vehicle, `QuoteInput`, quote snapshot |
| `GET /v1/leads?status=` | owner | New quote requests |
| `PATCH /v1/leads/:id` | owner | `status`: `new` → `contacted` → `booked` / `lost` |
| `POST /v1/availability` | – | `{ input: QuoteInput }` → `{ bookable, reason?, timezone, minutes, quote, days: [{ date, slots: [ISO], nearby? }] }`. With `input.zip`, times allow for the drive from Jacob's other jobs that day, and `nearby` is true when he already has one within about 6 miles. `reason` is customer-facing text when it can't be booked online |
| `POST /v1/bookings` | – | Website booking: `{ input, start, name, phone, address, email?, zip?, vehicle?, notes? }` → `201 { id, start, end, quote, manageUrl }`. `409 slot_taken` means someone else got it, so refetch availability |
| `GET /v1/manage/:token` | – | The customer's booking page (`/booking/?b=<token>` on the site). First name only |
| `GET /v1/manage/:token/availability` / `POST …/reschedule` / `POST …/cancel` | – | The customer moves or cancels it, under the same rules as booking online: only while `scheduled` and further off than `minNoticeHours`. Jacob gets a push (`rescheduled` / `cancelled`, id = job) |
| `GET/PUT /v1/settings/booking` | owner | `{ rules: BookingRules, updatedAt }`. PUT runs `validateRules` (`422` with `details`) and rebuilds the website, like a pricing save |
| `GET /v1/jobs?from=&to=` | owner | `{ jobs }` overlapping the range (ISO). Defaults to yesterday through two weeks out. Each job embeds `customer: { id, name, phone, email }` |
| `GET /v1/jobs/:id` | owner | One job |
| `POST /v1/jobs/:id/confirmation` | owner | `{ url, message }`: the text confirming a booking, with the customer's own link to see, move or cancel it. **Confirm** on a web booking opens the SMS composer with `message`. Works for jobs he adds too |
| `POST /v1/jobs` | owner | Jacob adds a job: `{ customerId \| customer: { name, phone?, email?, address? }, input, start, address?, zip?, vehicle?, notes?, minutes? }` → `201 { job, warnings: string[] }`. He can book anything. Clashes (overlap, too little time for the drive, day limit, closed day, outside hours) come back as warnings to show him, not errors, e.g. "Only 30 minutes between this and the 10:00 AM job, and the drive is about 45." |
| `PATCH /v1/jobs/:id` | owner | Any of `status` (`scheduled` → `in_progress` → `done` / `cancelled`), `start` (moving the start keeps the length), `end`, `notes`, `address`, `vehicle`, `finalPrice` (cents). With `status: cancelled`, an optional `cancelReason` (only Jacob sees it) |
| `GET /v1/customers?q=` | owner | `{ customers }`. Search by name, phone digits or email. Empty `q` lists the newest |
| `GET /v1/customers/:id` | owner | The customer plus `jobs`, newest first |
| `PATCH /v1/customers/:id` | owner | `name`, `phone`, `email`, `address`, `notes`, plus the CRM fields (see CRM: customers) |
| `GET /v1/time-off?from=&to=` | owner | `{ timeOff: [{ id, start, end, reason }] }` overlapping the range. Without `from`, recent and upcoming |
| `POST /v1/time-off` | owner | `{ start, end, reason? }`. Blocks online booking in that span |
| `DELETE /v1/time-off/:id` | owner | `204` |
| `GET /v1/books/accounts[?archived=true]` | owner | `{ accounts }`: the chart, in display order |
| `POST /v1/books/accounts` | owner | `{ name, type, moneyAccount?, scheduleC?, hint? }`, e.g. a second bank account or a new category |
| `PATCH /v1/books/accounts/:id` | owner | `name`, `hint`, `scheduleC`, `archived`. The type never changes |
| `GET /v1/books/payees?q=` / `POST` / `PATCH /:id` | owner | Vendors and contractors: `{ name, kind: 'vendor' \| 'contractor', taxFormOnFile, email?, phone?, notes? }`. **Never store tax IDs.** `taxFormOnFile` only records that he has a W-9 |
| `POST /v1/books/expenses` | owner | `{ date: 'YYYY-MM-DD', amount, categoryId, paidFromId, payeeId? \| payee?: { name, kind? }, jobId?, memo?, receiptKey? }`. A payee given by name reuses a match (ignoring case) or creates one |
| `POST /v1/books/income` | owner | `{ date, amount, depositToId, jobId?, categoryId?, method?, payee?, memo? }`. With a `jobId`, the category defaults to Detailing or Marine detailing. **This is "Mark paid" on a job** until Stripe lands |
| `POST /v1/books/transfers` | owner | `{ date, amount, fromId, toId, memo? }`: between his accounts, paying the card, Stripe payouts, owner draws (`toId: 'owner-draws'`) and contributions |
| `GET /v1/books/entries?from=&to=&accountId=&jobId=` | owner | `{ entries }`, newest first, each with `lines`, `payee`, `voidedBy` and `reverses` |
| `GET /v1/books/entries/:id` | owner | One entry, the same shape as in the list. For opening an entry that isn't in a loaded list, e.g. an auto-filed line from an older statement |
| `POST /v1/books/entries/:id/void` | owner | `{ date? }`. Entries are **never edited or deleted**: this posts the exact reversal. To edit, void the entry and record it again. Also frees any bank line matched to it |
| `POST /v1/books/bank-imports` | owner | `{ accountId, file, filename?, invert? }`. `file` is the text of a QFX, OFX, QBO or CSV (`csv` is still accepted as the field name). → `{ rows, added, duplicates, matched, filed, suggested, waiting, problems }`. In order: rows already in the books are **matched**; rows from a merchant Jacob has filed before are **filed** automatically by his rules; the rest get a **suggestion** where one can be made; `waiting` counts what's left for him |
| `GET /v1/books/bank-lines?status=unmatched&accountId=&auto=true` | owner | `{ lines }`. Each line has `merchant`, a `suggestion` (`{ action, …, source: 'starter' \| 'job', label }` or null) and `auto` (true if a rule filed it). Show the suggestion's `label` ("Looks like Fuel and vehicle costs", "Payment for Dana's job on 2033-05-01") with a one-tap accept |
| `POST /v1/books/bank-lines/:id` | owner | Deal with one line: `{ action: 'accept' }` takes the suggestion · `{ action: 'categorize', categoryId, payeeId? \| payee?, memo? }` · `{ action: 'transfer', otherAccountId }` · `{ action: 'personal' }` ("That was personal": money out becomes an owner draw, money in a contribution, never an expense) · `{ action: 'job', jobId }` (a customer's payment) · `{ action: 'match', entryId }` · `{ action: 'ignore' }` / `{ action: 'unignore' }`. Categorize, transfer and personal are **remembered for that merchant** unless `remember: false`. Waiting lines from the same merchant then file themselves immediately |
| `GET /v1/books/rules` | owner | What the books have learned: `{ merchant, direction, action, categoryName, otherAccountName, payee, hits }` |
| `DELETE /v1/books/rules/:id` | owner | Forget one. Entries it already filed stay; void them to undo |
| `GET /v1/books/inbox` | owner | Everything that needs Jacob, in one call: `bankLines { waiting, withSuggestion }`, `autoFiled` (the last 7 days, to glance at), `receiptsMissing` (expenses at or over `receiptPromptOver` with no photo), `tripsToLog` (finished jobs with no drive logged), `unpaidJobs` (finished, no payment recorded), and `total` for the tab badge |
| `GET /v1/books/trips?year=` / `POST` / `DELETE /:id` | owner | Mileage log: `{ date, miles, purpose, from?, to?, jobId? }`. `purpose` is required, because the IRS asks |
| `GET /v1/books/reports/profit-loss?from=&to=` | owner | `{ income[], expenses[], totalIncome, costOfGoods, totalExpenses, net, scheduleC[] }`. Defaults to this calendar year |
| `GET /v1/books/reports/balances?asOf=` | owner | What each money account holds (or, for the card, owes) |
| `GET /v1/books/reports/mileage?year=` | owner | `{ miles, trips, centsPerMile, deduction }`. `deduction` is null until that year's rate is in settings |
| `GET /v1/books/reports/contractors?year=` | owner | Totals per contractor, with `needs1099` |
| `GET /v1/books/export/{ledger,profit-loss,mileage,contractors}` | owner | CSV downloads (`from`/`to` or `year`). Offer these through the share sheet, for his accountant |
| `GET/PUT /v1/settings/books` | owner | `BooksSettings`. PUT validates |
| `POST /v1/photos?kind=receipt` or `?kind=job&jobId=&stage=before\|after&caption=` | owner | The **raw image bytes** as the body (not multipart), up to 10 MB. JPEG, PNG, WebP or HEIC, checked by content. → `{ id, kind, stage, jobId, contentType, bytes, caption, url }`. Downscale to about 1600 px, JPEG 0.7, before uploading (`expo-image-manipulator`) |
| `GET /v1/photos/:id` | owner | The image. Send the Authorization header (`expo-image` accepts `headers`) |
| `GET /v1/jobs/:id/photos` | owner | `{ photos }` for a job, oldest first |
| `DELETE /v1/photos/:id` | owner | `204`. A receipt attached to a books entry returns `409` and is kept |
| `POST /v1/books/entries/:id/receipt` | owner | `{ photoId }`: attach a receipt after the fact. Expenses also take `receiptKey: photoId` when created |
| `POST /v1/devices` | owner | `{ token }` from `expo-notifications` `getExpoPushTokenAsync()`. Call after every sign-in and app start; repeats are fine |
| `DELETE /v1/devices` | owner | `{ token }` in the body. Call on sign-out → `204` |
| `GET /v1/alerts` | owner | `{ alerts }`: the last 50, newest first, `{ id, type, refId, title, body, pushed, emailed, createdAt }`. Kept even when a push fails, so show them as a list behind a bell on Today |
| `POST /v1/jobs/:id/invoice` | owner | The job's live invoice: `200` with the one it has, or `201` with a new one built from its quote (plus a `Discount`/`Adjustment` line if `finalPrice` differs). Optional `{ lines, dueDate, notes }` only apply when creating. `422 no_price` for an inspection job with no `finalPrice`, `409 job_cancelled` for a cancelled one |
| `GET /v1/jobs/:id/extras` | owner | Add-ons found at the car: `{ extras, suggestions, url }`. `suggestions` are price-list add-ons this job doesn't have, priced for its vehicle (`[{ id, label, amount }]`); `url` is the customer's link once one was sent |
| `POST /v1/jobs/:id/extras` | owner | Offer one: `{ addOnId }` (priced from the list) or `{ label, amount }`, plus optional `note` (the customer sees it) and `photoId` (one of this job's photos, uploaded first with `POST /photos?kind=job&jobId=`). `amount` overrides the list price. → `201` extra. `409` on a cancelled or Housecall Pro history job |
| `POST /v1/jobs/:id/extras/send` | owner | `{ url, message, emailed }` for everything still waiting. **Open the SMS composer** with `message`. The link stays the same for the job. `409 nothing_waiting` |
| `PATCH /v1/extras/:id` | owner | `{ status }`: `approved` or `declined` when the customer answered in person, `withdrawn` to take back one they haven't answered. `409 decided` once answered |
| `GET /v1/approve/:token` | public | The customer's page (`/approve/?a=<token>`). A yes (`POST /v1/approve/:token/:extraId { yes }`) is final and adds the add-on to the job: `finalPrice` goes up by it if set, the open invoice gets it as a line, and a later invoice includes it. Photos at `/v1/approve/:token/photos/:photoId` |
| `GET /v1/invoices?status=&jobId=&customerId=` | owner | `{ invoices }`, newest number first. `status`: `draft`, `sent`, `paid`, `void`, or `unpaid` (draft and sent) |
| `GET /v1/invoices/:id` | owner | One invoice |
| `PATCH /v1/invoices/:id` | owner | `lines` (`[{ label, amount }]`, cents, negative for a discount, total above zero), `dueDate` (`YYYY-MM-DD` or null for "on receipt"), `notes` (shown to the customer). Changing lines also sets the job's `finalPrice`. `409` once void |
| `POST /v1/invoices/:id/send` | owner | Marks it sent → `{ invoice, message, emailed }`. **Open the SMS composer** (`expo-sms`) to the customer's phone with `message`, which includes the pay link. `emailed` is true when it was also emailed (customer email is off for now). `409` if paid or void |
| `POST /v1/invoices/:id/payments` | owner | "Got paid": `{ depositToId, method?, date?, amount?, tip? }`. `amount` defaults to the balance. A tip posts as its own entry under Tips and doesn't count against the balance → `201 { invoice, entries }` |
| `POST /v1/invoices/:id/void` | owner | `409 has_payments` while a payment stands: void it in the books first. Then `POST /jobs/:id/invoice` makes a fresh one with the next number |
| `GET /v1/pay/:token` | – | The customer's copy, for the website's `/pay/?i=<token>` page. First name only; no address or phone |
| `POST /v1/pay/:token/checkout` | – | Starts Stripe Checkout. `503 payments_off` until Stripe is connected |
| `POST /v1/terminal/connection-token` | owner | Stripe Terminal token for Tap to Pay |
| `POST /v1/jobs/:id/payment-intent` | owner | Create a PaymentIntent for the job's final amount |
| `GET /v1/inventory?low=true&archived=true&q=` | owner | `{ items, lowCount }`. Low items first (furthest under first), then by name. `low=true` is the shopping list. `lowCount` is the tab badge |
| `POST /v1/inventory` | owner | `{ name, unit?, barcode?, onHand?, reorderAt?, reorderUrl?, cost?, notes? }` → `201` item. `409 barcode_taken` names the item that has it |
| `GET /v1/inventory/:id` | owner | One item |
| `PATCH /v1/inventory/:id` | owner | Anything but the count: `name`, `unit`, `barcode`, `reorderAt`, `reorderUrl`, `cost`, `notes`, `archived`. Sending `onHand` is a `422` |
| `GET /v1/inventory/barcode/:code` | owner | Look an item up by scanned code. `404` means not known yet: ask him to name it, then `POST /inventory` with the code. 12- and 13-digit forms of the same UPC both match |
| `POST /v1/inventory/:id/movements` | owner | Change the count: `{ reason: 'restock' \| 'used' \| 'adjust', delta, jobId?, note?, unitCost? }`. The reason sets the sign, so always send a positive `delta` for + and − taps. After counting the shelf: `{ reason: 'adjust', count }`. A restock's `unitCost` becomes the item's cost → the item |
| `GET /v1/inventory/:id/movements` | owner | `{ movements }`, newest first, each with the `onHand` it left |
| `GET /v1/inventory/usage` | owner | `{ usage: { [serviceId]: [{ itemId, name, unit, amount }] } }`: each package's usual products |
| `PUT /v1/inventory/usage/:serviceId` | owner | `{ items: [{ itemId, amount }] }` replaces that package's usual products. Edit this under More → Pricing, per package |
| `GET /v1/jobs/:id/usage` | owner | `{ used, suggested, productCost }`. `suggested` is the package's usual list until something is recorded: pre-fill "What did you use?" with it |
| `PUT /v1/jobs/:id/usage` | owner | `{ items: [{ itemId, amount }] }` (up to 20) sets what the job used. Only the differences move stock, so saving twice changes nothing and a removed item goes back on the shelf |

**Job shape** (what `GET /v1/jobs` returns per job): `id`, `status`, `source`
(`web` = customer booked online, `app` = Jacob added it), `service`,
`customer { id, name, phone, email }`, `vehicle`, `address`, `zip`, `notes`,
`input` (the `QuoteInput`), `quote` (`{ service, lines, total, range, hours,
inspection, notes }`), `configVersion`, `finalPrice`, `manageToken`,
`cancelledBy` (`customer` or `owner`), `cancelReason`, `importedFrom`
(`hcp:<job number>` for jobs brought over from Housecall Pro), `history`
(past imported work), `start`, `end`, `date`
(the local day), `createdAt`, `updatedAt`. Show a customer's cancel reason on
the job.

**Imported jobs** have `service: 'imported'` and `input: {}`: there's no
`QuoteInput`, so show `quote.lines[0].label` as the service and don't offer
to re-price them.

**Extra shape**: `id`, `jobId`, `addOnId`, `label`, `amount`, `note`,
`photoId`, `status` (`offered` → `approved` / `declined`, or `withdrawn`),
`decidedBy` (`customer` or `owner`), `sentAt`, `decidedAt`, `createdAt`. After a
yes, refetch the job and its invoice: their totals changed on the server.

**Invoice shape**: `id`, `number` (1001 up), `jobId`, `customer { id, name,
phone, email }`, `status` (`draft` → `sent` → `paid`, or `void`), `lines`,
`total`, `paid`, `balance`, `paidOn`, `dueDate`, `notes`, `payUrl`, `sentAt`,
`viewedAt` (when the customer first opened the link; show "Seen"), `voidedAt`,
`createdAt`, `updatedAt`.

**Paid is never stored.** It's the money received on the job's income entries,
so every way of recording a payment settles the invoice: "Got paid" above,
`POST /books/income` with the `jobId`, a bank deposit filed to the job, and
Stripe later. Voiding a payment reopens it. After any of those, refetch the
invoice rather than updating it locally.

**Item shape**: `id`, `name`, `barcode`, `unit`, `onHand` (can be a fraction,
e.g. 0.25 gal), `reorderAt`, `reorderUrl`, `cost` (cents per unit), `notes`,
`archived`, `low`, `updatedAt`.

**Push alerts.** The server pushes through Expo's push service (free, no
keys needed) when a customer books online (`type: 'booking'`, `id` = job), a
website quote request comes in (`'lead'`, lead id), or a customer first opens
an invoice (`'invoice_opened'`, invoice id), or moves or cancels
their booking through their link (`'rescheduled'` / `'cancelled'`, job id), or
answers an add-on (`'extra_approved'` / `'extra_declined'`, job id). Each push carries `data: { type,
id }`: open that screen on tap. Ask for notification permission right after
sign-in, with a line on why ("So you hear the moment someone books"). This is
how Jacob learns about online bookings, so it has to work before `/quote`
goes public.

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

### CRM: customers

The customer list as a CRM, one customer's profile and timeline, notes and
calls, tags, source, consent, referrals, CSV export and merging duplicates.
Owner-only. See `docs/crm.md`. Money is in cents.

| Method | Path | What |
| --- | --- | --- |
| GET | `/v1/crm/customers?segment=<json>` | `{ customers }` with their numbers, filtered and sorted by a segment (`q`, `lifecycle`: any/lead/customer/repeat/lapsed, `lapsedDays`, `minSpend`, `maxSpend`, `minVisits`, `maxVisits`, `lastVisitBefore`, `lastVisitAfter`, `noUpcoming`, `services`, `zips` (prefixes), `sources`, `tags`, `canEmail`, `canText`, `sort`: spend/recent/visits/name/newest, `limit` ≤ 2000, default 500). 422 on a bad segment |
| GET | `/v1/crm/customers/export?segment=<json>` | The same segment as a CSV download (up to 2,000 rows): Name, Phone, Email, Visits, Spent (dollars), Last visit, Next booking, Source, Tags, Can email, Can text. Cells starting with `= + - @` are prefixed with `'` |
| GET | `/v1/crm/customers/tags` | `{ tags: [{ tag, count }] }`, most used first, for filters |
| GET | `/v1/crm/customers/duplicates` | `{ groups: [{ reasons: ['phone' \| 'email' \| 'name'], customers: [{ id, name, phone, email, address, createdAt, visits }] }] }` |
| GET | `/v1/crm/customers/:id` | The profile (below). About a dozen queries whatever the history. Makes a referral code for an older customer who has none |
| PATCH | `/v1/crm/customers/:id` | Same as `PATCH /v1/customers/:id`: `name`, `phone`, `email`, `address`, `notes`, `tags` (list; trimmed, lower-cased, deduped, ≤ 12, each ≤ 24 characters), `source` (one of google, maps, instagram, facebook, nextdoor, referral, van, repeat, other, or null), `sourceDetail` (≤ 120), `emailOk`, `textOk` (booleans), `referredBy` (a customer id or null; not themselves, no loops). Returns the customer |
| POST | `/v1/crm/customers/:id/activities` | `{ kind: 'note' \| 'call' \| 'text', body, direction?: 'out' \| 'in' }` (201). A note needs a body; a call or text doesn't. Returns the timeline item |
| PATCH | `/v1/crm/customers/:id/activities/:activityId` | `{ body?, direction? }`. Only notes, calls and texts Jacob added (403 otherwise). Sets `meta.editedAt` |
| DELETE | `/v1/crm/customers/:id/activities/:activityId` | 204. Same rule as editing |
| POST | `/v1/crm/customers/:id/merge` | `{ otherId }`: two records of one person become one. The **older** record stays whichever id is in the path. Jobs, invoices, quote requests, timeline, follow-ups and campaign sends move to it; blank phone, email, address, source and referral code are filled from the other; notes are joined; tags combined; an email or text opt-out on either stands; people the other one referred point at the kept one. One atomic batch, logged on the timeline. Returns `{ kept, removed, customer }` |

**Profile shape** (`GET /v1/crm/customers/:id`):

- `customer`: the customer (as `GET /v1/customers/:id`, plus `attribution`:
  what the website saw on their first visit, `{ utmSource, utmMedium,
  utmCampaign, referrer, landing, firstSeen, ref }`, or null).
- `numbers`: `visits`, `spend`, `avgTicket`, `firstVisit`, `lastVisit`
  (YYYY-MM-DD), `lastService`, `nextVisit` (ISO), `customerSince` (the earlier
  of the day they were added and their first visit), `everyDays` (average
  days between visits, or null), `services` (ids), `zip`, `referrals`,
  `paid` and `tips` (money in on their invoices), `owed` (unpaid balances).
  Only done jobs count as visits and spend; a job's value is its final price,
  else the quote's total.
- `referral`: `{ code, url, referredBy: { id, name } | null, referred: [{ id,
  name, createdAt, visits }] }`. `url` is `https://www.kedservice.com/?ref=CODE`.
- `jobs` (as `GET /v1/jobs/:id`), `invoices` (as `GET /v1/invoices`),
  `payments` (`{ id, date, amount, method, jobId, tip }`), `quoteRequests`
  (`{ id, status, service, vehicle, zip, notes, range, source, createdAt }`),
  `followUps` (open ones: `{ id, kind, dueDate, channel, title, message,
  jobId, leadId, createdAt }`).
- `timeline`: newest first, up to 400 items `{ type, id, at, title, body,
  amount?, jobId?, invoiceId?, date?, status?, meta?, by?, editable? }`.
  `type` is an activity kind (`note`, `call`, `text`, `email`,
  `review_request`, `referral`, `system`) or `job` (done at its start,
  cancelled when cancelled, else booked when made), `invoice` (sent or made;
  voided), `payment` (`at` is its day at 1 PM Central) or `quote`. Calls and
  texts have `meta.direction`.

### CRM: follow-ups

Who Jacob should contact today, made each morning by the daily rules
(`runDaily`, cron `0 14 * * *`), plus his own reminders. Owner-only unless
marked public. See `docs/crm.md`.

| Method | Path | What |
| --- | --- | --- |
| GET | `/v1/crm/follow-ups` | `{ today, due, upcoming, sent, done, email: { configured, sentLastDay, perDay } }`. `due`: open, due today or earlier (the Today list). `upcoming`: open, due later. `sent`: emailed automatically in the last 7 days. `done`: done or skipped in the last 7 days. `?customerId=` returns `{ today, followUps, email }` for one customer, all of theirs |
| POST | `/v1/crm/follow-ups` | Jacob's own: `{ title, dueDate?, customerId?, leadId?, message?, channel? }` (201). `dueDate` defaults to today |
| POST | `/v1/crm/follow-ups/run` | "Check now": runs the rules and sends due emails. Safe to repeat. Returns `{ today, created: { rebook, review, … }, emailed, emailFailed, emailWaiting, emailConfigured }` |
| GET | `/v1/crm/follow-ups/settings` | `{ settings, defaults, updatedAt, placeholders, services: [{ id, name, level }], fallbackReviewUrl, email: { configured } }` |
| PUT | `/v1/crm/follow-ups/settings` | The whole settings object, validated (422 lists every problem, including unknown `{placeholders}`) |
| GET | `/v1/crm/follow-ups/:id` | One follow-up |
| PATCH | `/v1/crm/follow-ups/:id` | Edit an open one: `message`, `subject`, `title`, `dueDate`, `channel` (choosing `text` or `call` takes it out of the email queue) |
| POST | `/v1/crm/follow-ups/:id/texted` | "I texted them": done, and the message goes on their timeline as a text |
| POST | `/v1/crm/follow-ups/:id/done` | `{ how?: 'text' \| 'call' \| 'email' }`; `how` logs that on their timeline |
| POST | `/v1/crm/follow-ups/:id/skip` | Not doing this one |
| POST | `/v1/crm/follow-ups/:id/snooze` | `{ days: 1–90 }` or `{ until: 'YYYY-MM-DD' }` |
| POST | `/v1/crm/follow-ups/:id/reopen` | Undo done or skip (not for sent emails) |
| GET | `/v1/crm/public/unsubscribe/:token` | Public. `{ firstName, email (masked), unsubscribed }` for the unsubscribe page |
| POST | `/v1/crm/public/unsubscribe/:token` | Public. Unsubscribes from email (`email_ok = 0`, logged). Also the RFC 8058 one-click target of the `List-Unsubscribe` header: any body, no session |
| POST | `/v1/crm/public/unsubscribe/:token/undo` | Public. Subscribes them again |

**Follow-up shape**: `id`, `kind` (`review` = first thank-you with the review
ask, `thank_you`, `reminder`, `rebook`, `winback`, `quote_chase`, `custom`),
`status` (`open`, `done`, `skipped`, `sent`), `channel` (`text`, `email`,
`call`), `title` (the why: "Due for a Level I: last one June 12"), `message`
(ready to send), `subject`, `dueDate`, `customer { id, name, phone, email,
emailOk, textOk }` (or null), `leadId`, `jobId`, `email` (`{ state: queued |
sending | sent | failed, note, sentAt }` for automatic email, else null),
`auto` (made by a rule), `createdAt`, `updatedAt`, `doneAt`.

**Texts are never sent by the server.** For a `text` follow-up, open the
Messages composer with `message` filled in, then call `/texted`. Emails go
automatically only when Resend is set up, the rule allows it and the customer
hasn't unsubscribed; otherwise the follow-up stays open as a text.

### CRM: marketing

Campaigns to a segment by email or text list, tracking links, the referral
program, review asks and the "find more leads" playbook. Owner-only, all under
`/v1/crm/campaigns` (`api/src/crm-campaigns.ts`). See `docs/crm.md`. Money is
in cents.

| Method | Path | What |
| --- | --- | --- |
| GET | `/v1/crm/campaigns` | `{ campaigns, emailReady }`, newest first. `emailReady` is false until `RESEND_API_KEY` is set |
| GET | `/v1/crm/campaigns/templates` | `{ templates: [{ id, name, why, months, channel, subject, email, text, segment }], placeholders }`. Ids: `spring-boats`, `winter-salt`, `holiday-gift`, `miss-you`, `ceramic-upsell`, `referral`. `months` (1–12, Central) are when it fits |
| POST | `/v1/crm/campaigns` | A new draft (201): `{ template, channel? }`, or `{ name, segment, channel: 'email' \| 'text', subject?, body }`. `segment` is the one `GET /v1/crm/customers` takes; without `limit` it means everyone who matches (up to 2,000) |
| POST | `/v1/crm/campaigns/preview` | Nothing saved. `{ segment, channel, subject, body, name?, sampleId? }` → `{ count, canEmail, canText, people (first 100: id, name, canEmail, canText, visits, spend, lastVisit), sample: { id, name, subject, body } \| null, unknown }`. `unknown` lists placeholders that won't be filled |
| GET | `/v1/crm/campaigns/:id` | One campaign |
| PATCH | `/v1/crm/campaigns/:id` | Drafts only (409 after it starts): `name`, `segment`, `channel`, `subject`, `body` |
| DELETE | `/v1/crm/campaigns/:id` | Drafts only (204; 409 after it starts) |
| POST | `/v1/crm/campaigns/:id/send` | Starts it, then (email) sends the next batch. The first call freezes the list: one `campaign_sends` row per person, `queued`, or `skipped` with why (`no_email`, `unsubscribed`, `no_phone`, `no_texts`). Email sends up to 10 per call (6 on the first), about 3 queries each; **call again while `campaign.stats.queued` > 0**. Returns `{ campaign, batch: { sent, failed, skipped, dailyLimit, emailsLeftToday } \| null }`. Campaigns stop at 90 emails a day (UTC, counting every marketing email) to stay under Resend's free 100; `dailyLimit` says so. 409 `email_not_set_up` without the Resend key. For a text campaign it only makes the list |
| POST | `/v1/crm/campaigns/:id/retry` | Failed emails go back in the queue |
| GET | `/v1/crm/campaigns/:id/people` | `{ people: [{ customerId, name, phone, email, status, reason, sentAt, message }] }`, still-to-do first. `message` is the filled-in text for text campaigns |
| POST | `/v1/crm/campaigns/:id/texted` | Text campaigns: `{ customerId, message?, texted?: false }`. Marks them texted (logs a `text` activity with `message`), or undoes it. The campaign turns `sent` when nobody is left. Returns the campaign |
| GET | `/v1/crm/campaigns/links` | `{ links, site }`. Link: `{ id, name, channel, source, medium, campaign, url, createdAt, leads, bookings, revenue }`. `leads`: people (quote requests and customers) whose first visit carried the link's `utm_source` and `utm_campaign`; `bookings`: their jobs, not cancelled; `revenue`: their done jobs |
| POST | `/v1/crm/campaigns/links` | `{ name, channel, source, medium, campaign }` (201). The three tags are lower-cased, spaces become dashes, letters, numbers, `-`, `_`, `.` only. 409 if `source` + `campaign` is already used. `url` is `https://www.kedservice.com/?utm_source=…&utm_medium=…&utm_campaign=…` |
| PATCH | `/v1/crm/campaigns/links/:id` | `{ name }` |
| DELETE | `/v1/crm/campaigns/links/:id` | 204 |
| GET | `/v1/crm/campaigns/settings` | `{ settings: { referrerGets, friendGets, reviewUrl, done }, siteReviewUrl }`. `reviewUrl` null means the website's review link (`siteReviewUrl`, from the Website tab, else the built-in one) |
| PUT | `/v1/crm/campaigns/settings` | Any of `referrerGets`, `friendGets` (≤ 80; blank restores the default "$20 off …"), `reviewUrl` (http(s) URL or null) |
| GET | `/v1/crm/campaigns/referrals` | `{ referrerGets, friendGets, leaders: [{ id, name, phone, code, link, referred, becameCustomers, revenue }], linked, saidFriend, site }`. `saidFriend`: customers who picked "a friend" but came without a link |
| GET | `/v1/crm/campaigns/referrals/:customerId` | `{ id, name, phone, code, link }`, making their code if they had none |
| GET | `/v1/crm/campaigns/reviews` | `{ reviewUrl, siteReviewUrl, toAsk: [{ jobId, customerId, name, phone, date, service, onToday }], recent: [{ name, at }] }`. `toAsk`: each customer's latest done job in the last 60 days, unless they had a `review_request` in the last year or the job's review follow-up is done. `phone` is null if they don't want texts. `onToday`: an open review follow-up exists |
| POST | `/v1/crm/campaigns/reviews/asked` | `{ jobId, how?: 'text' \| 'in_person' }`: logs a `review_request` on their timeline |
| GET | `/v1/crm/campaigns/playbook` | `{ month, zips: [{ zip, town, jobs, customers, revenue, share }], nearbyOpen: [{ zip, town, jobs }], streets: [{ street, zip, town, jobs, customers, last }], channels: [{ source, name, people, recent, booked, state: 'untried' \| 'no-bookings' \| 'working', tryIt, links }], seasons: [{ key, title, text, template?, now }], checklist: [{ key, title, text, every: 'once' \| 'week' \| 'month', doneAt, done }] }`. From done jobs in the last two years. A weekly item counts as done for 7 days, a monthly one for 31 |
| POST | `/v1/crm/campaigns/playbook/done` | `{ key, done }`: tick or untick a checklist item |

**Campaign shape**: `id`, `name`, `template`, `segment`, `channel`, `subject`,
`body`, `status` (`draft`, `sending`, `sent`), `createdAt`, `updatedAt`,
`sentAt` (when it started), `stats: { total, queued, sent, failed, skipped,
bookings, bookedValue }`. `bookings` counts jobs (not cancelled) booked by
people on it within 30 days after they got it.

**Placeholders** in `subject` and `body`: `{first}`, `{name}`, `{last
service}` (their last done package, "The" dropped), `{referral link}`,
`{quote link}` (`/quote/` with `utm_source=email|text&utm_campaign=<name>`),
`{you get}` and `{friend gets}` (the referral rewards). Every email gets the
unsubscribe footer and headers from `sendMarketingEmail`. Texts are never
sent by the server: open the Messages composer with `message`, then call
`/texted`.

### CRM: insights

Every number for a period, each with what to do about it, marketing spend by
channel, and the weekly plain-English note. Owner-only, all under
`/v1/crm/insights` (`api/src/crm-insights.ts`). See `docs/crm.md`. Money is in
cents, rates are 0–1, dates are `YYYY-MM-DD` in America/Chicago.

| Method | Path | What |
| --- | --- | --- |
| GET | `/v1/crm/insights` | `?from&to` (default the last 90 days, at most 3 years), `compare=0` to skip the previous period. One D1 batch (9 queries). Returns the object below |
| GET | `/v1/crm/insights/spend` | `?from=YYYY-MM&to=YYYY-MM` → `{ spend: [{ id, month, source, amount, note, createdAt, updatedAt }] }`, newest month first |
| POST | `/v1/crm/insights/spend` | `{ month: 'YYYY-MM', source, amount, note? }` (201). `source` is one of the CRM sources (`google`, `maps`, `instagram`, `facebook`, `nextdoor`, `referral`, `van`, `repeat`, `other`) |
| PATCH | `/v1/crm/insights/spend/:id` | Any of `month`, `source`, `amount`, `note` |
| DELETE | `/v1/crm/insights/spend/:id` | 204 |
| GET | `/v1/crm/insights/summary` | `?limit=1–20` (5) → `{ summaries, claude }`, newest first. `claude`: whether `ANTHROPIC_API_KEY` is set |
| POST | `/v1/crm/insights/summary` | "Make one now": writes, stores and emails the note for last week (Monday to Sunday) (201). Under 25 queries |

**Period**: the previous period is the same number of days just before, except
from the 1st of a month: this month so far compares with the same days last
month, whole months with the months before, and the year so far with the same
dates last year.

**GET /v1/crm/insights** returns:

- `period`: `{ from, to, days, compare: { from, to } | null, today }`.
- `money`: `cur` and `prev` totals (`revenue` from done jobs, `jobs`,
  `avgTicket`, `workDays`, `perDay`, `hours` (quoted, middle of the range),
  `perHour`, `addonRate`, `customers`, `cancelled`, `cancelledByCustomer`,
  `cancelledValue`, `cancelRate`, `online` (source `web`), `phone` (`app`));
  `books` / `booksPrev` (`hasBooks`, `collected` = all income in the books,
  `tips`, `expenses`, `advertising`, `profit`); `byMonth` (every month from
  the first job, zeros filled); `seasonality` (12 calendar months, `avgRevenue`
  over full months, null until a year of history); `weekdays` (`jobs`,
  `revenue`, `openDays`, `closed`, `jobsPerDay`, `fill` = jobs ÷ open days ×
  `maxJobsPerDay`); `services` (`jobs`, `revenue`, `share`, `avgTicket`,
  `addonJobs`, `addonRate`); `craft` / `craftPrev` (`boats`, `cars`); `sizes`
  (by vehicle class); `addOns` (`jobs`, `revenue` as quoted, `rate`).
- `customers`: `total` (1+ done job), `leadsOnly`, `new` / `newPrev` (first
  done job in the period), `served`, `returning`, `repeat`, `repeatRate`,
  `back6` / `back12` (`{ base, back, rate }`: second visit within 6/12 months
  of the first, among those whose first was that long ago), `avgVisits`,
  `lifetimeValue`, `avgDaysBetween`, `lapsed` (`{ count, atRisk, days: 180 }`,
  at risk = one visit each at their average ticket), `overdue` (`{ count,
  value }`: 2+ visits, nothing booked, 1.25× their usual gap), `top` (10 by
  spend in the period: `id, name, spend, visits, lifetimeSpend,
  lifetimeVisits, lastVisit, nextVisit, source, zip`), `top20` (`{ count, of,
  revenue, share }`), `cohorts` (first-visit quarter: `customers, cameBack,
  rate, avgSpend`).
- `sources`: per source (`unknown` when not recorded): `leads`,
  `leadsBooked` (marked booked, or a live job made after the request),
  `conversion`, `leadsPrev`, `newCustomers`, `newCustomersPrev`, `revenue`
  (their spend in the period), `customers`, `avgLifetimeSpend`, `repeatRate`,
  `spend` (marketing spend prorated by day), `costPerLead`,
  `costPerCustomer`, `newCustomerValue`, `returnOnSpend` (new customers'
  spend so far ÷ spend). `leads`: totals `{ leads, booked, conversion, prev }`.
  `referrers`: `{ id, name, referrals, referredRevenue }`.
- `zips`: `{ zip, town, miles (straight line from 63049), zone, travelFee,
  customers, repeatRate, avgTicket, lifetimeRevenue, periodJobs,
  periodRevenue, perHour }`; `towns`; `nearby` (ZIPs within 5 miles of a
  strong one with at most one customer: `{ zip, town, miles, customers, near,
  nearMiles }`).
- `pipeline`: `next30` (`jobs, revenue, hours, openHours, openDays, slots,
  use` = jobs ÷ slots, `hoursUse`), `emptyDays` (open days in the next 14
  with nothing booked), `openQuotes` (`count, value, oldestDays`: new or
  contacted in the last 60 days, nothing booked since), `period` (slots used
  in the chosen period), `maxJobsPerDay`.
- `spend`: `{ rows, total, booksAdvertising, notSplit }`.
- `actions`: up to 8, most dollars first: `{ id, type, title, detail, impact
  (cents or null), impactNote, target: { tab, label, segment? } }`. `type` is
  `reviews`, `rebook`, `area`, `pricing`, `schedule`, `channel`, `referral`,
  `upsell` or `leads`. `target.tab` is an admin tab (`today`, `leads`,
  `marketing`, `prices`, `insights`); `segment` is the customer filter it's
  about.

**Summary shape**: `id`, `weekStart`, `weekEnd`, `source` (`claude` or
`rules`), `model`, `body` (plain text: "How last week went:", "Do these 3
things this week:" with `- ` lines, "Stop doing this:"), `note` (why it fell
back to the rules), `inputTokens`, `outputTokens`, `emailed`, `createdBy`
(`cron` or the owner), `createdAt`. The cron (`runWeekly`, Mondays
`0 13 * * 1`) makes one a week and emails it to `ALERT_EMAIL`.

## Screens (v1)

A tab bar with five tabs: **Today · Schedule · Books · Inventory · More**. Today is the home screen: today's jobs with one big next-step button each, then a **Needs you** list (online bookings in the next week not yet texted a confirmation, which the phone remembers since the server doesn't track it; new leads, finished jobs not yet paid, things for the books, products running low), each a tap from being dealt with, and a look at tomorrow.

- **Today**: today's jobs in order. Each shows the customer, vehicle, address and
  quoted range. Tap an address for directions in Apple Maps (a `Linking` URL,
  no map SDK needed). There's a big "Start" / "Done" action per job.
- **Job**: the details, notes, before/after photos (`expo-image-picker` with the
  camera) and the price. **Found something?** offers an add-on from the job
  screen: pick from `suggestions` or type one, snap a photo, write what he
  found, then text the link. Answers arrive as a push. **Get paid** runs Tap to Pay, or sends an invoice link.
  Marking a job done asks what product was used, pre-filled from the package.
  The next step (Start job / Mark done) is one big button at the top. Once
  it's started, a short **Finish up** checklist follows: get paid (they paid
  me, or text them a bill), what you used, log the drive. Each ticks itself
  off from the books, the job's usage and the mileage log. Jobs he hasn't
  started can be cancelled, with a confirm.
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
- **Books** (its own tab; Leads live in Today as a count with a list behind it):
  - *Overview*: this month's income, expenses and profit; what's in each money
    account; and "N bank lines to sort", which opens the waiting list.
  - *Add expense*: amount, category (with the hint under each name), paid from,
    who it was paid to (type-ahead on payees), and an optional job. Snap the receipt
    first, upload it to `/v1/photos?kind=receipt`, and pass its `id` as
    `receiptKey`.
  - *Mark paid* on a finished job: amount (prefilled from the quote), how
    (cash / check / Zelle / card) and where it went. It posts `/books/income`
    with the `jobId`.
  - *Bank*: "Import from Commerce": pick the QFX from Files or the share sheet
    (`expo-document-picker`, and register the app for `.qfx` / `.ofx` / `.qbo`
    / `.csv` so the Commerce app can share straight into it). Preview it with
    `readBankFile` and upload it. The result screen says what happened in
    plain words: "34 new: 20 matched, 9 filed by your rules, 5 need you." Then
    work through the waiting lines, one card per line: the suggestion
    pre-selected (swipe right to accept), "That was personal", "Pick
    category", "Transfer to…", "Ignore". Every choice teaches the books, so
    say so the first time: "Next time AutoZone files itself."
  - *Weekly check-in*: a local notification every Sunday evening (no server
    push needed), "3 things for the books", when `/books/inbox` `total` > 0.
    It opens one screen that walks through the waiting lines, missing receipts,
    drives to log and unpaid jobs, in that order. The Books tab badge is
    `total`.
  - *Auto-filed*: a quiet list of what his rules filed this week
    (`autoFiled`). Tapping one lets him void it and re-file it.
  - *What the books have learned*: the rules list, under Books settings, with
    swipe-to-forget.
  - *Mileage*: after a job is marked done, offer "Log the drive?" prefilled with
    the job's address and purpose. Plus manual entry.
  - *Reports*: profit and loss by month or year, a tax summary by Schedule C
    line, mileage, and contractors. Plus Export, which opens the share sheet
    with the CSVs.
  - *Books settings*: mileage rate per year ("the IRS rate for 2026", not
    "centsPerMile"), sales tax (off), 1099 threshold, and "Ask for a receipt
    over $75" (`receiptPromptOver`). After any expense at or over that amount,
    including one filed from the bank, prompt "Snap the receipt?".
  - To fix a mistake: "Void" on an entry, with a confirm dialog explaining that
    history is kept. There's no delete button anywhere in the books.
- **More → Booking**: online booking on/off, hours for each day (or closed),
  jobs per day, time between jobs, notice needed, how far ahead. Validate with
  `validateRules` before saving to `PUT /v1/settings/booking`. Label everything
  in his words: "Time between jobs", not "bufferMinutes".
- **More → Settings**: sign out, app version, pricing version.

The app does everything the web admin does, so Jacob can run the whole
business from the van. The CRM screens use the CRM endpoints above:

- **Follow-ups** (Today and More → Follow-ups): the due list sits in Today's
  **Needs you**. A text follow-up opens the Messages composer with `message`,
  then calls `/texted`. Call, done, skip, snooze and reopen are one tap each.
  More → Follow-ups has upcoming, sent and done, "Check now", his own
  reminders, and the rules' settings in his words.
- **Customers** (More → Customers): the CRM list with a segment filter (who,
  spend, visits, last visit, source, tags, can email or text) and sort, CSV
  export through the share sheet, and duplicates to merge. A customer's page
  is the CRM profile: their numbers, open follow-ups, referral link to share,
  tags, source, consent and who referred them, and the timeline, where he
  adds a note, call or text and edits or removes his own.
- **Marketing** (More → Marketing): campaigns from a template or scratch,
  with the preview and who gets it. An email campaign sends in batches while
  the screen is open. A text campaign is a list to work through in Messages,
  each marked texted. Also tracking links with their QR code and results,
  referrals (rewards and leaders), reviews to ask for, and the playbook.
- **Insights** (More → Insights): the period's numbers with the previous
  period, the ranked **Do this** list (each opens the screen it's about),
  marketing spend by month and channel, and the Monday notes with "Make one
  now".
- **Website** (More → Website): the site's words and photos, as in the web
  admin's Website tab. Photos come from the camera roll, shrunk to JPEG and
  sent to `POST /v1/site/photos`. Saving rebuilds the site.

Out of scope for v1: multiple staff, recurring maintenance plans, Android. **Payroll is deliberately never built here.** When Jacob hires
an employee, he connects a payroll service (Gusto or similar), and its totals
get recorded in the books as expenses. Contractors are covered: payees with
`kind: 'contractor'`, and the 1099 report.

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

A **light look** (More → Settings) is there for full sun: the same tokens as a
paper sheet (off-white ground, near-black text, gold darkened to `#a8740f` so it
reads on white). Dark stays the default.

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
3. Books: the screens above, against the live books API. This replaces
   QuickBooks.
4. Stripe: invoices and pay links first, then Tap to Pay. Payments post into
   the books automatically.
5. Inventory and scanning, then product use per job.
6. Import Housecall Pro's and QuickBooks' data, cut over, and cancel both.

---

### Snippet for the mobile repo's CLAUDE.md

```md
## Spec

The app spec, API contract and design rules live in the website repo:
https://github.com/brettmboggs/ked-detailing/blob/main/docs/mobile-app.md
(locally: ../ked-detailing/docs/mobile-app.md). Read it before starting work.

- Pricing, scheduling and books: never reimplement. `src/vendor/pricing`,
  `src/vendor/scheduling` and `src/vendor/books` are vendored from
  ked-detailing/packages. Don't edit them. Run `npm run sync:shared`.
- The backend is the Worker in ked-detailing/api. If the app needs an endpoint
  that isn't in the spec, change the spec there first.
```
