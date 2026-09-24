/**
 * The shape of Jacob's pricing. Every number that decides a quote lives in a
 * PricingConfig, so tuning prices never means touching the formula.
 *
 * Money is integer cents throughout. Floats only appear as multipliers and are
 * rounded away before anything is shown.
 */

export type Craft = 'vehicle' | 'boat';

export interface VehicleClass {
  id: string;
  label: string;
  /** Shown under the label so a customer can place their own car. */
  examples: string;
  /** Applied to the service base price. A mid-size sedan is 1. */
  multiplier: number;
}

export interface Service {
  id: string;
  name: string;
  /** "Level I" etc. Empty for services outside the four levels. */
  level: string;
  craft: Craft;
  /**
   * Cars: price for a class-1 vehicle, scaled by the class multiplier.
   * Boats: price per foot of length.
   */
  base: number;
  /** Labour hours for a class-1 vehicle (or per foot for boats), [low, high]. */
  hours: [number, number];
  /**
   * How wide the shown range is either side of the computed price, as a
   * fraction. Correction work varies more than a maintenance wash.
   */
  spread: number;
  /**
   * No number is shown — the job is captured as a lead and Jacob prices it
   * after seeing it. Ceramic coating starts here.
   */
  inspectionOnly?: boolean;
  /** Condition questions this service ignores (a wash doesn't care about stains). */
  ignoresConditions?: string[];
}

export interface ConditionOption {
  id: string;
  label: string;
  /** Flat amount, in cents. */
  add: number;
  /** Extra labour hours. */
  hours: number;
  /**
   * Scale `add` and `hours` by the vehicle class multiplier (pet hair in a van
   * is more work), or for boats treat them as per-foot amounts.
   */
  scalesWithSize: boolean;
  /** Price can't be trusted without seeing it; flag for inspection. */
  flagsInspection?: boolean;
}

export interface Condition {
  id: string;
  question: string;
  craft: Craft;
  /** The first option is the default and should cost nothing. */
  options: ConditionOption[];
}

export interface AddOn {
  id: string;
  label: string;
  description: string;
  craft: Craft;
  price: number;
  hours: number;
  scalesWithSize: boolean;
  /** Services that already include this, so it is hidden for them. */
  includedIn?: string[];
}

export interface TravelZone {
  id: string;
  label: string;
  /** 5-digit ZIPs, or 3-digit prefixes to cover a whole region. */
  zips: string[];
  fee: number;
}

export interface PricingConfig {
  /** Bumped whenever Jacob saves, so a stored quote records what priced it. */
  version: number;
  vehicleClasses: VehicleClass[];
  services: Service[];
  conditions: Condition[];
  addOns: AddOn[];
  travel: {
    zones: TravelZone[];
    /** ZIPs matching no zone. Null means "outside the area — Jacob confirms". */
    outsideFee: number | null;
  };
  /** No job is quoted below this, in cents. */
  minimum: number;
  /** Shown prices round to this many cents. */
  roundTo: number;
  /** Boats outside this length range are flagged for inspection. */
  boatFeet: [number, number];
}

export interface QuoteInput {
  service: string;
  /** Required for vehicle services. */
  vehicleClass?: string;
  /** Required for boat services. */
  boatFeet?: number;
  /** condition id → option id. Missing answers take the first option. */
  conditions?: Record<string, string>;
  addOns?: string[];
  zip?: string;
}

export interface QuoteLine {
  label: string;
  amount: number;
}

export interface Quote {
  service: Service;
  lines: QuoteLine[];
  /** Sum of lines before rounding, minimum applied. */
  total: number;
  /** The range shown to the customer. Null when the job is inspection-only. */
  range: [number, number] | null;
  hours: [number, number];
  /** Jacob needs to see it before the number is firm, beyond the usual caveat. */
  inspection: boolean;
  /** Plain-language reasons, shown under the price. */
  notes: string[];
  travelZone: TravelZone | null;
  configVersion: number;
}
