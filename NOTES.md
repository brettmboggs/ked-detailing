# Knock Em' Down Detailing — rebuild notes

Replacement for the Squarespace site at `kedservice.com`. Astro 7, Tailwind v4,
GSAP + Lenis. Static output, no server required.

```bash
nvm use            # .nvmrc pins Node 22 — Astro 7 refuses Node 20
npm install
npm run dev        # http://localhost:4321
npm run check      # astro check — type check, currently clean
npm run verify     # check + build, run this before every deploy
```

---

## What the old site actually was

- **One real page.** `/home` with anchor sections, a `/blog` with 3 posts, and a
  `/store` with a single product that could not be bought.
- **No email on the domain.** No MX records, ever. Business mail is
  `knockemdowndetailing@gmail.com`. Nothing to break on cutover.
- **No online payments.** Squarespace Commerce was disabled.
- **No booking system of its own.** "Book Now" pointed at Housecall Pro, which
  is still the booking system and is carried over here unchanged.
- **Site title was never set** — it still read "Your Site Title".

The old copy read as generic AI output and has been rewritten throughout. The
worst of it ("discover how our bespoke detailing solutions can meet your
expectations") is gone. Service tiers, steps and inclusions are unchanged —
those are Jacob's.

---

## Confirmed facts

Verified against Jacob's public business listings, then confirmed by Brett.

| | |
| --- | --- |
| Legal name | Knock Em Down Auto & Marine Detailing LLC |
| Operator | Jacob |
| Base | High Ridge, MO — **a home address, deliberately not published** |
| Service area | Greater St. Louis, St. Charles, Jefferson County |
| Hours | Seven days a week, per Brett. His Google profile disagrees — see below |
| Rating | 5.0 across exactly 25 Google reviews, verified 10 Sep 2026 |
| Booking | Housecall Pro |

**Marine work is real.** It is in the registered LLC name, Brett confirmed it,
and *Marine Maintenance* is a bookable service on his Housecall Pro page. There
are no marine photos yet, so the site states it in copy and FAQ but never
illustrates it. Get boat photos when he next does one.

**Two services were missing from the old site entirely.** His booking page
offers *Marine Maintenance* and *Paint Correction & Ceramic Coating* alongside
Levels 1–4. Ceramic coating is high-value work that was completely invisible to
anyone reading the website. Both now appear in an "Also available" block under
the packages.

**Pricing is by quote on every tier**, per Brett — every vehicle is different.
The old $180 Level I price has been removed. `Service.price` is still on the
type so a fixed price can be reintroduced per tier without a refactor. Worth
revisiting: a visible "from" price usually lifts inbound enquiries.

---

## Reviews

The four testimonials on the Squarespace site were unattributed and appear to
have been written rather than collected. They are **replaced with eight real
five-star Google reviews**, read directly off the live profile:

Ian R. (Rivian R1S paint correction), Richard Zajac (Maserati, salvage to
showroom), Nina Hanser, Jen Robson (gas spill, 101-degree day), Brandon Crites
(1972 Monte Carlo), Fairway Automotive (trade customer), Samantha Charpentier
(SUV, dog hair) and Franco Ignelzi (customer since 2019).

Long ones are trimmed to their strongest passage; nothing is reworded. Brett's
own review is deliberately **excluded** — putting it on a site he built would
read as self-serving. Before launch, confirm Jacob is happy to display these
with names attached.

`aggregateRating` is **deliberately not** in the structured data. Google treats
a business marking up its own rating as self-serving and disallows it in rich
results. The 5.0 is still shown to visitors and links to its source.

---

## Blockers — checked against the live accounts on 10 Sep 2026

1. **Jacob owns the domain, not Brett.** Squarespace lists `kedservice.com`
   under "Domains managed by Squarespace", but opening the domain overview at
   `account.squarespace.com/domains/managed/kedservice.com` returns **Access
   Denied**. Brett's login can edit the site; it cannot unlock, transfer or
   change nameservers. Jacob has to either do the DNS step himself or grant
   owner-level access. This is the one true blocker on cutover.
   **Do not cancel Squarespace until DNS has moved.**
2. **The Google Business Profile is on Jacob's account too.** Brett's Business
   Profile Manager holds three businesses — Brett Boggs Photography, Datum CI
   and Providence House Buyers. Knock Em Down is not among them.
3. **Newsletter subscribers.** Export from Squarespace before the account
   lapses, if anyone ever signed up.
4. **Marine photography**, so the boat side is shown and not just claimed.

### The Google profile is actively costing him work

Worth more than anything on the website, and all fixable in ten minutes by
whoever owns the profile:

- It currently reads **"Closed · Opens 9 AM Fri."** If he works seven days a
  week, the profile is turning people away on the days it says he is shut.
- **Areas served is set to "Chesterfield and nearby areas"** only. He is based
  in High Ridge and works the whole metro. Chesterfield is one suburb.
- **Category is only "Car detailing service."** There is a separate boat
  detailing category, and marine work is in his registered name.

For context on why this matters: Squarespace analytics show 207 visits in the
last 30 days with **78% arriving direct**. Search is contributing almost
nothing, so the profile and the site's SEO are both upside, not maintenance.

---

## Launch readiness

**Every URL the old site published still resolves.** Checked against the
archived Squarespace sitemap — 23 of 23 covered, nothing missing, and zero
broken internal links in the build.

- **The three blog posts are carried over at their original slugs**, so
  `/blog/how-often-should-you-detail-your-car` and the other two keep working.
  They live in `src/content/posts` as markdown.
- **Everything else 301s.** `public/_redirects` handles it at the edge on
  Cloudflare or Netlify; `astro.config.mjs` mirrors the same map so the
  redirects survive on a host that ignores that file. Covers `/home`, `/cart`,
  all 17 `/blog/tag/*` pages, `/blog/category/Info`, and the old store product.
- Redirect stubs carry `noindex` and a canonical, and the generated sitemap
  lists only the six real pages.
- A 404 page exists and routes back to the packages, the home page and the phone.

**The old blog hero images were AI-generated and had to go.** One showed a man
in an *STL Detailing* polo — a different company. Another had Subaru and
St. Louis Chevrolet dealer signage behind a Mazda. All three are replaced with
real photographs from the shoot.

### Before flipping the domain

1. Jacob points the domain (see Blockers). Nothing else is waiting on anyone.
2. Add `<meta name="robots" content="noindex">` in `Base.astro` while it sits on
   the staging subdomain, and take it out at cutover.
3. Submit `https://www.kedservice.com/sitemap-index.xml` in Search Console after
   the switch, and keep an eye on Coverage for a fortnight.
4. Export the Squarespace newsletter list before cancelling. **There is no
   newsletter signup on the new site** — the old one posted to Squarespace and
   there is nowhere for it to go now. If he wants to keep collecting addresses,
   that needs a decision on where they land.
5. Cancel the Squarespace *website* plan only once DNS has settled. The domain
   registration is separate.

## Instagram feed — parked, needs Jacob

The row of four images under "Ride along with us" is **hand-picked**, and no
copy claims otherwise. Swapping the file names in `recent` (src/data/site.ts)
refreshes it.

Pulling his actual feed is built but cannot run. Meta retired the Basic Display
API, and checking the developer account showed the only app on it is **Datum
Social** — Datum CI's app, unpublished, configured for Datum's own Instagram use
case. There was never a Knock Em Down app, so nothing had been authorised and no
token existed. Do not reuse the Datum app: it would route a client's Instagram
data through the startup's Meta app, which is a poor ownership position for very
little gain.

Four steps when Jacob is available, three of which need him present:

1. His Instagram switched to Professional. Free, in-app, reversible.
2. A new Meta app for Knock Em Down, Instagram added, Instagram Login set up.
3. Jacob signing in to authorise it — nobody can do this for him.
4. Generate the long-lived token, then `./tools/set-token.sh` and paste it.

Roughly twenty minutes together. Everything downstream is done and tested:
`tools/curate.py` scores a folder on six measures, rejects what fails and says
why, and grades the keepers. Verified against 64 archive photographs — 59 pass,
and all five rejections hold up. See `tools/README.md`.

## Still open

- **Level III vs Level IV.** Level III "The Knockout" calls itself the top-tier
  detail, yet Level IV "The Revival" sits above it. His Housecall Pro booking
  page suggests the real structure: Levels 1–4 are detail packages, and *Paint
  Correction & Ceramic Coating* is a **separate** track alongside them. The site
  still mirrors the old four-tier copy. Worth reconciling with Jacob.
- **Trade work is real, and still under-claimed.** *Fairway Automotive* left a
  review as a business — "have detailed numerous vehicles for us" — and Josh
  Ogilvie mentions Jacob looking after "a majority of my clients cars". Combined
  with the archive shots of the van at a Porsche dealership, there is a genuine
  B2B story here that the site only hints at. Confirm the details and it belongs
  on the page.
- **The three blog posts** are archived but not carried over. If they are kept,
  keep the existing URL paths so nothing 404s.

---

## Media

**Brett shot all of it.** The stills and the video are his commercial work for
Knock Em Down, not Jacob's phone footage — originals live on
`/media/brett/BBOGGS SSD/Old Mac Harddrive/Knock Em Down`, and his own graded
exports are published at `brettboggs.dev/photo/ked/`.

Prefer the graded exports where they exist. `gwagon-estate.jpg` on the Revival
tier came from `brettboggs.dev/photo/ked/estate.webp` and beats anything
recoverable from the raw files here. Most of the portfolio set is only 900px
wide though, so **ask Brett for full-resolution graded exports of the whole
shoot** — they would replace several photos currently processed straight from
the camera originals.

- **Photos** — a golden-hour shoot of a white Porsche Panamera Turbo, plus the
  G-Class estate set, van and crew shots. Camera originals are 5472×3648; the
  selects in `src/assets/photos/` are downscaled to 2400px long edge.
- **Video** — 4K 60fps from the G-Class shoot. Two gotchas:
  - **No rotation metadata.** Shot with the camera physically turned, so
    everything needs `transpose=2` on ingest. Corrected footage is 2160×3840
    portrait, which is why the hero is built around a portrait clip — it suits
    phones natively.
  - **Flat and ungraded**, with a heavy blue dusk cast. The grade neutralises
    the cast first, then adds contrast:

    ```
    colortemperature=temperature=4300,
    curves=all='0/0 0.21/0.11 0.5/0.545 0.79/0.90 1/1',
    eq=contrast=1.14:saturation=1.08:gamma=0.99,
    colorbalance=gm=-0.03:gh=-0.02,
    unsharp=5:5:0.45
    ```

    Reuse that chain for any new clip so everything matches. libx264 rejects odd
    pixel dimensions — keep width and height even.

Encoded assets are in `public/video/` (`hero-foam` 1.9 MB, `band-splash` 0.5 MB).
Both are muted, looping, `playsinline`, attached by script only after first
paint, and skipped entirely under `prefers-reduced-motion` or data-saver.

---

## Store / merch

`/store` is built and styled but **not selling** — it shows a pre-launch state
until the first published product exists. Nothing has to be toggled by hand.

Jacob manages both merch and blog posts himself at **app.pagescms.org**: he signs
in with GitHub, picks this repo, and the config in `.pages.yml` gives him two
collections — *Merch* and *Notes* — plus the store's surrounding copy. Saving
commits to the repo, which rebuilds and deploys. Every product and post has a
**Hide from the site** switch so he can stage things privately.

Products are one YAML file each in `src/content/products/`, typed by the
collection in `src/content.config.ts`. Images go in `src/assets/merch/`, post
images in `src/assets/blog/`.

What is still needed is the provider — the store links out to provider-hosted
product pages, so no payment handling lives in this repo:

| Option | Monthly | Cut | Notes |
| --- | --- | --- | --- |
| **Fourthwall** | $0 | Per-item margin | POD, checkout and fulfilment in one. Best fit for zero fixed cost. |
| **Printful + Payhip** | $0 | ~5% + Printful cost | Payhip handles checkout, Printful prints. Two accounts. |
| **Square Online** | $0 tier | Per-transaction | Check first — he may already have Square, and Printful connects to it. |
| **Shopify + Printful** | ~$5–39 | Per-transaction | Most capable, only one with a real monthly fee. |

Recommendation: **Fourthwall**, unless he already has Square. Either way the
store links out to provider-hosted product pages, so no payment handling lives
in this repo.

---

## Hosting

All three realistic hosts deploy **from a Git repo**, so that is not the
tradeoff. Recommended: **Cloudflare Pages**, the only free path that also solves
branded email.

- **Site** — Cloudflare Pages building from GitHub. Free.
- **Email** — Cloudflare Email Routing forwards `hello@kedservice.com` into his
  Gmail for free, and Gmail "send as" lets him reply from the branded address.
  Needs nameservers on Cloudflare, which does not require transferring the
  registrar.
- **Forms** — a Pages Function if a contact form is ever added. Today every call
  to action goes to Housecall Pro or the phone.

### Booking

Booking stays on Housecall Pro, which is where his jobs, invoicing and customers
already live. Replacing it with something prettier would split his operations,
so do not.

The hosted booking page takes a logo and little else. Two ways to make it feel
like part of the site, in order of effort:

1. **Embed the Housecall Pro booking widget** in a branded section of the new
   site, so the surrounding page is on-brand even though the widget is theirs.
   Keeps people on `kedservice.com` instead of bouncing to a Housecall domain.
2. **Set the logo and brand colour** inside Housecall Pro's online booking
   settings. Small win, five minutes.

A fully custom booking flow would need the Housecall Pro API, which sits on
their higher tiers. Not worth it unless he outgrows the widget.

**Staging:** `ked.brettboggs.dev` via a CNAME at Namecheap. Add
`<meta name="robots" content="noindex">` to `Base.astro` while it lives there so
it never competes with the live site, and remove it at cutover.

---

## House rules for this site

- **Name a vehicle confidently or not at all.** Brett's rule, and a fair one —
  misnaming a car reads as amateur to the audience this site is aimed at. A
  Ferrari 296 was captioned as a Corvette in the first pass. Current captions
  name only what is legible in the frame: the Panamera Turbo from its badge, the
  Escalade-V from its fender badge and red calipers, the F12 from its shape and
  shield. The red 911 is described as "air-cooled" without a generation, and the
  G-Class without an AMG trim, because neither is readable in those shots.
- **Recent Work is a sample, not a feed.** It links out to Instagram in two
  places, because that is where current work actually lands. If those photos
  ever go stale, the link is doing the real job.
- **One photo, one place.** No image appears in more than one section, and the
  four service tiers each show a different vehicle.

## Gotchas worth remembering

- **`set:html` is a directive, not a tag.** Writing `<set:html value={...} />`
  silently emits a literal `<set :html="...">` element and the JSON-LD never
  renders. The correct form is
  `<script type="application/ld+json" set:html={...} is:inline />`. This bug
  shipped once already and was only caught by parsing the built HTML.
- **Do not rely on `as const` for content arrays.** It gives every entry its own
  literal type, so optional fields vanish from the union and property access
  fails to compile. The arrays in `site.ts` use explicit interfaces instead.
- **Restart the dev server after any `npm install`.** The running process caches
  module paths, and a reinstall makes it throw `MissingSharp` on every image
  even though sharp is fine on disk.
- Editing `content.config.ts` needs more than a dev server restart. Astro caches
  the parsed collections in `.astro/`, so a newly added frontmatter field reads
  back as `undefined` and anything strict about it — `<Image alt>`, for one —
  throws in dev while `astro build` passes happily. Clear `.astro` and
  `node_modules/.astro`, then restart.

---

## Structure

```
src/
  components/    Header, Hero, Marquee, Intro, BandKnockout, Services,
                 Gallery, Testimonials, Faq, Cta, Footer
  data/          site.ts (all copy, reviews, photo assignments), store.ts
  layouts/       Base.astro — meta, fonts, LocalBusiness + FAQPage schema
  pages/         index.astro, store.astro
  scripts/       motion.ts — Lenis, GSAP reveals, marquees, accordions
  styles/        global.css — design tokens and display type scale
```

Copy lives in `src/data/site.ts`, not in components. Text edits happen in one
file.
