# Cutover: leaving Housecall Pro, QuickBooks and Squarespace

How Knock Em' Down moves onto KED with no customer dropped, no record lost
and no month paid twice. Written 2026-10-15. Jacob's plain version is the
"How the switch goes" part of his switch page
(https://claude.ai/artifact/2qn3d9MrQXxApUWkTroT1p).

The rules:

- **Data moves before anything is switched, and switching happens before
  anything is cancelled.** Housecall Pro stays paid as a backup until KED has
  run the business on its own for two weeks.
- **One line in time for the books.** QuickBooks keeps everything up to
  the cutover date; KED owns everything after it. Nothing gets entered in both.
- **Cancel each service just before its next renewal**, never mid-term on an
  annual plan, and never before its data is downloaded.
- **Undo is one setting:** until Housecall Pro is cancelled,
  `bookOnHousecall: true` in `src/data/site.ts` sends the Book buttons back.

## 0. Before: nothing changes for customers (this week)

**Find the dates and the extras.** On the call with Jacob, get for each of
Housecall Pro, QuickBooks and Squarespace: the plan, monthly or yearly, the
next renewal date, and whether canceling ends access at once or at the end of
the paid term. Then ask whether he uses any of these in Housecall Pro, since
none of them come across in a CSV:

| If he uses | Plan |
| --- | --- |
| A Housecall Pro **phone number** customers call or text | Port it to a carrier before cancelling, or it's gone |
| **Recurring jobs or service plans** | List them; make each one's next visit in KED by hand |
| **Saved customer cards** | Can't be moved (card rules). Those customers pay by link the first time |
| **Open estimates** | Re-send as KED quotes |
| **Job photos** he wants to keep | Download them; the export doesn't include photos |
| **Payments still paying out** | Leave them; they land in Commerce like normal |

**Get KED ready:**
- Jacob saves real prices and hours in the admin.
- Stripe Connect is live and a $1 charge and refund worked both ways
  (`docs/stripe-connect.md`).
- Jacob's mom and aunt have seen the Books reports and know where things are.

**Dry run.** Jacob exports Housecall Pro customers and jobs and the
QuickBooks Journal (all dates). Run each import **without** `--go`
(`packages/import`, steps in HANDOFF.md) and check:
- Customer count and upcoming job count match what Housecall Pro shows.
- Every QuickBooks account is mapped in `journal.csv.map.json`.
- After a test import into a local database: KED's profit and loss for each
  year matches QuickBooks' to the cent, and the bank and card balances on the
  last day match.

Fix anything that doesn't match before picking a date.

## 1. Pick the date

The **first of a month**, so QuickBooks holds whole months and KED starts a
clean one. That makes the statements easy for his mom and aunt. With today's
date, **November 1** works if the dry run is clean by October 28. Pick a quiet
morning, and plan on an hour on the phone with Jacob.

## 2. Cutover day

In this order:

1. **Fresh exports:** Housecall Pro customers and jobs, and the QuickBooks
   Journal through the day before.
2. **Import with `--go`.** Recheck the counts and the balance on the last day.
3. **Note every unpaid Housecall Pro invoice.** Each one is either collected
   in Housecall Pro during the two weeks (its links still work) or voided
   there and re-sent from KED. Decide per invoice, now.
4. **Switch the site:** `bookOnHousecall: false`; `PAY_URL` and `MANAGE_URL`
   to kedservice.com; Brett deploys and pushes.
5. **Move outside links off Housecall Pro:** the Google Business Profile
   booking link, Instagram and Facebook bios, Yelp, Nextdoor, any email
   signature or saved text replies.
6. **Quiet Housecall Pro** so customers don't get two of everything: online
   booking off, automatic reminders, "on my way" texts and review requests
   off, and any sync from Housecall Pro to QuickBooks off.
7. **Freeze QuickBooks:** bank feed off, no new entries from here on.
8. **Optional:** text each upcoming customer their KED booking link
   (`POST /jobs/:id/confirmation` gives the text) so they can see or move
   their visit.

## 3. Two weeks side by side

- Every new booking shows up in KED. Check Housecall Pro daily; it should get
  nothing new. If something does come in, add it to KED.
- At the end of the first week, Jacob uploads the first Commerce Bank file
  starting on the cutover date. Housecall Pro payouts for old jobs show up as
  deposits; file them as payments on those jobs.
- If anything is wrong and can't be fixed the same day, flip
  `bookOnHousecall` back and sort it out.

## 4. Close out

**Housecall Pro** (just before its renewal, once the two weeks are clean):
one last export of customers, jobs and invoices (as PDFs if he wants them),
plus photos and the unpaid-invoice list. Then cancel, save the confirmation,
and check next month's card statement for a charge.

**QuickBooks:** download, for every year in it, the profit and loss, balance
sheet, general ledger and 1099 reports, as both PDF and Excel. Put them in a
shared folder for Jacob, his mom and his aunt. Then cancel before renewal.
After canceling, QuickBooks Online keeps a year of read-only access, then
deletes the data, so the downloaded files are the permanent copy.

**Squarespace:** export the newsletter subscribers, then cancel the
**website** plan. Keep the **domain** (about $20 a year) until it moves to
Cloudflare ("Later, optional" in GOING-LIVE.md).

## What carries over

| Data | How |
| --- | --- |
| Customers (name, phone, email, address, notes) | Housecall Pro export → import |
| Upcoming jobs | Housecall Pro export → calendar |
| Past jobs | Housecall Pro export → `history` (no payment or mileage asked) |
| All the books, every year | QuickBooks Journal → ledger, mapped to KED's accounts |
| Reviews | Stay on Google; nothing to move |
| Photos, open estimates, recurring plans, saved cards | By hand (table in step 0) |
