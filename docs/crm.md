# KED CRM

Jacob's customer relationship system, inside the web admin
(`kedservice.com/admin`). Goal, in Brett's words: Jacob sees who spent the
most, every metric that matters, how to find more leads, where to market, how
to keep recurring business, and who to follow up with, so he runs the
business methodically instead of from memory.

**Every number must come with what to do about it.** A metric Jacob can't act
on is noise. Each insight pairs the fact with one plain next step ("12 people
are due for their 3-month detail: text them today", "Instagram brought 9
leads and 1 booking; Google Maps brought 4 and 4: put your time into your
Google profile").

## Decisions (Brett, 2026-09-25)

- **Outreach:** automatic email from kedservice.com through **Resend's free
  plan** (3,000/month, 100/day), plus **one-tap texts**: the admin opens
  Messages with the text written, Jacob sends from his own phone. $0.
- **Insights:** numbers and fixed rules do the work; a **weekly plain-English
  summary from Claude** (about $1/month) on top.
- Texts are never sent automatically. Marketing email is opt-out, with a
  working unsubscribe link in every one (CAN-SPAM).

## The foundation (built; don't rebuild it)

| Piece | Where |
| --- | --- |
| Tables: `activities`, `follow_ups`, `campaigns`, `campaign_sends`; CRM columns on `customers`, `leads`, `jobs` | `api/migrations/0012_crm.sql` |
| Where people came from: `source` (fixed list), `sourceDetail`, `attribution` (UTM, referrer host, landing path, first visit, `ref` code) | `api/src/attribution.ts`; the site records first touch in `src/scripts/attribution.ts` and /quote asks "How did you hear about us?" |
| Every quote request is a CRM person (`leads.customer_id`) | `api/src/leads.ts` |
| Referral codes: every new customer gets one; `?ref=CODE` on any page links the new customer's `referred_by` | `api/src/customers.ts` (`referralCode`) |
| Customer numbers and segments: visits, spend, average ticket, first/last/next visit, services, ZIP, referrals; filter by lifecycle (lead, customer, repeat, lapsed), spend, visits, dates, services, ZIP prefix, source, tags, consent | `api/src/crm-segments.ts` (`STATS_CTE`, `readSegment`, `segmentCustomers`). `GET /v1/crm/customers?segment=<json>` |
| Timeline writes | `api/src/crm-activity.ts` (`logActivity`, `activityStatement`) |
| Customer email: `sendEmail` (service mail) and `sendMarketingEmail` (checks consent, adds unsubscribe link and headers, logs to the timeline) | `api/src/crm-email.ts`. `mailCustomer` in `notify.ts` now uses Resend too, so booking confirmations to customers work for free once the key is set |
| Routers | `crm-customers.ts` (`/v1/crm/customers`), `crm-followups.ts` (`/v1/crm/follow-ups`, `runDaily`), `crm-insights.ts` (`/v1/crm/insights`, `runWeekly`), `crm-campaigns.ts` (`/v1/crm/campaigns`), `crm-public.ts` (`/v1/crm/public`, no sign-in). Owner routers apply `requireOwner` themselves |
| Cron | `wrangler.jsonc` triggers: daily `0 14 * * *` → `runDaily`, weekly `0 13 * * 1` → `runWeekly` (`scheduled` in `index.ts`) |
| Admin tabs | `today`, `insights`, `marketing` (stubs) plus the existing `customers`, in `src/scripts/admin/` |

**Sources:** `google` (search), `maps` (Google Maps/Business Profile),
`instagram`, `facebook`, `nextdoor`, `referral`, `van`, `repeat`, `other`.

**A job's value** is `final_price`, else the quote's `total`. Only `done`
jobs count as visits and spend (imported history included).

## Who builds what

Four parts, built in parallel. Each owns its files; nobody edits another's.

1. **Customers & timeline** (`crm-customers.ts`, `customers.ts`,
   migration `0013_*`, admin `customers*.ts`): the customer list as a CRM
   (filters/segments, sort by spend etc., CSV export), the customer profile
   (numbers, timeline, notes, log a call, tags, source, consent, referral
   code and who they referred, jobs, invoices), and lead-only people.
2. **Follow-ups & email** (`crm-followups.ts`, `crm-public.ts`, migration
   `0014_*`, admin `today*.ts`, `src/pages/unsubscribe.astro`): the daily
   rules, the Today list, one-tap texts, automatic emails, unsubscribe.
3. **Insights** (`crm-insights.ts`, migration `0015_*`, admin `insights*.ts`):
   every metric with its action, marketing spend and cost per customer by
   source, the weekly Claude summary.
4. **Marketing & campaigns** (`crm-campaigns.ts`, migration `0016_*`, admin
   `marketing*.ts`): campaigns to a segment by email or text list, tracking
   links and QR codes for each channel, the referral program, review requests
   toolkit, the lead-finding playbook tied to his own data.

Shared files (`crm-segments.ts`, `crm-email.ts`, `crm-activity.ts`,
`attribution.ts`, `index.ts`, `admin/core.ts`, `admin/index.ts`,
`admin.astro`) change only through Brett's lead session. If one needs a
change, report it.

## Contract

Each part documents its endpoints in `docs/mobile-app.md` (the API contract)
under a **CRM** heading, one table per part.

## Turning on email

Until this is done, nothing emails customers: every follow-up shows on the
Today tab as a text for Jacob, and booking confirmations stay on-screen only.
It's free (Resend: 3,000 emails a month, 100 a day). Brett, about 15 minutes:

1. Sign up at [resend.com](https://resend.com) (free plan, no card).
2. **Domains → Add Domain**: `kedservice.com`, region North Virginia
   (`us-east-1`).
3. Resend lists DNS records (an MX and an SPF TXT on `send.kedservice.com`, a
   DKIM TXT on `resend._domainkey.kedservice.com`). In Cloudflare →
   kedservice.com → **DNS → Records**, add each one exactly as shown, with
   the proxy **off** (DNS only). They're on the `send` subdomain, so Email
   Routing's MX records for `kedservice.com` stay as they are. If there's no
   `_dmarc` TXT record yet, add one: `v=DMARC1; p=none;` (Gmail and Yahoo
   want it).
4. Back in Resend, press **Verify DNS Records** and wait for "Verified"
   (minutes, sometimes an hour).
5. **API Keys → Create API Key**: name `ked-api`, permission "Sending access",
   domain `kedservice.com`. Copy it, then:
   ```sh
   source ~/.nvm/nvm.sh && nvm use 22 && cd /home/brett/dev/ked-detailing/api \
     && npx wrangler secret put RESEND_API_KEY
   ```
   and paste the key.
6. Check it: on the admin's Today tab the "email isn't set up" line is gone.
   Press **Check now**; anything due goes out, and shows under "Sent
   automatically this week".

Mail comes from `Jacob at Knock Em' Down <jacob@kedservice.com>`
(`CUSTOMER_MAIL_FROM` in `api/wrangler.jsonc`) and replies go to Jacob's
Gmail (`REPLY_TO`). The follow-up rules keep to 80 emails a day by default
(a setting on the Today tab), leaving room for booking confirmations under
Resend's 100.

## Turning on the weekly summary

Every Monday morning (cron `0 13 * * 1`, `runWeekly` in
`api/src/crm-insights.ts`) Insights writes a short note to Jacob: how last
week went, three things to do this week, one thing to stop. It's saved (the
top of the Insights tab) and emailed to `ALERT_EMAIL` through Cloudflare
Email Routing, like booking alerts. **Make one now** on the Insights tab
does the same on demand.

Without a key the note is built from the numbers and the fixed rules alone,
and says so. To have Claude write it in plain words (Brett, 5 minutes):

1. [console.anthropic.com](https://console.anthropic.com) → **API Keys →
   Create Key**, name `ked-weekly`. Add a small prepaid credit (the minimum
   is plenty for years) and, under **Limits**, a monthly cap of $5.
2. ```sh
   source ~/.nvm/nvm.sh && nvm use 22 && cd /home/brett/dev/ked-detailing/api \
     && npx wrangler secret put ANTHROPIC_API_KEY
   ```
   and paste the key.
3. On the Insights tab press **Write a new one now**. The line under the note
   should say it was written by Claude.

**Model and cost:** `claude-opus-5` at low effort, `max_tokens` 3,000, with
the API's server-side fallback on. Each note sends about 2–3k tokens of
totals and gets back about 1–2k, so a few cents a note: roughly $0.25 a
month, well under the $1 budget even with extra "make one now" presses.

**What Claude sees:** totals, rates, sources and the ranked actions (which
can name a ZIP), plus the first names (only) and spend of the three best
customers of the last 90 days. Never phone numbers, emails, addresses or
last names. The exact numbers sent are stored with each note
(`insight_summaries.numbers`).

**Marketing spend** (Insights → Marketing spend) is a small table of its
own, `marketing_spend` (month, channel, amount, note), not a tag on book
entries: entries are never edited, only voided, and one ad bill often
covers several channels. The books' Advertising total is shown beside it so
anything not split out yet is visible.
