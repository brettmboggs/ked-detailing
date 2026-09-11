# Going live

Everything between "the build is finished" and "kedservice.com serves it".
Jacob's half is written to be pasted into a message unchanged — see
[Jacob's steps](#jacobs-steps).

## Why Netlify and not Cloudflare Pages

NOTES.md recommends Cloudflare Pages. That recommendation predates the
constraint that actually decides this.

Cloudflare Pages will only serve an **apex** domain when the domain is a zone on
the Cloudflare account that owns the project, and Squarespace does not flatten
CNAMEs at the apex. So Cloudflare means moving nameservers off Squarespace —
handing over all DNS, disabling DNSSEC on the way, and taking a change that only
the domain owner is likely to be offered.

Netlify serves the apex from a plain **A record**. That reduces the cutover to
editing two records in the panel Squarespace already provides, which is:

- the smallest, most reversible change available;
- something a domain **manager** may be able to do without the owner, since
  Squarespace grants managers DNS-record access explicitly;
- the same two values whoever ends up pasting them.

Cloudflare is still the better long-term home if branded email is ever wanted —
Email Routing forwards `hello@kedservice.com` into Gmail for free. That needs the
nameserver move, so it is a deliberate second step once the site is settled, not
a launch blocker. Nothing here forecloses it.

## Already done in this repo

- `npm run verify` passes clean — type check and build, 8 pages.
- `netlify.toml` commits the build settings, so connecting the repo needs no
  configuration typed into the dashboard.
- `public/_redirects` rules are now **forced** (`301!`). Astro emits a
  meta-refresh stub at each of those paths as a fallback for hosts that ignore
  the file, and on Netlify a real file at a path beats an unforced redirect rule.
  Without the `!` every one of the old Squarespace URLs would have served the
  stub instead of a genuine 301, on the only paths carrying the old site's
  search ranking.
- The staging `noindex` needs no manual removal. `Base.astro` derives it from
  `BASE_URL`, so the production build has never carried it. `src/pages/launch.astro`
  guards itself the same way and renders as a pointer home if it ships live.

---

## Step 1 — Brett, at a browser

Ten minutes. Works on a phone if it has to; GitHub sign-in and the domain screen
are both usable on mobile.

1. **netlify.com** → sign up with GitHub.
2. **Add new site** → **Import an existing project** → **GitHub** →
   `brettmboggs/ked-detailing` → branch `main`.
   Build command, publish directory and Node 22 are read from `netlify.toml`.
   Nothing to fill in.
3. Let it build, then open the `*.netlify.app` URL and check the site.
4. **Site configuration** → **Change site name** → set it to exactly
   **`knockemdown`**.

   > This matters. `knockemdown.netlify.app` is the value already written into
   > Jacob's instructions. If the name is taken, pick another and correct the
   > CNAME value on his page before sending it.

5. **Domain management** → **Add a domain** → `www.kedservice.com`. Accept the
   prompt to add the apex `kedservice.com` too.
6. Set **`www.kedservice.com` as the primary domain**. Netlify then 301s the apex
   to `www`, which matches `site` in `astro.config.mjs` and the canonical tags.
   Both will read "awaiting external DNS" until step 2 — expected.

## Step 2 — the DNS change

| Type | Host | Value |
| --- | --- | --- |
| A | `@` | `75.2.60.5` |
| CNAME | `www` | `knockemdown.netlify.app` |

`75.2.60.5` is Netlify's load balancer, the documented apex target for external
DNS.

**Check whether you can do this yourself before asking Jacob.** Squarespace
grants domain managers DNS-record access, and being blocked from a *transfer*
does not imply being blocked from records. Open
`account.squarespace.com` → Domains → kedservice.com → DNS. If the records are
editable, the whole cutover is yours and Jacob is not needed. Thirty seconds to
find out, and it removes the only person on the critical path.

Either way the sequence is the same, and the first part is the trip hazard:
**Squarespace refuses new records while its own defaults are present.** Delete
the group labelled *Squarespace Defaults* (red trash can per row) first, then add
the two above. Leave every other record alone — any Google, Housecall Pro or
verification TXT record has to survive.

## Step 3 — Brett, after it propagates

- Confirm `kedservice.com`, `www.kedservice.com` and HTTPS all resolve. Netlify
  issues the certificate after DNS points at it, so expect a few minutes where
  the browser warns.
- Spot-check the redirects: `/home`, `/cart`, one `/blog/tag/*`, and all three
  blog post slugs. They should be real 301s now, not meta refreshes.
- Submit `https://www.kedservice.com/sitemap-index.xml` in Search Console, then
  watch Coverage for a fortnight.
- Delete `src/pages/launch.astro` once Jacob has read it.

---

## Jacob's steps

> Copy from here down. The published version of this, formatted and with copy
> buttons, is the page sent to him.

### Why it has to be him

`kedservice.com` is registered on his Squarespace account, and Squarespace only
lets the account holder change where the address points. Until that changes, the
address keeps serving the old site.

Three things worth saying up front, because they are what he will ask:

- **No gap.** The new site is live and tested before he touches anything.
- **It is reversible.** Two text entries; putting the old ones back undoes it.
- **Email is untouched.** He uses Gmail, and the domain has never carried mail.

### 1. Find the DNS screen

1. Go to `account.squarespace.com` and log in.
2. Click **Domains**.
3. Click **kedservice.com**.
4. Click **DNS**.

### 2. Delete the Squarespace defaults

There is a group headed **Squarespace Defaults**. Those point the address at the
old site, and Squarespace will not accept new records while they are there.
Click the red trash can beside each row in that group. Usually four or five
lines.

**Leave everything else alone.** Anything mentioning Google, Housecall Pro, or
carrying a long random string, stays. Screenshot and ask before deleting
anything uncertain.

### 3. Add two records

Click **Add record** twice.

```
Type   A
Host   @
Data   75.2.60.5
```

```
Type   CNAME
Host   www
Data   knockemdown.netlify.app
```

Leave TTL and Priority at whatever they already say. If the Host box rejects
`@`, leave it empty instead. Save, and say when both are in.

### 4. Wait

Usually under an hour, occasionally up to 48. For a few minutes after it
switches the browser may warn the site is not secure — that is the certificate
being issued.

### 5. Only then, cancel Squarespace

Wait for confirmation the new site is live.

**The part that matters:** if the domain came free with the annual plan,
Squarespace asks during cancellation whether to let it expire or convert it to a
paid registration, around $20/year. **Always choose to keep it.** Letting it
expire loses the address and everything Google has indexed against it, and
anyone can register it afterwards.

Cancel the *website* plan only. Say so beforehand, so the newsletter list can be
exported if anyone ever signed up — it goes with the account.

### 6. Editing merch and blog posts himself

Blocks nothing.

1. Free account at `github.com` — username, email, password.
2. Send the username over.
3. Accept the invitation email.
4. Sign in at `app.pagescms.org` with that account and pick the site.

Two lists, *Merch* and *Notes*. Fill in a form, save, and the site rebuilds
itself. Every entry has a hide switch for staging privately.

### 7. Ten minutes worth more than the website

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

**Branded email.** Needs the nameserver move to Cloudflare described at the top,
after which Email Routing forwards `hello@kedservice.com` into the existing Gmail
for free and Gmail "send as" replies from it. Nothing to migrate, because there
is no mail on the domain today. An MX-based forwarder would work without moving
nameservers if that stays unattractive.

**Move the registration.** Cloudflare Registrar renews at cost, around $10/year
against Squarespace's $20, and puts domain and DNS in one place. Needs Jacob to
unlock the domain and hand over an auth code, and takes 5–7 days. Not during the
cutover — a registrar transfer and a DNS change at once makes any failure harder
to read.
