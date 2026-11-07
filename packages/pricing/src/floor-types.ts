/**
 * The floor-coating trade's pricing (TENANT: KED Coatings today, and any later floor
 * business). Every number that decides a floor price lives in a
 * FloorPricingConfig, so tuning prices never means touching the formula.
 *
 * Two quotes come from the same config, so they can't drift apart:
 * - the **firm quote**, from the measurements on the floor map at the
 *   measure visit (`floorQuote`);
 * - the **quick quote** on the website, from a garage size and three yes/no
 *   answers (`quickFloorQuote`). It runs the firm quote twice, once with the
 *   low guess at each unknown measurement and once with the high one.
 *
 * Money is integer cents throughout.
 */

/** A preset garage size the customer can tap instead of measuring. */
export interface GarageSize {
  id: string;
  label: string;
  /** Feet across the door wall, and feet from the door to the back wall. */
  width: number;
  depth: number;
}

/** A per-unit price: per sq ft, per linear ft, or per item. */
export interface Rate {
  label: string;
  /** Cents per unit. */
  rate: number;
}

export interface FloorPricingConfig {
  /** Bumped whenever the owner saves, so a stored quote records what priced it. */
  version: number;
  /** The full system (grind, base, flake, top coat), cents per sq ft. */
  rate: number;
  /** No floor is priced below this, in cents. */
  minimum: number;
  /** Crack repair: the first `freeFeet` are part of the job. */
  cracks: Rate & { freeFeet: number };
  /** Grinding off old paint, epoxy or coating, per sq ft. */
  removal: Rate;
  /** The concrete curb along the walls, coated like the floor, per linear ft. */
  stemWall: Rate;
  /** Each step or landing into the house. */
  steps: Rate;
  /** Rebuilding badly spalled (flaking, pitted) concrete, per sq ft of damage. */
  spalling: Rate;
  /**
   * Moisture-blocking primer, per sq ft. Only ever priced after the moisture
   * test at the measure visit, so the quick quote only mentions it.
   */
  moisturePrimer: Rate;
  /** Shown prices round to this many cents. */
  roundTo: number;
  quick: {
    sizes: GarageSize[];
    /** Typed sizes outside this sq ft range are priced at the visit. */
    sqft: [number, number];
    /** Extra width either side of the range, for a measurement taken by eye. */
    spread: number;
    /** "Cracks?" yes: feet of crack beyond the free feet, [low guess, high guess]. */
    crackFeet: [number, number];
    /**
     * "Stem wall?" yes: how much of the back and side walls has one, as a
     * share of their length, [low guess, high guess].
     */
    stemWallShare: [number, number];
  };
}

/** What the floor map measures at the visit. */
export interface FloorMeasurements {
  sqft: number;
  crackFeet?: number;
  /** Sq ft with old coating to grind off. */
  removalSqft?: number;
  stemWallFeet?: number;
  steps?: number;
  spalledSqft?: number;
  /** The moisture test failed, so the primer goes down. */
  moisturePrimer?: boolean;
}

export type FloorLineId = 'floor' | 'cracks' | 'removal' | 'stem-wall' | 'steps' | 'spalling' | 'primer' | 'minimum';

export interface FloorLine {
  id: FloorLineId;
  label: string;
  amount: number;
}

export interface FloorQuote {
  lines: FloorLine[];
  total: number;
  configVersion: number;
}

export type QuickSize = { size: string } | { width: number; depth: number };

export interface QuickFloorInput {
  /** A preset size id, or feet across and deep. */
  garage: QuickSize;
  cracks?: boolean;
  oldCoating?: boolean;
  stemWall?: boolean;
}

export interface QuickFloorQuote {
  sqft: number;
  /** The range shown to the customer. */
  range: [number, number];
  /** What the range is made of, each as its own low–high. */
  lines: { id: FloorLineId; label: string; range: [number, number] }[];
  /** Plain-language notes shown under the range. */
  notes: string[];
  /** Something about the floor means the number really waits for the visit. */
  measureFirst: boolean;
  configVersion: number;
}
