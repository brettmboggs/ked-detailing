/**
 * The drives in Jacob's week, estimated from ZIP codes (@ked/scheduling's
 * travel.ts): from home to the first job, between jobs, and home again. The
 * calendar draws each drive after the job it leaves from, red when it runs
 * into the next job, and totals the week.
 */
import { HOME_ZIP, driveMinutes, localDate, roadMiles, zipOf } from '@ked/scheduling';
import { type BookingRules, TZ } from './core';
import type { CalJob } from './calendar-shared';

export interface Leg {
  /** The job it leaves from; null when it starts from home. */
  from: CalJob | null;
  /** The job it goes to; null when it ends at home. */
  to: CalJob | null;
  minutes: number;
  miles: number;
  /** Minutes between the two jobs, when both are jobs. */
  room: number | null;
  /** The drive plus pack-up doesn't fit in the room. */
  tight: boolean;
}

const zip = (j: CalJob) => zipOf(j.zip, j.address);

/** One day's drives, in order. Jobs without a ZIP break the chain: no guess is better than a wrong one. */
export function dayLegs(date: string, jobs: CalJob[], rules: BookingRules | null): Leg[] {
  const home = rules?.travel?.homeZip ?? HOME_ZIP;
  const packUp = rules?.travel?.on ? rules.travel.packUpMinutes : 0;
  const today = jobs
    .filter((j) => j.status !== 'cancelled' && localDate(j.start, TZ) === date)
    .sort((a, b) => a.start.localeCompare(b.start));
  const legs: Leg[] = [];
  const add = (from: CalJob | null, to: CalJob | null) => {
    const a = from ? zip(from) : home;
    const b = to ? zip(to) : home;
    const minutes = driveMinutes(a, b);
    const miles = roadMiles(a, b);
    if (minutes === null || miles === null) return;
    const room = from && to ? Math.round((new Date(to.start).getTime() - new Date(from.end).getTime()) / 60_000) : null;
    legs.push({ from, to, minutes, miles, room, tight: room !== null && room < minutes + packUp });
  };
  if (!today.length) return legs;
  add(null, today[0]!);
  for (let i = 1; i < today.length; i++) add(today[i - 1]!, today[i]!);
  add(today.at(-1)!, null);
  return legs;
}

/** "1 h 20 min" or "45 min". */
export function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

/** The week's driving, for the line under the calendar's title. Null with nothing to count. */
export function weekDriving(days: string[], jobs: CalJob[], rules: BookingRules | null) {
  const legs = days.flatMap((d) => dayLegs(d, jobs, rules));
  if (!legs.length) return null;
  const minutes = legs.reduce((s, l) => s + l.minutes, 0);
  const miles = legs.reduce((s, l) => s + l.miles, 0);
  const tight = legs.filter((l) => l.tight).length;
  return { minutes, miles, tight };
}

/** Words for a drive between two jobs, e.g. "About 25 min drive, 11 mi". */
export function legWords(l: Leg) {
  const base = `About ${duration(l.minutes)} drive, ${l.miles} mi`;
  if (!l.tight || l.room === null) return base;
  return `Tight: ${duration(Math.max(0, l.room))} between jobs for about ${duration(l.minutes)} of driving`;
}
