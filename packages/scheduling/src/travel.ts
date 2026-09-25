import { ZIPS } from './zips.ts';

/**
 * Drive time between jobs, estimated from ZIP code centers. No maps service:
 * those cost money per lookup. Straight-line miles times a road factor, the
 * first few at street speed and the rest at highway speed, plus a few minutes
 * to get going.
 *
 * It errs long on purpose. From High Ridge it gives Kirkwood 25 min,
 * downtown 40 and Edwardsville 65, against typical drives of about 20, 30-35
 * and 50. Good enough to keep a far job from being booked tight against
 * another and to spot jobs close together; not turn-by-turn accurate. Every
 * number shown to anyone says "about".
 */

/** Roads wander: typical detour over the straight line. */
const ROAD_FACTOR = 1.25;
/** The first few miles are streets, about 30 mph... */
const STREET_MILES = 5;
const MINUTES_PER_STREET_MILE = 2;
/** ...and the rest mostly highway, about 60 mph. */
const MINUTES_PER_HIGHWAY_MILE = 1;
/** Getting out of one driveway and into the next. */
const START_MINUTES = 5;
/** Jobs this close count as "in the area". */
export const NEARBY_MILES = 6;

let points: Map<string, [number, number]> | null = null;

function point(zip: string): [number, number] | null {
  if (!points) {
    points = new Map();
    for (const entry of ZIPS.split(';')) {
      const [z, ll] = entry.split(':') as [string, string];
      const [lat, lng] = ll.split(',').map(Number) as [number, number];
      points.set(z, [lat, lng]);
    }
  }
  return points.get(zip) ?? null;
}

/** A ZIP's center as { lat, lng }, or null outside the covered area. */
export function zipPoint(zip: string | null | undefined): { lat: number; lng: number } | null {
  const p = zip ? point(zip) : null;
  return p ? { lat: p[0], lng: p[1] } : null;
}

/**
 * The job's ZIP: the one it was booked with, or the last 5-digit number in
 * its address ("12 Oak St, Fenton MO 63026"). Null if neither has one.
 */
export function zipOf(zip: string | null | undefined, address?: string | null): string | null {
  const direct = zip?.trim().match(/^(\d{5})(-\d{4})?$/)?.[1];
  if (direct) return direct;
  const found = address?.match(/\b\d{5}\b(?!.*\b\d{5}\b)/)?.[0];
  return found ?? null;
}

/** Straight-line miles between two ZIP centers, or null if either is unknown. */
export function milesBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const p = point(a);
  const q = point(b);
  if (!p || !q) return null;
  const rad = Math.PI / 180;
  const h =
    Math.sin(((q[0] - p[0]) * rad) / 2) ** 2 +
    Math.cos(p[0] * rad) * Math.cos(q[0] * rad) * Math.sin(((q[1] - p[1]) * rad) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

/** Estimated road miles, rounded to a whole mile. */
export function roadMiles(a: string | null | undefined, b: string | null | undefined): number | null {
  const m = milesBetween(a, b);
  return m === null ? null : Math.round(m * ROAD_FACTOR);
}

/** Estimated minutes of driving, rounded up to 5. Null if either ZIP is unknown. */
export function driveMinutes(a: string | null | undefined, b: string | null | undefined): number | null {
  const m = milesBetween(a, b);
  if (m === null) return null;
  const road = m * ROAD_FACTOR;
  const street = Math.min(road, STREET_MILES);
  const minutes = START_MINUTES + street * MINUTES_PER_STREET_MILE + (road - street) * MINUTES_PER_HIGHWAY_MILE;
  return Math.ceil(minutes / 5) * 5;
}
