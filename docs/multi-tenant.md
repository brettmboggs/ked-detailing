# Turning this into a product for other detailers

Not now. Brett's call (2026-09-25): prove it with Knock Em' Down first, at
$0 a month. Once it's used every day and earning its keep, rework it so
other detailers can sign up. This file is the map for that day, so nobody
has to rediscover it.

Every spot in the code that assumes one business is tagged `TENANT:`.
Find them all with:

```sh
grep -rn "TENANT:" api/src src packages api/wrangler.jsonc
```

## What "one business" means today

One Worker, one D1 database, one KV namespace, one Pages site, one set of
config vars. No table has a business id, and a signed-in session doesn't say
which business it's for. Everything below follows from that.

## The work, split by how hard it is

**Mechanical: large, but routine.**

- Add `business_id` to every table (about 30) and to every query that reads
  or writes them. Unique constraints become per business: invoice numbers,
  barcodes, bank line fingerprints, bank rules, referral and unsubscribe
  codes, tracked links, import refs. Invoice numbering
  (`COALESCE(MAX(number), 1000) + 1`) counts per business.
- `settings` rows are keyed by name alone ('booking', 'books', 'crm', 'site',
  'marketing'). Make the key (business, name). `pricing_configs` versions
  per business too.
- The chart of accounts is seeded once in SQL, and the code refers to fixed
  ids like `income-tips`, `owner-draws` and `checking`. Seed it per business
  and keep those ids working, e.g. as (business, id).
- Move the business's own details out of the code into a business profile
  row: name, phone, owner's first name, sign-off, time zone, review link,
  home ZIP. They're hard-coded in `notify.ts`, `manage.ts`, `invoices.ts`,
  `extras.ts`, the CRM files (templates and sign-offs name Jacob) and the
  site's `src/data/site.ts`.
- KV keys get a business prefix. **Do this before a second business exists:**
  the site photo sweep in `api/src/site.ts` deletes every `site/` key that
  this business's site doesn't use, so it would wipe another business's
  photos.
- Per-business config instead of `wrangler.jsonc` vars: owner list, URLs,
  alert addresses.

**Hard: needs decisions, not just typing.**

- **Accounts and sign-in.** Users, which businesses they belong to, and
  roles, plus a super-admin (Brett). Today an "owner" is anyone on one
  allowlist.
- **Which business a public request is for.** The quote, booking, pay,
  approve and unsubscribe pages need to know the business from the domain or
  a slug, and CORS has to allow each business's domain.
- **Their websites.** The site is one static Astro build. Options: one Pages
  project per business built from the same code, or render the public pages
  on demand on Workers, keyed by hostname. The admin, pay, booking and
  approve pages have to stop assuming Knock Em' Down either way.
- **Email.** Each business needs a sending domain verified with Resend.
  Cloudflare's own email sending only works to verified addresses.
- **Payments.** Stripe Connect, so each detailer gets paid into their own
  account.
- **Crons.** The daily, weekly and hourly jobs each handle "the" business.
  They'd have to loop over businesses, or queue a job for each, in each
  business's own time zone, and within the free plan's 50 queries per run.
- **Local knowledge.** Insights uses a table of St. Louis ZIP codes, and the
  price list and books have Missouri travel zones and merchant rules. Other
  areas need a geocoding source.
- **Moving Knock Em' Down's live data over** without downtime.

## A shortcut worth weighing first

Instead of a `business_id` column everywhere, give each business its own D1
database. The queries barely change: a small layer picks the database for
the request. That skips most of the mechanical work, and it keeps each
detailer's data physically separate, which is easier to explain to them. The
cost: migrations run once per database, and reports across all businesses
need their own path. Decide this before starting; it changes most of the
list above.

## Rules for code written before then

These cost nothing now and make the move cheaper later:

- Keep business details in one place per side (`src/data/site.ts`, and a
  single constant per API file tagged `TENANT:`). Don't scatter new copies of
  the phone number or name.
- New KV keys: pick a prefix that a business id can go in front of.
- New public links: random tokens, as now, never sequential ids.
- New crons: write them as "do this for a business", called once, so they
  can be called per business later.
