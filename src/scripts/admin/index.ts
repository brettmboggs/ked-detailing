/**
 * The web admin (src/pages/admin.astro). Everything goes through the API with
 * the owner's session, so the server's rules still decide what's valid; the
 * checks here only save a round trip.
 */
import { renderBooks } from './books';
import { renderBookings } from './bookings';
import { renderCustomers } from './customers';
import { renderHours } from './hours';
import { renderInventory } from './inventory';
import { renderInsights } from './insights';
import { renderInvoices } from './invoices';
import { renderLeads } from './leads';
import { renderMarketing } from './marketing';
import { renderPrices } from './prices';
import { renderToday } from './today';
import { renderUsage } from './usage';
import { renderWebsite } from './website';
import { API, KEY, h, $, token, remember, api, showError, clearError, showSignIn, selectTab } from './core';

async function signInFromLink() {
  const match = location.hash.match(/^#login=([A-Za-z0-9_-]+)$/);
  if (!match) return;
  // Take the token out of the address bar and history straight away.
  history.replaceState(null, '', location.pathname);
  try {
    const session = await api<{ token: string; email: string }>('/auth/email/verify', { method: 'POST', body: { token: match[1] } });
    remember(session.token);
    try {
      localStorage.setItem(`${KEY}-email`, session.email);
    } catch {
      // fine
    }
  } catch (err) {
    showSignIn((err as Error).message);
    throw err;
  }
}

/* ------------------------------------------------------------ views */

/** Each tab's renderer, keyed by the tab's data-tab / data-view name. */
const views: Record<string, () => Promise<void>> = {
  today: renderToday,
  bookings: renderBookings,
  customers: renderCustomers,
  leads: renderLeads,
  insights: renderInsights,
  marketing: renderMarketing,
  invoices: renderInvoices,
  books: renderBooks,
  inventory: renderInventory,
  prices: renderPrices,
  hours: renderHours,
  website: renderWebsite,
  usage: renderUsage,
};

/** Checks in for the Usage page. Best effort: never gets in the way. */
const checkIn = (kind: 'open' | 'screen', path?: string) =>
  void api('/usage', { method: 'POST', body: { client: 'admin', kind, path } }).catch(() => undefined);

async function open(name: string) {
  clearError();
  selectTab(name);
  checkIn('screen', name);
  const view = $(`[data-view="${name}"]`);
  view.replaceChildren(h('p', { class: 'text-bone-400' }, 'Loading…'));
  try {
    await views[name]!();
  } catch (err) {
    view.replaceChildren();
    showError(err);
  }
}

/* ------------------------------------------------------------ start */

export async function initAdmin() {
  if (!API) {
    $('[data-loading]').textContent = "This page needs the API, and it isn't configured on this build.";
    return;
  }

  $('[data-signin-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = ($('#admin-email') as HTMLInputElement).value.trim();
    try {
      await api('/auth/email', { method: 'POST', body: { email } });
      showSignIn(`If ${email} is allowed in, a sign-in link is on its way. Open it on this device.`);
    } catch (err) {
      showSignIn((err as Error).message);
    }
  });

  $('[data-sign-out]').addEventListener('click', async () => {
    await api('/auth/session', { method: 'DELETE' }).catch(() => undefined);
    remember(null);
    showSignIn('Signed out.');
  });

  for (const t of document.querySelectorAll<HTMLElement>('[data-tab]')) t.addEventListener('click', () => open(t.dataset.tab!));
  for (const g of document.querySelectorAll<HTMLElement>('[data-group]')) g.addEventListener('click', () => open(g.dataset.first!));

  try {
    await signInFromLink();
  } catch {
    return;
  }
  if (!token) return showSignIn();

  $('[data-loading]').hidden = true;
  $('[data-signin]').hidden = true;
  $('[data-tabs]').hidden = false;
  $('[data-who]').hidden = false;
  try {
    $('[data-who-email]').textContent = localStorage.getItem(`${KEY}-email`) ?? '';
  } catch {
    // fine
  }
  checkIn('open');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && token) checkIn('open');
  });
  // A reload stays on the page you were on (the hash holds it; see selectTab).
  const start = location.hash.slice(1);
  await open(Object.hasOwn(views, start) ? start : 'today');
}
