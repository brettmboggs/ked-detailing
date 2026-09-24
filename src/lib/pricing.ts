import { defaultConfig, validateConfig, type PricingConfig } from '@ked/pricing';

/**
 * Jacob's live pricing, read once per build from the API. Saving prices in the
 * app triggers a Pages rebuild (see api/src/pricing.ts), so the page is at most
 * a build behind. Leads are re-priced by the API anyway, so a stale page can't
 * book the wrong price.
 *
 * Falls back to the package defaults when no API is configured, it can't be
 * reached, or it returns something that doesn't validate. A broken API never
 * breaks the build.
 */
export const apiUrl: string | undefined = import.meta.env.PUBLIC_KED_API_URL?.replace(/\/$/, '') || undefined;

let cached: Promise<PricingConfig> | undefined;

export function loadPricing(): Promise<PricingConfig> {
  cached ??= fetchPricing();
  return cached;
}

async function fetchPricing(): Promise<PricingConfig> {
  if (!apiUrl) return defaultConfig;
  try {
    const res = await fetch(`${apiUrl}/v1/pricing`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { config } = (await res.json()) as { config: PricingConfig };
    const errors = validateConfig(config);
    if (errors.length) throw new Error(errors.join('; '));
    return config;
  } catch (err) {
    console.warn(`[pricing] using built-in defaults: ${(err as Error).message}`);
    return defaultConfig;
  }
}
