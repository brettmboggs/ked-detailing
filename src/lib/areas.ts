import { HOME_ZIP, roadMiles } from '@ked/scheduling';
import { formatMoney, type PricingConfig } from '@ked/pricing';
import type { AreaPage } from '../data/local-pages';

/**
 * The facts that make each area page its own: how far it is from home base
 * and what the trip costs, from the same scheduling and pricing data the
 * booking system uses. Road miles, not minutes: the scheduler's drive times
 * err long on purpose, which is right for booking and wrong for a sales page.
 */
export function areaFacts(area: AreaPage, pricing: PricingConfig | null, base: string) {
  const miles = area.zips.map((z) => roadMiles(HOME_ZIP, z)).filter((m): m is number => m !== null);
  const drive = area.zips.includes(HOME_ZIP) ? null : miles.length ? Math.min(...miles) : null;
  const zone = pricing?.travel.zones.find((z) => z.zips.some((prefix) => area.zips[0]!.startsWith(prefix)));
  const fee = zone ? zone.fee : null;
  return {
    drive,
    driveText: drive === null ? 'Home base' : `About ${Math.max(5, Math.round(drive / 5) * 5)} miles from ${base}`,
    fee,
    feeText: fee === null ? 'Travel priced in the quote' : fee === 0 ? 'No travel charge' : `${formatMoney(fee)} travel charge`,
    zone: zone?.label ?? null,
  };
}
