/**
 * Merch catalogue.
 *
 * Products are intentionally data-only. Once a print-on-demand provider is
 * chosen, each entry gets the provider's product URL in `href` and a product
 * image dropped into `src/assets/merch/`. Until then `products` stays empty and
 * the store renders its pre-launch state.
 *
 * See NOTES.md — "Store / merch" for the provider comparison.
 */

export interface Product {
  name: string;
  /** Blurb shown under the name. */
  blurb: string;
  /** Display price, e.g. "$48". */
  price: string;
  /** File name inside src/assets/merch/. */
  photo: string;
  /** Provider-hosted product page. Opens in a new tab. */
  href: string;
  /** Optional flag shown as a small tag. */
  tag?: string;
}

export const products: Product[] = [];

export const storeMeta = {
  /** Flip to true once `products` is populated and the provider is live. */
  live: false,
  /** Storefront landing page, if the provider hosts one. */
  storefrontUrl: '',
  heading: ['Wear', 'the work.'],
  eyebrow: 'Merch',
  blurbPreLaunch:
    "Hoodies, tees, and caps are on the way. Everything is printed and shipped on demand, so there's no box of unsold shirts sitting in the van.",
  blurbLive:
    'Printed and shipped on demand. Ships anywhere in the US, usually within a week of ordering.',
} as const;
