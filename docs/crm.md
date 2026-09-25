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
