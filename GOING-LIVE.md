# Going live

Everything between "the build is finished" and "kedservice.com serves it".
Jacob's half is written to be pasted into a message unchanged — see
[Jacob's steps](#jacobs-steps).

**Host: Cloudflare Pages.** The goal is to end the recurring bills, not move
them. Pages is free, Email Routing is free, and Cloudflare Registrar renews a
domain at cost if the registration follows later. Netlify was tried and reverted;
NOTES.md records why.

Cloudflare Pages serves an apex domain only when the domain is a zone on the
Cloudflare account, so the nameservers move off Squarespace. That is the one
thing Jacob has to do, and it is two values on one screen.

## Already done in this repo

- `npm run verify` passes clean — type check and build, 8 pages.
- `public/_redirects` carries the 301 map and Cloudflare reads it natively.
  Cloudflare follows a rule even when a static asset matches the same path, so
  the meta-refresh stubs `astro.config.mjs` emits at those paths never shadow it.
  **Do not add Netlify's `!` force suffix** — Cloudflare accepts only
  301/302/303/307/308 and would drop every line as invalid, silently breaking the
  only thing carrying the old site's search ranking.
- No manual `noindex` step. `Base.astro` derives it from `BASE_URL`, so the
  production build has never carried it, and `src/pages/launch.astro` renders as
  a pointer home if it ships live.
- `.nvmrc` pins Node 22, which Cloudflare's build image reads.

## Step 1 — Brett: the Cloudflare zone

Do this before the Pages project. The zone is what produces the two nameservers
Jacob needs, and nothing can be asked of him until they exist.

1. **dash.cloudflare.com** → sign up, free.
2. **Add a domain** → `kedservice.com` → **Free** plan.
3. Cloudflare scans the existing DNS and shows what it found. **Read that list
   before continuing.** Anything for Google Search Console or Housecall Pro
   verification has to survive the move; the scan is best-effort, so add by hand
   anything missing. There has never been an MX record on this domain, so mail
   cannot break.
4. Cloudflare then shows **two nameservers**, of the form
   `something.ns.cloudflare.com`. Those are the values for Jacob. Copy them
   somewhere you can paste from.

## Step 2 — Brett: the Pages project

1. **Workers & Pages** → **Create** → **Pages** → **Connect to Git** →
   `brettmboggs/ked-detailing`, branch `main`.
2. Framework preset **Astro**, build command `npm run build`, output directory
   `dist`. If the build picks the wrong Node, add `NODE_VERSION` = `22` as a
   build environment variable.
3. Deploy, then open the `*.pages.dev` URL and check the site.
4. **Custom domains** → add both `kedservice.com` and `www.kedservice.com`.
5. Add one **Redirect Rule** sending the apex to `https://www.kedservice.com`,
   301, preserving the path. Every canonical tag in the build points at `www`
   (`site` in `astro.config.mjs`), so this makes the served URL agree with what
   the pages claim. Both hosts will answer without it; they just both answer.

Both custom domains read "pending" until step 3. Expected.

## Step 3 — Jacob: the nameservers

He pastes the two values from step 1 into Squarespace. His instructions are
below, and the published page sent to him carries the same thing formatted.

Brett cannot do this. `account.squarespace.com/domains/managed/kedservice.com`
returns **Access Denied** on his login, confirmed twice. Squarespace grants the
domain owner alone.

## Step 4 — Brett, once Cloudflare says Active

- Confirm the apex, `www` and HTTPS all resolve. Certificates are automatic.
- Spot-check the redirects: `/home`, `/cart`, one `/blog/tag/*`, and all three
  blog post slugs. They should be real 301s.
- Submit `https://www.kedservice.com/sitemap-index.xml` in Search Console and
  watch Coverage for a fortnight.
- **Email Routing** → add `hello@kedservice.com` forwarding to the Gmail, then
  set Gmail "send as" so replies come from the branded address. Free, five
  minutes, and it is only free because the nameservers are already here.
- Delete `src/pages/launch.astro` once Jacob has read it.

---

## Jacob's steps

> Copy from here down. Fill in the two nameservers from step 1 first.

### Why it has to be him

`kedservice.com` is registered on his Squarespace account, and Squarespace lets
only the account holder change where the address points. Until it changes, the
address keeps serving the old site.

Three things worth saying up front, because they are what he will ask:

- **No gap.** The new site is live and tested before he touches anything.
- **It is reversible.** Two text boxes; putting the old values back undoes it.
- **Email is untouched.** He uses Gmail, and the domain has never carried mail.

### The change

1. Go to `account.squarespace.com` and log in.
2. Click **Domains**.
3. Click **kedservice.com**.
4. Click **DNS**, then **Domain Nameservers**.
5. Click **Use custom nameservers**.
6. Re-enter the password. It asks for the 2FA code too, if that is switched on.
7. It warns about DNSSEC. Click **Continue** — it has to come off for this to
   work, and Cloudflare sets its own up afterwards.
8. Paste the first value into **Nameserver 1** and the second into
   **Nameserver 2**.
9. Click **Save**, and say when it is done.

```
Nameserver 1   ________.ns.cloudflare.com
Nameserver 2   ________.ns.cloudflare.com
```

### Then wait

Usually under an hour, occasionally up to 48. Nothing to do.

### Only then, cancel Squarespace

Wait for confirmation the new site is live.

**The part that matters:** if the domain came free with the annual plan,
Squarespace asks during cancellation whether to let it expire or convert it to a
paid registration, around $20/year. **Always choose to keep it.** Letting it
expire loses the address and everything Google has indexed against it, and
anyone can register it afterwards.

Cancel the *website* plan only. Say so beforehand, so the newsletter list can be
exported if anyone ever signed up — it goes with the account.

### Editing merch and blog posts himself

Blocks nothing, and only works once Pages is connected, because the tool saves by
committing to the repo.

1. Free account at `github.com` — username, email, password.
2. Send the username over.
3. Accept the invitation email.
4. Sign in at `app.pagescms.org` with that account and pick the site.

Two lists, *Merch* and *Notes*. Fill in a form, save, and the site rebuilds
itself. Every entry has a hide switch for staging privately.

### Ten minutes worth more than the website

Separate from the site and more urgent. At `business.google.com`:

- **Hours** — the profile reads *Closed*. If he works seven days, set seven days.
- **Service area** — set to Chesterfield only. He works St. Louis, St. Charles
  and Jefferson County.
- **Categories** — car detailing only. Add boat detailing; marine is in the
  registered business name.

Squarespace analytics showed 207 visits in 30 days, 78% direct. Search is
contributing almost nothing, so the profile is upside rather than maintenance.

---

## Later, optional

**Move the registration to Cloudflare.** Renews at cost, around $10/year against
Squarespace's $20, and puts domain and DNS in one account. Needs Jacob to unlock
the domain and hand over an auth code, and takes 5–7 days. Not during the
cutover — a registrar transfer and a nameserver change at once makes any failure
harder to read. Do it once the site is settled.
