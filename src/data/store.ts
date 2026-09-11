/**
 * Store copy that is part of the design rather than the catalogue.
 *
 * Products themselves live in `src/content/products/` as one YAML file each,
 * edited through the CMS. The store page goes live on its own as soon as a
 * published product exists — there is no flag to remember to flip.
 *
 * The three strings below are editable in the CMS too, via store-settings.json.
 */
import settings from './store-settings.json';

export const storeMeta = {
  heading: ['Wear', 'the work.'],
  eyebrow: 'Merch',
  storefrontUrl: settings.storefrontUrl,
  blurbPreLaunch: settings.blurbPreLaunch,
  blurbLive: settings.blurbLive,
} as const;
