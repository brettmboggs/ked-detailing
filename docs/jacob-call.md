# Call with Jacob: everything only he can do

This is Brett's version, with the why behind each step. **Jacob follows
[jacob-steps.md](jacob-steps.md)**, the same jobs in plain words with nothing
to decode. Send him that one.

Work top to bottom. Part 1 unblocks the most. Nothing here cancels or breaks
anything live: Housecall Pro, QuickBooks and Squarespace all keep running until
the full switch-over.

**Brett, before the call (10 min):**
- [ ] **TestFlight, before the call:** get Jacob's Apple ID email from him by
      text. In App Store Connect → KED → TestFlight, add him as a tester. An
      external tester needs Apple's one-time beta review first, which can take
      a day, so start early. Or make him an internal tester by adding him under
      Users and Access first, which needs no review.
- [ ] Cloudflare → `kedservice.com` → DNS: check the imported records include
      anything for Google (TXT `google-site-verification`) or Housecall Pro.
      Add any that are missing.
- [ ] Workers & Pages → `ked-detailing` → Custom domains: add `kedservice.com`
      and `www.kedservice.com` (they'll say "pending" until Jacob's step), and
      the apex → www redirect rule (GOING-LIVE.md, step 2).

---

## 1. Must do on the call

### Domain: 5 minutes, Squarespace login and his phone for the 2FA code
- [ ] `account.squarespace.com` → **Domains** → **kedservice.com** → **DNS** →
      **Domain Nameservers** → **Use custom nameservers**.
- [ ] Re-enter the password and 2FA code. At the DNSSEC warning, click **Continue**.
- [ ] Nameserver 1: `georgia.ns.cloudflare.com`
- [ ] Nameserver 2: `lou.ns.cloudflare.com`
- [ ] **Save.** It usually goes live within the hour, occasionally up to 48 hours.
- [ ] **Do not cancel Squarespace yet.** When he does, he must choose to *keep*
      the domain (about $20/yr), not let it expire.

*He'll ask:* no downtime, reversible by putting the old values back, and email
is unaffected (he uses Gmail and the domain has never had mail).

### The app: 5 minutes, his iPhone
- [ ] **The email on his Apple ID** (Settings → his name). It's needed for the
      TestFlight invite and to let his Apple sign-in through. If it isn't
      `knockemdowndetailing@gmail.com`, it gets added to the API allowlist.
- [ ] Install **TestFlight** from the App Store and accept the invite.
- [ ] Open KED and **Sign in with Apple**. Choose "Share my email" if he's
      asked, which lets the allowlist recognise him. If it still refuses, the
      error shows a code to add.

### Stripe: 15 minutes, has to be him because the payouts go to his bank
- [ ] Create an account at `stripe.com` in the business's name: **Knock Em Down
      Auto & Marine Detailing LLC**.
- [ ] Have ready: the **EIN** (or his SSN if the LLC doesn't have one), his date
      of birth and home address for ID checks, and **the Commerce account and
      routing number** for payouts.
- [ ] Settings → Team → **invite Brett as Developer**, so Brett can connect the
      API without Jacob sharing a password.

### Email
- [ ] **Which email does he actually read every day?** Booking alerts and
      customer replies will go there. (The site currently shows
      `knockemdowndetailing@gmail.com`.)

---

## 2. Numbers only he knows (answers, no logins)

### Prices: the quote page stays hidden until these are in
- [ ] **Base price for a sedan** for Level I, II, III and IV.
- [ ] **How much more** for a small SUV, a full-size SUV or truck, and a van or
      3-row (e.g. "+15%" or "+$40").
- [ ] **Extra charges:** pet hair (some / heavy), stains, smoke smell, heavily
      soiled interior, mud or sap outside.
- [ ] **Add-ons and their prices:** headlights, engine bay, sealant, trim, and
      anything else he offers.
- [ ] **Boats:** a price per foot, or how he prices them.
- [ ] **Minimum job**, and **travel:** where "free" ends, and what he charges beyond it.
- [ ] **Is he OK showing prices on the site?** The tool shows a range, e.g.
      "$245–$305", and "final price on inspection".

### Booking: how his calendar should fill
- [ ] Which **days and hours** he works.
- [ ] **Jobs per day** at most, and **time between jobs** for driving.
- [ ] **How long each package really takes** him.
- [ ] **Notice** needed (the same day? 24 hours?) and **how far ahead** people can book.
- [ ] Does he want a **deposit** to hold a slot?

### Money and taxes
- [ ] **Does he charge sales tax?** (Probably not; this just confirms it.)
- [ ] **Who does his taxes?** A CPA or tax preparer, or himself? That decides
      where the year-end export goes.
- [ ] **Vehicle:** does he claim **mileage**, or actual van costs (gas,
      repairs)? He can't freely switch between the two, so it's worth asking
      his tax person.
- [ ] Has he **paid any helpers** this year, and roughly how much? (That's
      1099 territory.)
- [ ] **Business and personal:** separate accounts, or one? Is his **credit card
      also Commerce?**

---

## 3. Getting his data out, so nothing is lost at the switch (nothing is cancelled)

- [ ] **Housecall Pro:** which plan, and the monthly cost. What does he actually
      use (invoicing, card payments, reminders, reviews, estimates)?
      **Export his customer list** (CSV), or share the login so Brett can.
- [ ] **QuickBooks:** which plan, and the monthly cost. Either invite Brett as a
      user (Settings → Manage users → **Accountant** access is free), or
      export Reports → **General Ledger** (this year, to Excel) and the
      customer list.
- [ ] **Commerce Bank:** download the last 90 days as **Quicken (.QFX)** for
      checking (and the card, if it's Commerce) and send them to Brett. This
      tests the import on real data before he relies on it.
- [ ] **Optional: automatic bank feed (Plaid)**, a few dollars a month instead
      of a weekly download. His call. It can wait.

---

## 4. Quick wins, if there's time

- [ ] **Google Business Profile** (`business.google.com`, 10 min, and worth
      more than the website right now): set **hours** (it currently says
      Closed), set the **service area** to St. Louis, St. Charles and Jefferson
      County (it's currently Chesterfield only), and **add "Boat detailing"** as
      a category. Or add Brett as a manager and he'll do it.
- [ ] **OK to show his 8 Google reviews with the customers' names** on the site?
- [ ] Squarespace: **export newsletter subscribers**, if any, before it's ever cancelled.
- [ ] Next boat job: **take photos**. Marine work has none on the site yet.
- [ ] Optional, later: if photos ever outgrow the free storage (years away),
      he adds **his own card** to Cloudflare R2. It's free under 10 GB. Nothing
      needed now.
- [ ] Optional: a GitHub account so he can post merch and blog entries himself;
      Instagram switched to **Professional** (20 min together later to connect
      the feed).

---

## After the call (Brett)

- [ ] Send Claude the answers from part 2. Prices and booking rules go straight
      into the settings, and the Apple email goes onto the allowlist.
- [ ] When `kedservice.com` goes live, remove `KED_NOINDEX` from the Pages
      project (GOING-LIVE.md, step 4). Then booking and bank-alert emails can
      be switched on.
- [ ] Nothing gets cancelled until everything has been switched over at once.
