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
| Hours | Mon–Fri, 9am–5pm. **Not** seven days a week |
| Rating | 5.0 across 25+ reviews |
| Booking | Housecall Pro |

**Marine work is real.** It is in the registered LLC name and Brett confirmed
it. There are no marine photos yet, so the site states it in copy and FAQ but
never illustrates it. Get boat photos when he next does one.

**Pricing is by quote on every tier**, per Brett — every vehicle is different.
The old $180 Level I price has been removed. `Service.price` is still on the
type so a fixed price can be reintroduced per tier without a refactor. Worth
revisiting: a visible "from" price usually lifts inbound enquiries.

---

## Reviews

The four testimonials on the Squarespace site were unattributed and appear to
have been written rather than collected. They have been **replaced with six real
five-star Google reviews** pulled from Jacob's public review profile:

Ian R. (Rivian R1S paint correction), Rich Z. (Maserati, salvage to showroom),
Nina Hanser, Brandon Crites (1972 Monte Carlo), Jenna Jordan (repeat customer),
Costa Raptis.

Nina's is excerpted because the source itself truncates it. Everything else is
verbatim. Before launch, confirm with Jacob that he is happy to display these
with names attached, and re-check they are still live.

`aggregateRating` is **deliberately not** in the structured data. Google treats
a business marking up its own rating as self-serving and disallows it in rich
results. The 5.0 is still shown to visitors and links to its source.

---

## Blockers — things only Brett or Jacob can supply

1. **Registrar access for `kedservice.com`.** Nameservers are
   `ns-cloud-e*.googledomains.com`, which is what Squarespace uses for domains
   it manages. The domain is registered *through Squarespace*. Everything else
   can be built without it. **Do not cancel Squarespace until DNS has moved.**
2. **Google Business Profile access.** It exists and is the source of the
   reviews. For a mobile detailer it drives more calls than the website. It
   should be set up as a service-area business with the address hidden.
3. **Newsletter subscribers.** Export from Squarespace before the account
   lapses, if anyone ever signed up.
4. **Marine photography**, so the boat side is shown and not just claimed.

---

## Still open

- **Level III vs Level IV.** Level III "The Knockout" calls itself the top-tier
  detail, yet Level IV "The Revival" sits above it. The Revival is really a
  paint-correction track rather than a higher tier. Copy was left as Jacob wrote
  it; the ordering question is his to settle.
- **The dealership photos.** Several archive shots show the van and finished
  cars at what looks like a Porsche dealership. If that is a real trade
  relationship it is his strongest credibility asset. It is **not** claimed
  anywhere on the site, because it has not been confirmed.
- **The three blog posts** are archived but not carried over. If they are kept,
  keep the existing URL paths so nothing 404s.

---

## Media

All photography and footage is his own, from
`/media/brett/BBOGGS SSD/Old Mac Harddrive/Knock Em Down`.

- **Photos** — a professional golden-hour shoot of a white Porsche Panamera
  Turbo, plus van and crew shots. Originals are 5472×3648; the selects in
  `src/assets/photos/` are downscaled to 2400px long edge.
- **Video** — 4K 60fps from a G63 detail. Two gotchas:
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

`/store` is built and styled but **not selling**. It renders a pre-launch state
until `storeMeta.live` is true and `products` has entries in `src/data/store.ts`.
Product images go in `src/assets/merch/`.

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

**Staging:** `ked.brettboggs.dev` via a CNAME at Namecheap. Add
`<meta name="robots" content="noindex">` to `Base.astro` while it lives there so
it never competes with the live site, and remove it at cutover.

---

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
