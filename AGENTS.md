## Standing intentions (read every session)

- **White-label later.** This system is Jacob's today and will be
  white-labeled to other businesses in the space later. Every change keeps
  that cheap: business facts come from one place (site data, the business
  profile), never hard-coded in system code; anything that must be
  business-specific gets a `TENANT:` comment. `npm run tenant-check` enforces
  it in CI. The map is `docs/multi-tenant.md`. Don't treat this as news.
- **Two businesses.** Jacob's system runs Knock Em' Down Detailing and KED
  Coatings (garage floors, `../ked-coatings`, launching April 2027). Code
  that knows about a trade (pricing, job sheet, materials) stays behind a
  trade boundary, so both of Jacob's businesses and future customers can
  use it.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
