import type { FloorPricingConfig } from './floor-types.ts';

/**
 * STARTING NUMBERS (TENANT: KED Coatings), from the business plan's price sheet
 * ("Step 3: Price it"; ked-coatings DECISIONS D8). Every one is an admin
 * setting; the owner sets the real ones before the quick quote goes public.
 *
 * Garage sizes: the plan's two-car example is 22 × 22 (484 sq ft). The one-
 * and three-car sizes and the quick-quote guesses are PLACEHOLDERS until
 * the owner picks them (ked-coatings docs/OPEN-QUESTIONS.md).
 *
 * All money in cents.
 */
export const defaultFloorConfig: FloorPricingConfig = {
  version: 1,
  rate: 700,
  minimum: 180000,
  cracks: { label: 'Crack repair', rate: 600, freeFeet: 20 },
  removal: { label: 'Old coating removal', rate: 150 },
  stemWall: { label: 'Stem wall', rate: 1000 },
  steps: { label: 'Step or landing', rate: 15000 },
  spalling: { label: 'Spalled concrete repair', rate: 300 },
  moisturePrimer: { label: 'Moisture primer', rate: 150 },
  roundTo: 2500,
  quick: {
    sizes: [
      { id: '1-car', label: '1-car', width: 12, depth: 22 },
      { id: '2-car', label: '2-car', width: 22, depth: 22 },
      { id: '3-car', label: '3-car', width: 32, depth: 22 },
    ],
    sqft: [150, 1200],
    spread: 0.05,
    crackFeet: [0, 40],
    stemWallShare: [0.5, 1],
  },
};
