// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// The production build serves from the root of kedservice.com. Setting
// KED_BASE (and KED_SITE) produces the staging copy that lives at a sub-path of
// brettboggs.dev instead. Base.astro derives `noindex` from the base, so the
// staging copy can never be indexed by accident.
const base = process.env.KED_BASE || undefined;
const site = process.env.KED_SITE || 'https://www.kedservice.com';

export default defineConfig({
  site,
  base,
  integrations: [sitemap()],

  // Mirrors public/_redirects, which Netlify serves as real forced 301s. These
  // are the meta-refresh fallback for any host that ignores that file, and the
  // reason its rules carry a trailing "!" — an unforced rule loses to the stub.
  redirects: {
    '/blog/category/Info': '/blog',
    '/blog/tag/auto+detailing': '/blog',
    '/blog/tag/auto+detailing+tips': '/blog',
    '/blog/tag/car+care+st.+louis': '/blog',
    '/blog/tag/car+care+tips': '/blog',
    '/blog/tag/car+detailing+near+me': '/blog',
    '/blog/tag/car+detailing+schedule': '/blog',
    '/blog/tag/mobile+detailing+St.+Louis': '/blog',
    '/blog/tag/paint+protection': '/blog',
    '/blog/tag/regular+car+detailing': '/blog',
    '/blog/tag/resale+value': '/blog',
    '/blog/tag/seasonal+car+care': '/blog',
    '/blog/tag/st+louis': '/blog',
    '/blog/tag/vehicle+maintenance': '/blog',
    '/blog/tag/vehicle+protection': '/blog',
    '/cart': '/store',
    '/home': '/',
    '/store/p/level-i-the-tune-up': '/#services',
  },
  vite: { plugins: [tailwindcss()] },
  image: { responsiveStyles: true },
});
