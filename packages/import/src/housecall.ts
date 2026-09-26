import { parseMoney } from '@ked/books';
import { readInstant, readTable, type Table } from './table.ts';

/**
 * Housecall Pro's customer and job exports (Customers or Jobs → Actions →
 * Export, which emails a CSV). HCP lets the user pick the columns, so these
 * look for any of the likely header names rather than a fixed layout.
 */

export interface Person {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export interface HcpJob {
  ref: string;
  customer: Person;
  start: string;
  end?: string;
  address?: string;
  status: 'scheduled' | 'cancelled';
  total?: number;
  description?: string;
  notes?: string;
}

export interface Read<T> {
  items: T[];
  /** Row-level problems, as "Row 12: …" (spreadsheet row numbers). */
  problems: string[];
  /** Which headers were used for what, so a preview shows the guesses. */
  columns: Record<string, string>;
}

const NAME = ['display name', 'customer name', 'name', 'full name', 'customer'];
const FIRST = ['first name', 'first', 'customer first name'];
const LAST = ['last name', 'last', 'customer last name'];
const COMPANY = ['company', 'company name'];
const PHONE = ['mobile number', 'mobile phone', 'customer mobile number', 'mobile', 'cell phone', 'customer phone', 'customer mobile', 'phone', 'phone number', 'home number', 'home phone', 'customer home number', 'work number', 'work phone', 'customer work number'];
const EMAIL = ['email', 'email address', 'customer email', 'emails'];
const ADDRESS = ['address', 'service address', 'job address', 'customer address', 'full address'];
const STREET = ['street', 'street 1', 'street address', 'address line 1', 'address 1'];
const UNIT = ['street 2', 'street line 2', 'address line 2', 'address 2', 'unit'];
const CITY = ['city'];
const STATE = ['state', 'region'];
const ZIP = ['zip', 'zip code', 'postal code', 'zipcode'];

function used(t: Table, fields: Record<string, string[]>) {
  const out: Record<string, string> = {};
  for (const [field, names] of Object.entries(fields)) {
    const i = t.col(...names);
    if (i >= 0) out[field] = t.headers[i]!;
  }
  return out;
}

function personOf(t: Table, row: string[], prefer: { notes?: string[] } = {}): Person | null {
  const name =
    t.get(row, ...NAME) || [t.get(row, ...FIRST), t.get(row, ...LAST)].filter(Boolean).join(' ') || t.get(row, ...COMPANY);
  if (!name) return null;
  const street = [t.get(row, ...STREET), t.get(row, ...UNIT)].filter(Boolean).join(' ');
  const cityLine = [t.get(row, ...CITY), [t.get(row, ...STATE), t.get(row, ...ZIP)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  // Split columns win when they carry a city or ZIP: some exports' "Address" is only the street.
  const composed = [street, cityLine].filter(Boolean).join(', ');
  const address = cityLine ? composed : t.get(row, ...ADDRESS) || composed;
  const p: Person = { name };
  const phone = t.get(row, ...PHONE);
  const email = t.get(row, ...EMAIL).split(/[,;\s]+/)[0];
  const notes = prefer.notes ? t.get(row, ...prefer.notes) : '';
  if (phone) p.phone = phone;
  if (email) p.email = email;
  if (address) p.address = address;
  if (notes) p.notes = notes;
  return p;
}

export function readHcpCustomers(text: string): Read<Person> {
  const t = readTable(text, (h) => h.some((c) => [...NAME, ...FIRST, ...COMPANY].map((n) => n.replace(/ /g, '')).includes(c)));
  if (!t) return { items: [], problems: ["Couldn't find a header row with a name column."], columns: {} };
  const notes = ['notes', 'customer notes', 'note'];
  const items: Person[] = [];
  const problems: string[] = [];
  t.rows.forEach((row, i) => {
    const p = personOf(t, row, { notes });
    if (p) items.push(p);
    else problems.push(`Row ${t.line(i)}: no name, skipped.`);
  });
  return {
    items,
    problems,
    columns: used(t, { name: [...NAME, ...FIRST, ...COMPANY], phone: PHONE, email: EMAIL, address: [...ADDRESS, ...STREET], notes }),
  };
}

const REF = ['job number', 'job #', 'job no', 'job id', 'job', 'invoice number', 'invoice #', 'invoice', 'number', 'id'];
const START = ['job scheduled start date', 'scheduled start', 'schedule start', 'scheduled start date', 'scheduled start time', 'start date', 'start', 'scheduled date', 'scheduled for', 'job date', 'date'];
const START_TIME = ['start time', 'scheduled time', 'job arrival window', 'arrival window', 'window', 'time'];
const END = ['job scheduled end date', 'scheduled end', 'schedule end', 'scheduled end date', 'end date', 'end time', 'end'];
const STATUS = ['job status', 'status', 'work status'];
const TOTAL = ['total amount', 'job total', 'total', 'amount', 'invoice total', 'revenue', 'job amount'];
const DESCRIPTION = ['description', 'job description', 'job name', 'line items', 'services', 'service', 'job type', 'title'];
const JOB_NOTES = ['notes', 'job notes', 'private notes'];

/** Jobs in the business's zone (HCP exports local wall-clock times). */
export function readHcpJobs(text: string, timeZone: string): Read<HcpJob> {
  const t = readTable(text, (h) => h.some((c) => START.map((n) => n.replace(/ /g, '')).includes(c)));
  if (!t) return { items: [], problems: ["Couldn't find a header row with a start date column."], columns: {} };
  const items: HcpJob[] = [];
  const problems: string[] = [];
  t.rows.forEach((row, i) => {
    const at = `Row ${t.line(i)}`;
    const ref = t.get(row, ...REF).replace(/^#/, '');
    const customer = personOf(t, row);
    const start = readInstant(t.get(row, ...START), timeZone, t.get(row, ...START_TIME));
    if (!ref) return void problems.push(`${at}: no job number, skipped.`);
    if (!customer) return void problems.push(`${at} (job ${ref}): no customer name, skipped.`);
    if (!start) return void problems.push(`${at} (job ${ref}): no date and time it's scheduled for, skipped.`);
    const end = readInstant(t.get(row, ...END), timeZone);
    const totalText = t.get(row, ...TOTAL);
    const total = totalText ? parseMoney(totalText) : null;
    if (totalText && total === null) problems.push(`${at} (job ${ref}): couldn't read the total "${totalText}", left blank.`);
    const job: HcpJob = {
      ref,
      customer,
      start: start.toISOString(),
      status: /cancel/i.test(t.get(row, ...STATUS)) ? 'cancelled' : 'scheduled',
    };
    if (end && end > start) job.end = end.toISOString();
    if (customer.address) job.address = customer.address;
    if (total !== null && total >= 0) job.total = total;
    const description = t.get(row, ...DESCRIPTION);
    if (description) job.description = description.slice(0, 200);
    const notes = t.get(row, ...JOB_NOTES);
    if (notes) job.notes = notes;
    items.push(job);
  });
  return {
    items,
    problems,
    columns: used(t, { ref: REF, customer: [...NAME, ...FIRST], start: START, end: END, status: STATUS, total: TOTAL, description: DESCRIPTION }),
  };
}
