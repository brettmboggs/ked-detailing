import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { requireOwner, signInWithApple, type Owner } from './auth.ts';
import { deleteRule, importBank, listBankLines, listRules, resolveBankLine } from './bank.ts';
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
import { createLead, listLeads, updateLead } from './leads.ts';
import { ApiError, json, list, text, type Bindings } from './lib.ts';
import { attachReceipt, deletePhoto, jobPhotos, photoResponse, uploadPhoto } from './photos.ts';
import { currentPricing, savePricing } from './pricing.ts';
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
    maxAge: 86400,
  })(c, next),
);

/* ------------------------------------------------------------- public */

app.get('/pricing', async (c) => {
  const pricing = await currentPricing(c.env.DB);
  // Short cache: a save shows up on the website within a minute.
  c.header('Cache-Control', 'public, max-age=60');
  return c.json(pricing);
});

app.post('/leads', async (c) => c.json(await createLead(c.env.DB, await json(c.req.raw)), 201));

// Open start times for a job, priced and sized from the customer's answers.
app.post('/availability', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await availability(c.env.DB, await json(c.req.raw)));
});

app.post('/bookings', async (c) => c.json(await createBooking(c.env.DB, await json(c.req.raw)), 201));

// A customer's invoice, by the secret in their pay link. Never cached: it
// changes the moment they pay.
app.get('/pay/:token', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await publicInvoice(c.env, c.req.param('token')));
});
app.post('/pay/:token/checkout', async (c) => c.json(await startCheckout(c.env, c.req.param('token'))));

app.post('/auth/apple', async (c) => {
  const identityToken = text((await json(c.req.raw)).identityToken, 'identityToken', 5000);
  if (!identityToken) throw new ApiError(422, 'invalid', 'identityToken is required.');
  return c.json(await signInWithApple(c.env, identityToken));
});

/* -------------------------------------------------------------- owner */

app.put('/pricing', requireOwner, async (c) => {
  const owner = c.get('owner');
  const saved = await savePricing(c.env.DB, await json(c.req.raw), owner.email ?? owner.subject);
  // The website bakes prices in at build time, so rebuild it. Best effort: the
  // save has already succeeded, and leads are re-priced here either way.
  const hook = c.env.PAGES_DEPLOY_HOOK;
  if (hook) {
    c.executionCtx.waitUntil(
      fetch(hook, { method: 'POST' }).then(
        (r) => { if (!r.ok) console.error(`deploy hook: HTTP ${r.status}`); },
        (err) => console.error('deploy hook failed', err),
      ),
    );
  }
  return c.json(saved);
});

app.get('/leads', requireOwner, async (c) => c.json({ leads: await listLeads(c.env.DB, c.req.query('status')) }));

app.patch('/leads/:id', requireOwner, async (c) =>
  c.json(await updateLead(c.env.DB, c.req.param('id'), await json(c.req.raw))),
);

app.get('/settings/booking', requireOwner, async (c) => c.json(await currentRules(c.env.DB)));
app.put('/settings/booking', requireOwner, async (c) => {
  const owner = c.get('owner');
  return c.json(await saveRules(c.env.DB, await json(c.req.raw), owner.email ?? owner.subject));
});

app.get('/jobs', requireOwner, async (c) => c.json({ jobs: await listJobs(c.env.DB, c.req.query('from'), c.req.query('to')) }));
app.post('/jobs', requireOwner, async (c) => c.json(await createJob(c.env.DB, await json(c.req.raw)), 201));
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

app.get('/time-off', requireOwner, async (c) => c.json({ timeOff: await listTimeOff(c.env.DB) }));
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

export default app;
