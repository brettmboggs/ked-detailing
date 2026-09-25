import { business, quoteLive } from '../data/site';
import { withBase } from './url';

/**
 * Where every Book button goes: /quote once the switch is on (optionally with
 * a package picked), Housecall Pro until then. Spread it onto the <a>.
 */
export function bookLink(serviceId?: string): { href: string; target?: string; rel?: string } {
  if (quoteLive) return { href: withBase(serviceId ? `/quote?service=${serviceId}` : '/quote') };
  return { href: business.bookingUrl, target: '_blank', rel: 'noopener' };
}

/** "Level II" → "level-2", the pricing engine's id for that package. */
export const serviceIdFor = (level: string) => {
  const n = { I: 1, II: 2, III: 3, IV: 4 }[level.replace('Level ', '').trim() as 'I' | 'II' | 'III' | 'IV'];
  return n ? `level-${n}` : undefined;
};
