// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.kedservice.com',
  integrations: [sitemap()],

  // Mirrors public/_redirects. Cloudflare serves real 301s from that file;
  // these are the static fallback for any host that ignores it.
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
