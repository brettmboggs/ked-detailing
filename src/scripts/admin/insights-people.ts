/**
 * Insights → Customers, Leads and sources, and Where: who spends the most and
 * comes back, which channels bring people who book and spend, and which ZIPs
 * are worth a round of door hangers.
 */
import { h } from './core';
import { goTab, pending } from './calendar-shared';
import {
  type Insights,
  delta,
  figures,
  num,
  orDash,
  part,
  pct,
  section,
  shortDay,
  table,
  usd,
} from './insights-lib';

/** "2026 Q3" → "Jul to Sep 2026". */
const seasonName = (q: string) => {
  const [y, n] = [q.slice(0, 4), Number(q.slice(-1))];
  return `${['Jan to Mar', 'Apr to Jun', 'Jul to Sep', 'Oct to Dec'][n - 1]} ${y}`;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Opens a customer's profile in the Customers tab. */
function openCustomer(id: string) {
  pending.customer = id;
  goTab('customers');
}

export function customersSection(d: Insights) {
  const c = d.customers;
  const cmp = d.period.compare;
  const bits: string[] = [];
  if (c.top20.share !== null && c.top20.of >= 5) bits.push(`Your best 20% of customers (${c.top20.count} people) brought in ${pct(c.top20.share)} of this period’s money: look after them first.`);
  if (c.overdue.count) bits.push(`${plural(c.overdue.count, 'regular')} ${c.overdue.count === 1 ? 'is' : 'are'} overdue for a visit.`);
  if (c.lapsed.count) bits.push(`${plural(c.lapsed.count, 'customer')} haven’t been back in 6 months; one visit each would be about ${usd(c.lapsed.atRisk)}.`);
  const means = bits.join(' ') || `${plural(c.total, 'customer')} so far. The more of them come back, the less you spend finding new ones.`;

  return section(
    'Customers',
    means,
    [
      'A customer has at least one finished job. People who only asked for a quote are counted apart.',
      'New means their first finished job falls in the period. Came back means two or more finished jobs, ever.',
      'Back within 6 months looks at everyone whose first job was at least 6 months ago and counts who had a second one within 6 months of the first (same for 12).',
      'Lifetime value is everything a customer has spent, averaged over all customers. Days between visits averages each repeat customer’s own gaps.',
      'Lapsed: nothing booked and the last finished job over 180 days ago. The money at risk is one visit each at their usual price.',
      'Overdue regulars: two or more visits, nothing booked, and a quarter longer than their usual gap since the last one.',
      'Top customers and the best 20% use money spent in this period.',
    ],
    figures([
      { label: 'Customers', value: num(c.total), sub: c.leadsOnly ? `And ${num(c.leadsOnly)} who asked but haven’t booked` : null },
      { label: 'New this period', value: num(c.new), change: delta(c.new, c.newPrev, cmp) },
      { label: 'Came back', value: pct(c.repeatRate), sub: `${num(c.repeat)} of ${num(c.total)} booked twice or more` },
      { label: 'Back within 6 months', value: pct(c.back6.rate), sub: `${num(c.back6.back)} of ${num(c.back6.base)}; within a year ${pct(c.back12.rate)}` },
      { label: 'Visits each', value: num(c.avgVisits, 1), sub: c.avgDaysBetween ? `About every ${plural(c.avgDaysBetween, 'day')} for regulars` : null },
      { label: 'Lifetime value', value: orDash(c.lifetimeValue), sub: 'What a customer spends, on average, so far' },
      { label: 'Overdue regulars', value: num(c.overdue.count), sub: c.overdue.count ? `About ${usd(c.overdue.value)} a round of visits` : null },
      { label: 'Lapsed', value: num(c.lapsed.count), sub: c.lapsed.count ? `${usd(c.lapsed.atRisk)} at risk` : null },
    ]),
    part('Who spent the most', 'This period. Tap a name to open them in Customers.'),
    table(
      [
        { label: 'Customer', cell: (t) => h('span', { class: 'text-bone-50 underline decoration-ink-600 underline-offset-4' }, t.name) },
        { label: 'Spent', cell: (t) => usd(t.spend), num: true },
        { label: 'Visits', cell: (t) => num(t.visits), num: true },
        { label: 'All time', cell: (t) => `${usd(t.lifetimeSpend)} · ${t.lifetimeVisits}`, num: true, wide: true },
        { label: 'Last', cell: (t) => (t.lastVisit ? shortDay(t.lastVisit, true) : '—'), num: true, wide: true },
        { label: 'Next', cell: (t) => (t.nextVisit ? shortDay(t.nextVisit.slice(0, 10), true) : h('span', { class: 'text-bone-500' }, 'None')), num: true },
      ],
      c.top,
      { empty: 'No one has finished a job in this period yet.', onRow: (t) => openCustomer(t.id), rowLabel: (t) => `Open ${t.name}` },
    ),
    c.top20.of
      ? h('p', { class: 'mt-3 text-sm text-bone-400' }, `${plural(c.top20.of, 'customer')} spent money in this period. The top ${c.top20.count} spent ${usd(c.top20.revenue)} of it.`)
      : null,
    part('Do new customers come back?', 'Customers grouped by the season of their first job. Recent groups have had less time to return.'),
    table(
      [
        { label: 'First job', cell: (q) => seasonName(q.quarter) },
        { label: 'New', cell: (q) => num(q.customers), num: true },
        { label: 'Came back', cell: (q) => num(q.cameBack), num: true },
        { label: 'Share', cell: (q) => pct(q.rate), num: true },
        { label: 'Spent each', cell: (q) => orDash(q.avgSpend), num: true },
      ],
      c.cohorts,
    ),
  );
}

export function sourcesSection(d: Insights) {
  const l = d.leads;
  const cmp = d.period.compare;
  const counted = d.sources.filter((s) => s.source !== 'unknown');
  const best = [...counted].sort((a, b) => b.revenue - a.revenue)[0];
  const bestBook = counted.filter((s) => s.leads >= 3).sort((a, b) => (b.conversion ?? 0) - (a.conversion ?? 0))[0];
  const bits: string[] = [];
  if (best?.revenue) bits.push(`${best.label} customers spent the most this period (${usd(best.revenue)}).`);
  if (bestBook?.conversion) bits.push(`${bestBook.label} quote requests book best: ${bestBook.leadsBooked} of ${bestBook.leads}.`);
  if (l.leads) bits.push(`Overall ${plural(l.leads, 'quote request')}, ${num(l.booked)} booked.`);
  const online = d.money.cur.online;
  const phone = d.money.cur.phone;

  const wrap = section(
    'Leads and sources',
    bits.join(' ') || 'Where people hear about you shows here as quote requests and bookings come in.',
    [
      'Where someone came from is what they picked on the quote page ("How did you hear about us?"), or a guess from the link they came in on. It is set once, the first time.',
      'A quote request counts in the period it came in. It counts as booked if you marked it booked or the person booked a job after asking.',
      'Money this period is what customers from that source spent in the period, new or old.',
      'Cost per new customer and return use your marketing spend below: money spent in the period (a month’s spend is spread over its days), and what the new customers it brought have spent so far.',
      'Booked online means the customer booked on the website; by phone means you added the job.',
    ],
    figures([
      { label: 'Quote requests', value: num(l.leads), change: delta(l.leads, l.prev?.leads, cmp) },
      { label: 'Booked from them', value: num(l.booked), sub: l.leads ? `${pct(l.conversion)} of requests` : null, change: delta(l.booked, l.prev?.booked, cmp) },
      { label: 'Booked online', value: num(online), sub: online + phone ? `${pct(online / (online + phone))} of bookings` : null },
      { label: 'Booked by phone', value: num(phone), sub: 'Jobs you added yourself' },
    ]),
    table(
      [
        { label: 'Came from', cell: (s) => s.label },
        { label: 'Requests', cell: (s) => num(s.leads), num: true },
        { label: 'Booked', cell: (s) => (s.leads ? `${s.leadsBooked} · ${pct(s.conversion)}` : '—'), num: true },
        { label: 'New', cell: (s) => num(s.newCustomers), num: true },
        { label: 'Money', cell: (s) => usd(s.revenue), num: true },
        { label: 'Spent each, ever', cell: (s) => orDash(s.avgLifetimeSpend), num: true, wide: true },
        { label: 'Came back', cell: (s) => pct(s.repeatRate), num: true, wide: true },
        { label: 'Ads', cell: (s) => (s.spend ? usd(s.spend) : '—'), num: true },
        { label: 'Per new customer', cell: (s) => orDash(s.costPerCustomer), num: true },
        { label: 'Back per $1', cell: (s) => (s.returnOnSpend === null ? '—' : `$${s.returnOnSpend.toFixed(2)}`), num: true },
      ],
      d.sources,
      { empty: 'No sources yet.' },
    ),
    part('Who sends you the most', 'Customers whose referral link brought someone in. Thank them.'),
    table(
      [
        { label: 'Customer', cell: (r) => h('span', { class: 'text-bone-50 underline decoration-ink-600 underline-offset-4' }, r.name) },
        { label: 'Sent', cell: (r) => num(r.referrals), num: true },
        { label: 'They spent', cell: (r) => usd(r.referredRevenue), num: true },
      ],
      d.referrers,
      { empty: 'No one has used a referral link yet.', onRow: (r) => openCustomer(r.id), rowLabel: (r) => `Open ${r.name}` },
    ),
  );
  wrap.setAttribute('data-insights-sources', '');
  return wrap;
}

export function whereSection(d: Insights) {
  const zips = d.zips;
  const top = zips[0];
  const near = d.nearby[0];
  const bits: string[] = [];
  if (top?.periodRevenue) bits.push(`${top.zip}${top.town ? ` (${top.town})` : ''} brought the most this period: ${usd(top.periodRevenue)}.`);
  if (near) {
    const from = zips.find((z) => z.zip === near.near);
    bits.push(`${near.zip} (${near.town}) is ${near.nearMiles} miles from ${near.near}${from?.town ? ` (${from.town})` : ''}, where customers pay well, and has ${near.customers ? 'one customer' : 'no customers'}: market there next.`);
  }
  const shown = zips.slice(0, 25);
  const more = zips.slice(25);
  const cols = [
    { label: 'ZIP', cell: (z: Insights['zips'][number]) => h('span', { class: 'tabular-nums' }, z.zip) },
    { label: 'Town', cell: (z: Insights['zips'][number]) => z.town ?? '—' },
    { label: 'Miles', cell: (z: Insights['zips'][number]) => (z.miles === null ? '—' : z.miles < 2 ? 'Home' : `about ${z.miles}`), num: true, wide: true },
    { label: 'Customers', cell: (z: Insights['zips'][number]) => num(z.customers), num: true },
    { label: 'Came back', cell: (z: Insights['zips'][number]) => pct(z.repeatRate), num: true, wide: true },
    { label: 'Avg job', cell: (z: Insights['zips'][number]) => orDash(z.avgTicket), num: true },
    { label: 'This period', cell: (z: Insights['zips'][number]) => (z.periodRevenue ? usd(z.periodRevenue) : '—'), num: true },
    { label: 'Per hour', cell: (z: Insights['zips'][number]) => orDash(z.perHour), num: true, wide: true },
    { label: 'Travel fee', cell: (z: Insights['zips'][number]) => (z.travelFee === null ? 'Ask' : z.travelFee ? usd(z.travelFee) : 'None'), num: true, wide: true },
  ];

  return section(
    'Where',
    bits.join(' ') || 'Where your customers are shows here once jobs have ZIP codes.',
    [
      'A customer’s ZIP is the one on their latest job. Customers, came back and average job are all-time; this period is money from finished jobs there in the period.',
      'Miles are a straight line from High Ridge (63049), so the drive is a bit longer. Per hour divides that ZIP’s money by the hours its quotes expected, before driving.',
      'Close by lists ZIPs within 5 miles of one where at least 3 customers pay your usual price or more, with one customer or none yet.',
    ],
    table(cols, shown, { empty: 'No jobs with a ZIP yet.' }),
    more.length ? h('details', { class: 'mt-2' }, h('summary', { class: 'cursor-pointer select-none py-1 text-sm text-bone-400 hover:text-bone-200' }, `${plural(more.length, 'more ZIP')}`), table(cols, more)) : null,
    d.nearby.length
      ? h(
          'div',
          {},
          part('Close to your best areas, with hardly anyone yet', 'Door hangers, a Nextdoor post or a yard sign here reach the neighbours of people who already pay well.'),
          table(
            [
              { label: 'ZIP', cell: (n) => h('span', { class: 'tabular-nums' }, n.zip) },
              { label: 'Town', cell: (n) => n.town },
              { label: 'Next to', cell: (n) => `${n.near}, ${n.nearMiles} mi`, num: true },
              { label: 'From home', cell: (n) => (n.miles === null ? '—' : `about ${n.miles} mi`), num: true, wide: true },
              { label: 'Customers', cell: (n) => num(n.customers), num: true },
            ],
            d.nearby,
          ),
        )
      : null,
    d.towns.length
      ? h(
          'div',
          {},
          part('By town'),
          table(
            [
              { label: 'Town', cell: (t) => t.town },
              { label: 'ZIPs', cell: (t) => t.zips.join(', '), wide: true },
              { label: 'Customers', cell: (t) => num(t.customers), num: true },
              { label: 'Avg job', cell: (t) => orDash(t.avgTicket), num: true },
              { label: 'All time', cell: (t) => usd(t.revenue), num: true },
            ],
            d.towns.slice(0, 15),
          ),
        )
      : null,
  );
}
