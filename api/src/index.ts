import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { endSession, requestEmailLogin, requireOwner, signInWithApple, verifyEmailLogin, type Owner } from './auth.ts';
import { deleteRule, importBank, listBankLines, listRules, resolveBankLine } from './bank.ts';
import { importCustomers, importEntries, importJobs } from './imports.ts';
import { booksInbox } from './inbox.ts';
import { availability, createBooking, currentRules, saveRules } from './booking.ts';
import {
  addAccount,
  createExpense,
  createIncome,
  createTransfer,
  currentBooksSettings,
  getEntry,
  listAccounts,
  listEntries,
  listPayees,
  saveBooksSettings,
  savePayee,
  updateAccount,
  voidEntry,
} from './books.ts';
import { getCustomer, listCustomers, updateCustomer } from './customers.ts';
import { addTimeOff, createJob, customerJobs, getJob, listJobs, listTimeOff, removeTimeOff, updateJob } from './jobs.ts';
import {
  getInvoice,
  invoiceForJob,
  listInvoices,
  publicInvoice,
  recordInvoicePayment,
  sendInvoice,
  startCheckout,
  updateInvoice,
  voidInvoice,
} from './invoices.ts';
import {
  addMovement,
  createItem,
  getItem,
  itemByBarcode,
  jobUsage,
  listItems,
  listMovements,
  listUsage,
  saveJobUsage,
  saveUsage,
  updateItem,
} from './inventory.ts';
import { createLead, listLeads, updateLead } from './leads.ts';
import { cancelBooking, confirmationText, manageAvailability, manageUrl, reschedule, viewBooking } from './manage.ts';
import {
  bookingCancelled,
  bookingMade,
  bookingMoved,
  invoiceOpened,
  leadMade,
  listAlerts,
  registerDevice,
  removeDevice,
} from './notify.ts';
import { ApiError, countingDb, json, list, text, type Bindings } from './lib.ts';
import { attachReceipt, deletePhoto, jobPhotos, photoResponse, uploadPhoto } from './photos.ts';
import { currentPricing, savePricing } from './pricing.ts';
import { currentSite, saveSite, sitePhotoResponse, uploadSitePhoto } from './site.ts';
import { campaigns } from './crm-campaigns.ts';
import { customers as crmCustomers } from './crm-customers.ts';
import { followups, runDaily } from './crm-followups.ts';
import { insights, runWeekly } from './crm-insights.ts';
import { crmPublic } from './crm-public.ts';
import {
  addTrip,
  balancesReport,
  contractorsReport,
  exportCsv,
  listTrips,
  mileageReport,
  profitLossReport,
  removeTrip,
} from './reports.ts';

/**
 * The contract lives in docs/mobile-app.md. Change it there first, then here.
 */
const app = new Hono<{ Bindings: Bindings; Variables: { owner: Owner } }>().basePath('/v1');

// Browsers only hit the public endpoints; the native app doesn't send Origin.
app.use('*', (c, next) =>
  cors({
    origin: (origin) => (list(c.env.ALLOWED_ORIGINS).includes(origin.toLowerCase()) ? origin : null),
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // So the admin can name CSV downloads the way the API does.
    exposeHeaders: ['Content-Disposition'],
    maxAge: 86400,
  })(c, next),
);

// Tests only: report each request's D1 query count (see countingDb).
app.use('*', async (c, next) => {
  if (c.env.COUNT_QUERIES !== '1') return next();
  const count = { n: 0 };
  c.env = { ...c.env, DB: countingDb(c.env.DB, count) };
  await next();
  c.res.headers.set('X-D1-Queries', String(count.n));
});

/* ------------------------------------------------------------- public */

app.get('/pricing', async (c) => {
  const pricing = await currentPricing(c.env.DB);
  // Short cache: a save shows up on the website within a minute.
  c.header('Cache-Control', 'public, max-age=60');
  return c.json(pricing);
});

// Working days and hours, for the website's footer and search listing. The
// limits (jobs a day, notice) stay private.
app.get('/hours', async (c) => {
  const { rules, updatedAt } = await currentRules(c.env.DB);
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({ timezone: rules.timezone, week: rules.week, updatedAt });
});

// The website's words and photos as Jacob edited them (only what he changed).
// The build lays them over src/data/site.ts. Photos only while the site uses them.
app.get('/site', async (c) => {
  c.header('Cache-Control', 'public, max-age=60');
  return c.json(await currentSite(c.env.DB));
});
app.get('/site/photos/:id', async (c) => sitePhotoResponse(c.env, c.req.param('id')));

/** Alerts run after the response, so a slow push never holds up the customer. */
const later = (c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }, work: Promise<unknown>) =>
  c.executionCtx.waitUntil(work.catch((err) => console.error('alert failed', err)));

app.post('/leads', async (c) => {
  const lead = await createLead(c.env.DB, await json(c.req.raw));
  if (lead.quote) later(c, leadMade(c.env, lead.id)); // no quote means the honeypot caught it
  return c.json(lead, 201);
});

// Open start times for a job, priced and sized from the customer's answers.
app.post('/availability', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await availability(c.env.DB, await json(c.req.raw)));
});

app.post('/bookings', async (c) => {
  const booking = await createBooking(c.env.DB, await json(c.req.raw));
  if (!booking.start) return c.json(booking, 201); // the honeypot caught it
  later(c, bookingMade(c.env, booking.id));
  const { manageToken, ...rest } = booking;
  return c.json({ ...rest, manageUrl: manageUrl(c.env, manageToken!) }, 201);
});

// The customer's own booking, by the secret in their link. Never cached.
app.get('/manage/:token', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await viewBooking(c.env, c.req.param('token')));
});
app.get('/manage/:token/availability', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await manageAvailability(c.env, c.req.param('token')));
});
app.post('/manage/:token/reschedule', async (c) => {
  const r = await reschedule(c.env, c.req.param('token'), await json(c.req.raw));
  if (r.moved) later(c, bookingMoved(c.env, r.jobId!, r.from!));
  return c.json(r.booking);
});
app.post('/manage/:token/cancel', async (c) => {
  const r = await cancelBooking(c.env, c.req.param('token'), await json(c.req.raw).catch(() => ({})));
  later(c, bookingCancelled(c.env, r.jobId, r.reason));
  return c.json(r.booking);
});

// A customer's invoice, by the secret in their pay link. Never cached: it
// changes the moment they pay.
app.get('/pay/:token', async (c) => {
  c.header('Cache-Control', 'no-store');
  const { view, opened } = await publicInvoice(c.env, c.req.param('token'));
  if (opened) later(c, invoiceOpened(c.env, opened));
  return c.json(view);
});
app.post('/pay/:token/checkout', async (c) => c.json(await startCheckout(c.env, c.req.param('token'))));

// The web admin signs in with a one-time link emailed to an owner address.
app.post('/auth/email', async (c) => c.json(await requestEmailLogin(c.env, await json(c.req.raw))));
app.post('/auth/email/verify', async (c) => c.json(await verifyEmailLogin(c.env, await json(c.req.raw))));
app.delete('/auth/session', async (c) => {
  await endSession(c.env, c.req.header('Authorization'));
  return c.body(null, 204);
});

app.post('/auth/apple', async (c) => {
  const identityToken = text((await json(c.req.raw)).identityToken, 'identityToken', 5000);
  if (!identityToken) throw new ApiError(422, 'invalid', 'identityToken is required.');
  return c.json(await signInWithApple(c.env, identityToken));
});

/* -------------------------------------------------------------- owner */

/**
 * The website bakes prices and hours in at build time, so a save rebuilds it
 * through the Pages deploy hook. No git involved: the build reads them from
 * here. Best effort, since the save has already succeeded.
 */
function rebuildSite(c: { env: Bindings; executionCtx: { waitUntil(p: Promise<unknown>): void } }) {
  const hook = c.env.PAGES_DEPLOY_HOOK;
  if (!hook) return;
  c.executionCtx.waitUntil(
    fetch(hook, { method: 'POST' }).then(
      (r) => { if (!r.ok) console.error(`deploy hook: HTTP ${r.status}`); },
      (err) => console.error('deploy hook failed', err),
    ),
  );
}

app.put('/pricing', requireOwner, async (c) => {
  const owner = c.get('owner');
  const saved = await savePricing(c.env.DB, await json(c.req.raw), owner.email ?? owner.subject);
  rebuildSite(c); // leads are re-priced here either way
  return c.json(saved);
});

app.get('/leads', requireOwner, async (c) => c.json({ leads: await listLeads(c.env.DB, c.req.query('status')) }));

app.patch('/leads/:id', requireOwner, async (c) =>
  c.json(await updateLead(c.env.DB, c.req.param('id'), await json(c.req.raw))),
);

app.get('/settings/booking', requireOwner, async (c) => c.json(await currentRules(c.env.DB)));
app.put('/settings/booking', requireOwner, async (c) => {
  const owner = c.get('owner');
  const saved = await saveRules(c.env.DB, await json(c.req.raw), owner.email ?? owner.subject);
  rebuildSite(c);
  return c.json(saved);
});

app.put('/site', requireOwner, async (c) => {
  const saved = await saveSite(c.env, await json(c.req.raw), who(c.get('owner')), (p) => c.executionCtx.waitUntil(p.catch((err) => console.error('site photo sweep', err))));
  rebuildSite(c);
  return c.json(saved);
});
// Raw image body, like /photos. Not public until a PUT /site uses it.
app.post('/site/photos', requireOwner, async (c) => c.json(await uploadSitePhoto(c.env, c.req.raw), 201));

app.get('/jobs', requireOwner, async (c) => c.json({ jobs: await listJobs(c.env.DB, c.req.query('from'), c.req.query('to')) }));
app.post('/jobs', requireOwner, async (c) => c.json(await createJob(c.env.DB, await json(c.req.raw)), 201));
app.post('/jobs/:id/confirmation', requireOwner, async (c) => c.json(await confirmationText(c.env, c.req.param('id'))));
app.get('/jobs/:id', requireOwner, async (c) => c.json(await getJob(c.env.DB, c.req.param('id'))));
app.patch('/jobs/:id', requireOwner, async (c) =>
  c.json(await updateJob(c.env.DB, c.req.param('id'), await json(c.req.raw))),
);

app.get('/customers', requireOwner, async (c) => c.json({ customers: await listCustomers(c.env.DB, c.req.query('q')) }));
app.get('/customers/:id', requireOwner, async (c) => {
  const id = c.req.param('id');
  return c.json({ ...(await getCustomer(c.env.DB, id)), jobs: await customerJobs(c.env.DB, id) });
});
app.patch('/customers/:id', requireOwner, async (c) =>
  c.json(await updateCustomer(c.env.DB, c.req.param('id'), await json(c.req.raw))),
);

app.get('/time-off', requireOwner, async (c) =>
  c.json({ timeOff: await listTimeOff(c.env.DB, c.req.query('from'), c.req.query('to')) }),
);
app.post('/time-off', requireOwner, async (c) => c.json(await addTimeOff(c.env.DB, await json(c.req.raw)), 201));
app.delete('/time-off/:id', requireOwner, async (c) => {
  await removeTimeOff(c.env.DB, c.req.param('id'));
  return c.body(null, 204);
});

/* ------------------------------------------------------------- photos */

// Raw image body; ?kind=receipt|job&jobId=&stage=before|after&caption=
app.post('/photos', requireOwner, async (c) => c.json(await uploadPhoto(c.env, c.req.raw, c.req.query()), 201));
app.get('/photos/:id', requireOwner, async (c) => photoResponse(c.env, c.req.param('id')));
app.delete('/photos/:id', requireOwner, async (c) => {
  await deletePhoto(c.env, c.req.param('id'));
  return c.body(null, 204);
});
app.get('/jobs/:id/photos', requireOwner, async (c) => c.json({ photos: await jobPhotos(c.env.DB, c.req.param('id')) }));

const who = (o: Owner) => o.email ?? o.subject;

/* ------------------------------------------------------------- alerts */

app.post('/devices', requireOwner, async (c) => c.json(await registerDevice(c.env.DB, await json(c.req.raw), who(c.get('owner'))), 201));
// The token has brackets in it, so it goes in the body rather than the path.
app.delete('/devices', requireOwner, async (c) => {
  await removeDevice(c.env.DB, String((await json(c.req.raw)).token ?? ''));
  return c.body(null, 204);
});
app.get('/alerts', requireOwner, async (c) => c.json({ alerts: await listAlerts(c.env.DB) }));

/* ----------------------------------------------------------- invoices */

// The job's live invoice, made from its quote if it has none yet.
app.post('/jobs/:id/invoice', requireOwner, async (c) => {
  const body = await json(c.req.raw).catch(() => ({}));
  const { invoice, created } = await invoiceForJob(c.env, c.req.param('id'), body);
  return c.json(invoice, created ? 201 : 200);
});
app.get('/invoices', requireOwner, async (c) =>
  c.json({
    invoices: await listInvoices(c.env, {
      status: c.req.query('status'),
      jobId: c.req.query('jobId'),
      customerId: c.req.query('customerId'),
    }),
  }),
);
app.get('/invoices/:id', requireOwner, async (c) => c.json(await getInvoice(c.env, c.req.param('id'))));
app.patch('/invoices/:id', requireOwner, async (c) =>
  c.json(await updateInvoice(c.env, c.req.param('id'), await json(c.req.raw))),
);
app.post('/invoices/:id/send', requireOwner, async (c) => c.json(await sendInvoice(c.env, c.req.param('id'))));
app.post('/invoices/:id/payments', requireOwner, async (c) =>
  c.json(await recordInvoicePayment(c.env, c.req.param('id'), await json(c.req.raw), who(c.get('owner'))), 201),
);
app.post('/invoices/:id/void', requireOwner, async (c) => c.json(await voidInvoice(c.env, c.req.param('id'))));

/* ---------------------------------------------------------- inventory */

app.get('/inventory', requireOwner, async (c) => c.json(await listItems(c.env.DB, c.req.query())));
app.post('/inventory', requireOwner, async (c) => c.json(await createItem(c.env.DB, await json(c.req.raw), who(c.get('owner'))), 201));
// Before /:id, so these aren't read as item IDs.
app.get('/inventory/barcode/:code', requireOwner, async (c) => c.json(await itemByBarcode(c.env.DB, c.req.param('code'))));
app.get('/inventory/usage', requireOwner, async (c) => c.json(await listUsage(c.env.DB)));
app.put('/inventory/usage/:service', requireOwner, async (c) =>
  c.json(await saveUsage(c.env.DB, c.req.param('service'), await json(c.req.raw))),
);
app.get('/inventory/:id', requireOwner, async (c) => c.json(await getItem(c.env.DB, c.req.param('id'))));
app.patch('/inventory/:id', requireOwner, async (c) => c.json(await updateItem(c.env.DB, c.req.param('id'), await json(c.req.raw))));
app.get('/inventory/:id/movements', requireOwner, async (c) => c.json({ movements: await listMovements(c.env.DB, c.req.param('id')) }));
app.post('/inventory/:id/movements', requireOwner, async (c) =>
  c.json(await addMovement(c.env.DB, c.req.param('id'), await json(c.req.raw), who(c.get('owner'))), 201),
);
app.get('/jobs/:id/usage', requireOwner, async (c) => c.json(await jobUsage(c.env.DB, c.req.param('id'))));
app.put('/jobs/:id/usage', requireOwner, async (c) =>
  c.json(await saveJobUsage(c.env.DB, c.req.param('id'), await json(c.req.raw), who(c.get('owner')))),
);

/* ------------------------------------------------------------ cutover */

// Fed in small chunks by tools/import. Re-running is safe: repeats are skipped.
app.post('/import/customers', requireOwner, async (c) => c.json(await importCustomers(c.env.DB, await json(c.req.raw))));
app.post('/import/jobs', requireOwner, async (c) => c.json(await importJobs(c.env.DB, await json(c.req.raw))));
app.post('/import/entries', requireOwner, async (c) =>
  c.json(await importEntries(c.env.DB, await json(c.req.raw), who(c.get('owner')))),
);

/* -------------------------------------------------------------- books */

app.get('/books/accounts', requireOwner, async (c) =>
  c.json({ accounts: await listAccounts(c.env.DB, c.req.query('archived') === 'true') }),
);
app.post('/books/accounts', requireOwner, async (c) => c.json(await addAccount(c.env.DB, await json(c.req.raw)), 201));
app.patch('/books/accounts/:id', requireOwner, async (c) =>
  c.json(await updateAccount(c.env.DB, c.req.param('id'), await json(c.req.raw))),
);

app.get('/books/payees', requireOwner, async (c) => c.json({ payees: await listPayees(c.env.DB, c.req.query('q')) }));
app.post('/books/payees', requireOwner, async (c) => c.json(await savePayee(c.env.DB, null, await json(c.req.raw)), 201));
app.patch('/books/payees/:id', requireOwner, async (c) =>
  c.json(await savePayee(c.env.DB, c.req.param('id'), await json(c.req.raw))),
);

app.post('/books/expenses', requireOwner, async (c) =>
  c.json(await createExpense(c.env.DB, await json(c.req.raw), who(c.get('owner'))), 201),
);
app.post('/books/income', requireOwner, async (c) =>
  c.json(await createIncome(c.env.DB, await json(c.req.raw), who(c.get('owner'))), 201),
);
app.post('/books/transfers', requireOwner, async (c) =>
  c.json(await createTransfer(c.env.DB, await json(c.req.raw), who(c.get('owner'))), 201),
);
app.get('/books/entries', requireOwner, async (c) =>
  c.json({
    entries: await listEntries(c.env.DB, {
      from: c.req.query('from'),
      to: c.req.query('to'),
      accountId: c.req.query('accountId'),
      jobId: c.req.query('jobId'),
    }),
  }),
);
app.post('/books/entries/:id/receipt', requireOwner, async (c) => {
  await attachReceipt(c.env.DB, c.req.param('id'), await json(c.req.raw));
  return c.json(await getEntry(c.env.DB, c.req.param('id')));
});
app.get('/books/entries/:id', requireOwner, async (c) => c.json(await getEntry(c.env.DB, c.req.param('id'))));
// Entries are never deleted: voiding posts the exact reversal.
app.post('/books/entries/:id/void', requireOwner, async (c) =>
  c.json(await voidEntry(c.env.DB, c.req.param('id'), await json(c.req.raw).catch(() => ({})), who(c.get('owner'))), 201),
);

app.post('/books/bank-imports', requireOwner, async (c) =>
  c.json(await importBank(c.env.DB, await json(c.req.raw), who(c.get('owner'))), 201),
);
app.get('/books/bank-lines', requireOwner, async (c) =>
  c.json({
    lines: await listBankLines(c.env.DB, { status: c.req.query('status'), accountId: c.req.query('accountId'), auto: c.req.query('auto') }),
  }),
);
app.get('/books/rules', requireOwner, async (c) => c.json({ rules: await listRules(c.env.DB) }));
app.delete('/books/rules/:id', requireOwner, async (c) => {
  await deleteRule(c.env.DB, c.req.param('id'));
  return c.body(null, 204);
});
app.get('/books/inbox', requireOwner, async (c) => c.json(await booksInbox(c.env.DB)));
app.post('/books/bank-lines/:id', requireOwner, async (c) =>
  c.json(await resolveBankLine(c.env.DB, c.req.param('id'), await json(c.req.raw), who(c.get('owner')))),
);

app.get('/books/trips', requireOwner, async (c) => c.json({ trips: await listTrips(c.env.DB, c.req.query('year')) }));
app.post('/books/trips', requireOwner, async (c) => c.json(await addTrip(c.env.DB, await json(c.req.raw)), 201));
app.delete('/books/trips/:id', requireOwner, async (c) => {
  await removeTrip(c.env.DB, c.req.param('id'));
  return c.body(null, 204);
});

app.get('/books/reports/profit-loss', requireOwner, async (c) =>
  c.json(await profitLossReport(c.env.DB, c.req.query('from'), c.req.query('to'))),
);
app.get('/books/reports/balances', requireOwner, async (c) => c.json(await balancesReport(c.env.DB, c.req.query('asOf'))));
app.get('/books/reports/contractors', requireOwner, async (c) => c.json(await contractorsReport(c.env.DB, c.req.query('year'))));
app.get('/books/reports/mileage', requireOwner, async (c) => c.json(await mileageReport(c.env.DB, c.req.query('year'))));
app.get('/books/export/:report', requireOwner, async (c) => {
  const { filename, csv } = await exportCsv(c.env.DB, c.req.param('report'), c.req.query());
  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
});

app.get('/settings/books', requireOwner, async (c) => c.json(await currentBooksSettings(c.env.DB)));
app.put('/settings/books', requireOwner, async (c) =>
  c.json(await saveBooksSettings(c.env.DB, await json(c.req.raw), who(c.get('owner')))),
);

/* ---------------------------------------------------------------- crm */

// Each CRM area is its own router in crm-*.ts (docs/crm.md). The owner ones
// check the session themselves.
app.route('/crm/public', crmPublic);
app.route('/crm/customers', crmCustomers);
app.route('/crm/follow-ups', followups);
app.route('/crm/insights', insights);
app.route('/crm/campaigns', campaigns);

/* ------------------------------------------------------------- errors */

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      err.status,
    );
  }
  if (err instanceof HTTPException) {
    return c.json({ error: { code: 'http_error', message: err.message } }, err.status);
  }
  console.error(err);
  return c.json({ error: { code: 'server_error', message: 'Something went wrong on our side.' } }, 500);
});

export default {
  fetch: app.fetch,
  // Cron triggers in wrangler.jsonc: daily follow-ups, and the weekly summary on Mondays.
  async scheduled(event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    const work = event.cron === WEEKLY_CRON ? runWeekly(env) : runDaily(env);
    ctx.waitUntil(work.catch((err) => console.error(`cron ${event.cron} failed`, err)));
  },
} satisfies ExportedHandler<Bindings>;

/** Must match the weekly entry in wrangler.jsonc's triggers.crons. */
const WEEKLY_CRON = '0 13 * * 1';
