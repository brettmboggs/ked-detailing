# Knock Em' Down Detailing

Mobile auto and marine detailing in St. Louis. A static marketing site built to
replace a Squarespace template.

**Stack:** Astro 7 · Tailwind v4 · GSAP + ScrollTrigger · Lenis · TypeScript

## Running it

```bash
nvm use          # .nvmrc pins Node 22 — Astro 7 will not run on 20
npm install
npm run dev      # http://localhost:4321
npm run check    # astro check
npm run verify   # check + build; run before deploying
```

## How it is put together

```
src/
  components/    Header, Hero, Marquee, Intro, BandKnockout, Services,
                 Gallery, Testimonials, Faq, Cta, Footer
  data/          site.ts — all copy, reviews and photo assignments
                 store.ts — merch catalogue
  layouts/       Base.astro — meta, fonts, LocalBusiness + FAQPage schema
  pages/         index.astro, store.astro
  scripts/       motion.ts — Lenis, GSAP reveals, marquees, accordions
  styles/        global.css — design tokens and the display type scale
```

Copy lives in `src/data/site.ts` rather than inside components, so text changes
happen in one file.

## Notes on the build

**Media.** Photography and 4K video shot by [Brett Boggs](https://brettboggs.dev).
The source footage carries no rotation metadata and was shot with the camera
physically turned, so it needs `transpose=2` on ingest — corrected, it is
portrait, which is why the hero is built around a vertical clip. Video is muted,
looping, `playsinline`, attached by script only after first paint, and skipped
entirely under `prefers-reduced-motion` or an explicit data-saver setting.

**Motion.** Every animation is opt-out. With reduced motion set, animated
elements render in their final state and only the behaviour that carries meaning
stays wired up.

**Services.** Hovering a tier opens it in place, with its media wiping in beside
the description. One row is always open and it does not close on pointer leave,
so crossing the list cannot leave the section empty. Click toggles on touch and
keyboard focus opens the row it lands on.

**Structured data.** `LocalBusiness` on every page, `FAQPage` only on the page
that renders the FAQs. `aggregateRating` is deliberately omitted — Google treats
a business marking up its own rating as self-serving and disallows it in rich
results. The rating is shown to visitors and linked to its source instead.

## Gotchas

- `set:html` is a directive, not a tag. `<set:html value={...} />` silently
  emits a literal `<set :html="...">` element and no structured data renders.
  Use `<script type="application/ld+json" set:html={...} is:inline />`.
- Avoid `as const` on content arrays. It gives each entry its own literal type,
  so optional fields vanish from the union and property access fails to compile.
  The arrays in `site.ts` use explicit interfaces.
- Restart the dev server after any `npm install`. The running process caches
  module paths and will throw `MissingSharp` on every image even though sharp is
  fine on disk.
