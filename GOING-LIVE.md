# Going live

Everything between "the build is finished" and "kedservice.com serves it".
Written so the Jacob-facing half can be pasted into a message unchanged — see
[Jacob's steps](#jacobs-steps) below.

The one true blocker is unchanged from NOTES.md: the domain is registered on
Jacob's Squarespace account and Brett's login gets **Access Denied** on
`account.squarespace.com/domains/managed/kedservice.com`. Nothing else is
waiting on anyone.

---

## Order of operations

| # | Who | What | Blocks |
| --- | --- | --- | --- |
| 0 | Brett | Cloudflare Pages project + zone, get the two nameservers | Everything |
| 1 | Jacob | Point the domain (grant access, or paste the nameservers) | Cutover |
| 2 | — | DNS propagates, usually < 1 hour | Step 3 |
| 3 | Brett | Drop the staging `noindex`, submit the sitemap | — |
| 4 | Jacob | Cancel the Squarespace *website* plan, **keep the domain** | — |
| 5 | Jacob | GitHub account → Pages CMS access | Nothing |

Step 0 has to come first. Jacob's step produces two values he cannot generate
himself, so asking him before the Cloudflare zone exists just wastes the ask.

---

## Step 0 — Brett, before Jacob is asked for anything

1. **Cloudflare Pages project** from `brettmboggs/ked-detailing`.
   - Build command `npm run build`, output directory `dist`.
   - `NODE_VERSION=22` as an environment variable — `.nvmrc` pins 22 and Astro 7
     will not run on 20.
2. **Add `kedservice.com` as a zone** on the same Cloudflare account. Pages will
   only serve an apex custom domain when the domain is a zone on the account
   that owns the project, which is why this is a nameserver move and not a
   CNAME. Squarespace has no CNAME flattening at the apex, so there is no
   nameserver-free version of this.
3. **Check the imported DNS records** against Squarespace's DNS panel before the
   switch. Cloudflare's scan is best-effort. There has never been an MX record
   on this domain, so mail cannot break, but any verification TXT (Search
   Console, Housecall Pro) has to be carried across by hand.
4. **Write down the two assigned nameservers** — `something.ns.cloudflare.com`.
   They are per-account, so they cannot be guessed or reused from another
   project.

Only then send Jacob the steps.

## Step 3 — Brett, at cutover

- Remove the staging `noindex` from `Base.astro` and delete `src/pages/launch.astro`.
- Submit `https://www.kedservice.com/sitemap-index.xml` in Search Console, then
  watch Coverage for a fortnight.
- Spot-check the redirects that matter: `/home`, `/cart`, one `/blog/tag/*`, and
  all three blog post slugs.

---

## Jacob's steps

> Copy from here down. Fill in the two nameservers first if he is doing it
> himself, and the GitHub repo invite is sent after he supplies a username.

### Why it needs him and not Brett

`kedservice.com` is registered on his Squarespace account. Squarespace only lets
the account owner change where the address points. Brett can edit the site, but
Squarespace blocks him from the address itself. Until it is pointed at the new
site, the new site cannot go live.

Three things worth saying up front, because they are the questions he will ask:

- **Nothing goes dark.** The current site keeps running until the new one takes
  over.
- **It is reversible.** The setting is a text box; putting the old value back
  undoes it.
- **Email is untouched.** He uses Gmail, and the domain has never carried mail.

### 1. Point the address — the easy way

Give Brett permission and he handles the rest.

1. Go to `account.squarespace.com` and log in.
2. Click **Domains**.
3. Click **kedservice.com**.
4. Click **Permissions**.
5. Click **Invite domain manager**.
6. Enter Brett's name and email, and send it.

A domain manager can change where the address points and nothing else — no
billing access, cannot delete the domain, cannot take ownership. Jacob stays the
owner and can revoke it from the same screen.

**If there is no Permissions button**, the domain shares permissions with the
website subscription. Then instead: **Settings** → **Permissions & Ownership** →
**Invite Contributor** → name and email → switch **Administrator** on →
**Invite**.

### 1b. Point the address — if he would rather not grant access

He pastes in two lines. Same result.

1. Go to `account.squarespace.com` and log in.
2. Click **Domains**, then **kedservice.com**.
3. Click **DNS**, then **Domain Nameservers**.
4. Click **Use custom nameservers**.
5. Re-enter the password. It asks for the 2FA code too, if that is switched on.
6. It warns about DNSSEC. Click **Continue** — it has to come off for this to
   work.
7. Paste the first value into **Nameserver 1**, the second into **Nameserver 2**.
8. Click **Save**, and tell Brett.

```
Nameserver 1   ________.ns.cloudflare.com
Nameserver 2   ________.ns.cloudflare.com
```

### 2. Wait

Usually under an hour, occasionally up to 48. Nothing to do. The old site stays
up throughout.

### 3. Only then, cancel Squarespace

Wait for confirmation that the new site is live first.

**The part that matters:** if the domain came free with the annual plan,
Squarespace asks during cancellation whether to let it expire or convert it to a
paid registration (about $20/year). **Always choose to keep it.** Letting it
expire loses the address, everything Google has indexed against it, and anyone
can register it afterwards.

Tell Brett before cancelling so the newsletter list can be exported, if anyone
ever signed up. It goes with the account.

### 4. Editing merch and blog posts himself

Not urgent, blocks nothing.

1. Make a free account at `github.com` — username, email, password.
2. Send Brett the username.
3. Accept the invitation email.
4. Sign in at `app.pagescms.org` with that account and pick the site.

He gets two lists, *Merch* and *Notes*. Fill in a form, save, and the site
rebuilds itself. Every entry has a hide switch for staging things privately.

### 5. Ten minutes worth more than the website

Separate from the site and more urgent. At `business.google.com`:

- **Hours** — the profile reads *Closed*. If he works seven days, set seven days.
- **Service area** — set to Chesterfield only. He works St. Louis, St. Charles
  and Jefferson County.
- **Categories** — car detailing only. Add boat detailing; marine is in the
  registered business name.

Squarespace analytics showed 207 visits in 30 days with 78% direct. Search is
contributing almost nothing, so the profile is upside rather than maintenance.

---

## Later, optional

**Move the registration to Cloudflare.** At-cost renewal, around $10/year rather
than Squarespace's $20, and it puts the domain and the DNS in one place. Needs
Jacob to unlock the domain and hand over an auth code, and takes 5–7 days. Not
worth doing during the cutover — a registrar transfer and a nameserver change at
the same time makes any failure harder to diagnose. Do it once the site is
settled.

**Branded email.** Cloudflare Email Routing forwards `hello@kedservice.com` into
the existing Gmail for free once the nameservers are on Cloudflare, and Gmail's
"send as" lets him reply from it. Nothing to migrate, because there is no mail
on the domain today.
