// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://www.kedservice.com',
  vite: { plugins: [tailwindcss()] },
  image: { responsiveStyles: true },
});
