import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { requireOwner, signInWithApple, type Owner } from './auth.ts';
import { availability, createBooking, currentRules, saveRules } from './booking.ts';
import { getCustomer, listCustomers, updateCustomer } from './customers.ts';
import { addTimeOff, createJob, customerJobs, getJob, listJobs, listTimeOff, removeTimeOff, updateJob } from './jobs.ts';
import { createLead, listLeads, updateLead } from './leads.ts';
import { ApiError, json, list, text, type Bindings } from './lib.ts';
import { currentPricing, savePricing } from './pricing.ts';

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
