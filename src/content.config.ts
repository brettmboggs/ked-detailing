import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

/**
 * Merch products, one YAML file per product.
 *
 * These are edited through the CMS at pagescms.org rather than by hand, so the
 * field names here have to stay in step with `.pages.yml`. Adding a product
 * there commits a file to this folder, which triggers a rebuild.
 */
const products = defineCollection({
  loader: glob({ pattern: '**/*.{yaml,yml}', base: './src/content/products' }),
  schema: z.object({
    name: z.string(),
    price: z.string(),
    blurb: z.string().default(''),
    /** Path or file name inside src/assets/merch/. */
    photo: z.string().optional(),
    /** Provider-hosted product page. */
    href: z.string(),
    /** Optional badge, e.g. "New" or "Limited". */
    tag: z.string().optional(),
    /** Lower numbers sort first. */
    order: z.number().default(0),
    /** Tick to keep a product off the live site. */
    draft: z.boolean().default(false),
  }),
});

export const collections = { products };
