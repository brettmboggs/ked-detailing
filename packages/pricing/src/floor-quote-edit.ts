/**
 * Hand changes to a firm floor quote (ked-coatings D19). The formula prices
 * what the map measured; the owner can still rename or re-price any line,
 * take one out, or add lines the formula doesn't know (a discount, moving a
 * freezer, a second coat on a step). The formula's own number is kept next
 * to each change, so it's always clear what was changed and by how much.
 *
 * Money is integer cents.
 */
import type { FloorLineId, FloorPricingConfig, FloorQuote } from './floor-types.ts';

export interface FloorLineEdit {
  label?: string;
  amount?: number;
  removed?: boolean;
}

export interface FloorQuoteEdits {
  lines: Partial<Record<FloorLineId, FloorLineEdit>>;
  /** Lines the owner added. A negative amount is a discount. */
  extras: { id: string; label: string; amount: number }[];
}

export const noQuoteEdits = (): FloorQuoteEdits => ({ lines: {}, extras: [] });

export interface EditedFloorLine {
  id: string;
  label: string;
  amount: number;
  /** formula: as priced; changed: the owner changed it; added: the owner's own line. */
  source: 'formula' | 'changed' | 'added';
  /** What the formula said, for a changed line. */
  formula?: { label: string; amount: number };
}

export interface EditedFloorQuote {
  lines: EditedFloorLine[];
  /** Lines the owner took out, so they can be put back. */
  removed: { id: FloorLineId; label: string; amount: number }[];
  total: number;
  configVersion: number;
  edited: boolean;
}

/**
 * The quote after the owner's changes. The minimum job is worked out again
 * on the changed lines: a discount can't take a floor below the minimum
 * unless the owner removes the minimum line too.
 */
export function applyFloorQuoteEdits(config: FloorPricingConfig, quote: FloorQuote, edits: FloorQuoteEdits): EditedFloorQuote {
  const lines: EditedFloorLine[] = [];
  const removed: EditedFloorQuote['removed'] = [];
  for (const l of quote.lines) {
    if (l.id === 'minimum') continue;
    const e = edits.lines[l.id];
    if (e?.removed) {
      removed.push({ id: l.id, label: l.label, amount: l.amount });
      continue;
    }
    const label = e?.label?.trim() || l.label;
    const amount = e?.amount !== undefined && Number.isFinite(e.amount) ? Math.round(e.amount) : l.amount;
    const changed = label !== l.label || amount !== l.amount;
    lines.push({ id: l.id, label, amount, source: changed ? 'changed' : 'formula', ...(changed ? { formula: { label: l.label, amount: l.amount } } : {}) });
  }
  for (const x of edits.extras) {
    if (!x.label.trim() && !x.amount) continue;
    lines.push({ id: x.id, label: x.label.trim() || 'Other', amount: Math.round(x.amount), source: 'added' });
  }
  let total = lines.reduce((s, l) => s + l.amount, 0);
  const minEdit = edits.lines.minimum;
  if (total < config.minimum) {
    const topUp = config.minimum - total;
    if (minEdit?.removed) removed.push({ id: 'minimum', label: 'Minimum job', amount: topUp });
    else {
      lines.push({ id: 'minimum', label: 'Minimum job', amount: topUp, source: 'formula' });
      total = config.minimum;
    }
  }
  const edited = lines.some((l) => l.source !== 'formula') || removed.length > 0;
  return { lines, removed, total, configVersion: quote.configVersion, edited };
}
