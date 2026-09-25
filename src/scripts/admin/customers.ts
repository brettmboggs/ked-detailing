/**
 * The Customers tab: Jacob's CRM. The list (customers-list.ts) finds and ranks
 * people; the profile (customers-profile.ts) shows everything about one of
 * them; duplicates (customers-merge.ts) cleans up people who are in twice.
 * Customers are made by bookings and quote requests (matched by phone), so
 * there's no "add customer" here: booking a new person adds them.
 */
import { $, showError } from './core';
import { pending } from './calendar-shared';
import { drawList } from './customers-list';
import { drawProfile } from './customers-profile';
import { drawDuplicates } from './customers-merge';

const view = () => $('[data-view="customers"]');

export async function renderCustomers() {
  if (pending.customer) {
    const id = pending.customer;
    pending.customer = null;
    return openCustomer(id);
  }
  return list();
}

function list() {
  return drawList(view(), { open: (id) => void openCustomer(id).catch(showError), duplicates: () => void duplicates().catch(showError) });
}

function back() {
  void list().catch(showError);
}

async function openCustomer(id: string, flash?: string) {
  await drawProfile(view(), id, { back, open: (next, note) => void openCustomer(next, note).catch(showError) }, flash);
}

function duplicates() {
  return drawDuplicates(view(), { back, open: (id) => void openCustomer(id).catch(showError) });
}
