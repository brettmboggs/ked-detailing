# Knock Em' Down Detailing — rebuild notes

Replacement for the Squarespace site at `kedservice.com`. Astro 7, Tailwind v4,
GSAP + Lenis. Static output, no server required.

```bash
nvm use            # .nvmrc pins Node 22 — Astro 7 refuses Node 20
npm install
npm run dev        # http://localhost:4321
npm run build      # -> dist/
```

---

## What the old site actually was

Worth knowing before anyone worries about "losing" something.

- **One real page.** `/home` with anchor sections, a `/blog` with 3 posts, and a
  `/store` with a single product that could not be bought.
- **No email on the domain.** No MX records, ever. Business mail is
  `knockemdowndetailing@gmail.com`. Nothing to break on cutover.
- **No online payments.** Squarespace Commerce was disabled.
- **No booking system of its own.** The "Book Now" button pointed at Housecall
  Pro, which is still the booking system and is carried over here unchanged.
- **Site title was never set** — it still read "Your Site Title".

Archived copies of the old pages and images are in the session scratchpad, not
in this repo.

---

## Blockers — things only Brett or Jacob can supply

1. **Registrar access for `kedservice.com`.** Nameservers are
   `ns-cloud-e*.googledomains.com`, which is what Squarespace uses for domains
   it manages. The domain is registered *through Squarespace*, so it has to be
   dealt with before or during cutover. Everything else can be built without it.
2. **Google Business Profile access.** There is a `google-site-verification` TXT
   record on the domain, so a Search Console property exists. For a mobile
   detailer, the Business Profile drives more calls than the website does.
3. **Prices for Levels II, III and IV.** Only Level I ($180) was ever public.
   The page currently shows "Quote" for the rest. Missing prices cost bookings.
4. **Newsletter subscribers.** Export from Squarespace before the account
   lapses, if anyone ever signed up.
5. **Confirm the marine side of the business** — see below.

**Do not cancel Squarespace until DNS has moved and propagated.**

---

## Content flags — decisions deferred to the client

- **"Auto & Marine".** The Housecall Pro booking profile is registered as
  *Knock Em Down Auto & Marine Detailing*, but the website has never mentioned
  boats. `business.legalName` in `src/data/site.ts` carries the full name and it
  appears in the footer and schema. If he does not want marine work, change that
  one field.
- **Level III vs Level IV.** Level III "The Knockout" describes itself as the
  "top-tier detail", yet Level IV "The Revival" exists above it and says it
  includes "everything in **Level I**". That reads like an editing mistake — the
  Revival is a paint-correction track, not a higher tier. Service copy was
  carried over **verbatim** as requested and this was not silently fixed.
- **Testimonials are unattributed.** Four quotes came over from Squarespace with
  first-name-plus-initial only. No source, no dates. If any are real Google
  reviews they should be linked; if not, they should probably go.
- **The dealership photos.** Several archive shots show the van and finished
  cars at what appears to be a Porsche dealership. If that is a real trade
  relationship it is the single strongest credibility asset he has and deserves
  to be stated outright. It is **not** claimed anywhere on the site right now,
  because it has not been confirmed.

---

## Media

All photography and footage is his own, from
`/media/brett/BBOGGS SSD/Old Mac Harddrive/Knock Em Down`.

- **Photos** — a professional golden-hour shoot of a white Porsche Panamera
  Turbo, plus van and crew shots. Originals are 5472×3648; the 16 selects in
  `src/assets/photos/` are downscaled to 2400px long edge. Astro handles the
  rest at build time.
- **Video** — 4K 60fps, shot on a G63 detail at a residence. Two things about
  the source:
  - It has **no rotation metadata** and was shot with the camera physically
    turned. Everything needs `transpose=2` (90° counter-clockwise) on ingest,
    which makes the corrected footage 2160×3840 **portrait**. That suits phones
    natively, which is why the hero is built around a portrait clip.
  - It is **flat and ungraded** with a heavy blue dusk cast. The grade applied
    on encode neutralises the cast first, then adds contrast:

    ```
    colortemperature=temperature=4300,
    curves=all='0/0 0.21/0.11 0.5/0.545 0.79/0.90 1/1',
    eq=contrast=1.14:saturation=1.08:gamma=0.99,
    colorbalance=gm=-0.03:gh=-0.02,
    unsharp=5:5:0.45
    ```

    Reuse that chain for any new clip so everything matches. Note libx264
    rejects odd pixel dimensions — keep width and height even.

Encoded web assets live in `public/video/` (`hero-foam` 1.9 MB,
`band-splash` 0.5 MB). Both are muted, looping, `playsinline`, attached by
script only after first paint, and skipped entirely under `prefers-reduced-motion`
or an explicit data-saver setting.

---

## Store / merch

`/store` is built and styled but **not selling yet**. It renders a pre-launch
state until `storeMeta.live` is true and `products` has entries in
`src/data/store.ts`. Product images go in `src/assets/merch/`.

Print-on-demand options, given the "nothing extra to pay monthly" constraint:

| Option | Monthly | Cut | Notes |
| --- | --- | --- | --- |
| **Fourthwall** | $0 | Per-item margin | POD, checkout and fulfilment in one. Hosted shop plus linkable product pages. Best fit for zero fixed cost. |
| **Printful + Payhip** | $0 | ~5% + Printful cost | Payhip free tier handles checkout, Printful prints. Two accounts to manage. |
| **Square Online** | $0 tier | Per-transaction | Worth checking first — he may already have Square, and Printful connects to it. |
| **Shopify + Printful** | ~$5–39 | Per-transaction | Most capable, only one with a real monthly fee. |

Recommendation: **Fourthwall**, unless he already has a Square account, in which
case start there. Either way the store page links out to provider-hosted product
pages, so no payment handling lives in this repo.

---

## Hosting

All three realistic hosts deploy **from a Git repo** — that choice is not in
tension with using Git. The difference is what they add on top.

Recommended: **Cloudflare Pages**, because it is the only free path that also
solves branded email:

- **Site** — Cloudflare Pages, building from GitHub. Free.
- **Email** — Cloudflare Email Routing gives `hello@kedservice.com` forwarding
  into his Gmail for free, and Gmail "send as" lets him reply from the branded
  address. Requires the domain's nameservers on Cloudflare, which can be done
  without transferring the registrar.
- **Forms** — a Pages Function if a contact form is ever added. Right now every
  call to action goes to Housecall Pro or the phone, so there is no form to
  handle.

GitHub Pages would also work for the static site but cannot do the email or any
server-side piece.

**Staging:** `ked.brettboggs.dev` via a CNAME at Namecheap. Add
`<meta name="robots" content="noindex">` to `Base.astro` while it lives there,
so it never competes with the live site in search.

---

## Structure

```
src/
  components/    Header, Hero, Marquee, Intro, BandKnockout, Services,
                 Gallery, Testimonials, Faq, Cta, Footer
  data/          site.ts (all copy + photo assignments), store.ts
  layouts/       Base.astro — meta, fonts, LocalBusiness schema
  pages/         index.astro, store.astro
  scripts/       motion.ts — Lenis, GSAP reveals, marquees, accordions
  styles/        global.css — design tokens and display type scale
```

Copy lives in `src/data/site.ts`, not in the components. Text edits happen in
one file.

## Still to do

- Point the real prices in, once supplied.
- Decide the marine question and the dealership claim.
- Pick a POD provider and populate `store.ts`.
- Carry over the three blog posts, or decide to drop them. They are archived.
  Keep the existing URL paths if they are kept, so nothing 404s.
- Add `noindex` for staging, remove it at cutover.
