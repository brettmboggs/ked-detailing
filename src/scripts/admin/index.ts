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
import { renderInvoices } from './invoices';
import { renderLeads } from './leads';
import { renderPrices } from './prices';
import { renderWebsite } from './website';
import { API, KEY, h, $, token, remember, api, showError, clearError, showSignIn } from './core';

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
  bookings: renderBookings,
  customers: renderCustomers,
  leads: renderLeads,
  invoices: renderInvoices,
  books: renderBooks,
  inventory: renderInventory,
  prices: renderPrices,
  hours: renderHours,
  website: renderWebsite,
};

async function open(name: string) {
  clearError();
  for (const t of document.querySelectorAll<HTMLElement>('[data-tab]')) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  for (const v of document.querySelectorAll<HTMLElement>('[data-view]')) v.hidden = v.dataset.view !== name;
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
  await open('bookings');
}
