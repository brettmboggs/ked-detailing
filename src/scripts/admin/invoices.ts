import { $, h, sectionHead } from './core';

export async function renderInvoices() {
  $('[data-view="invoices"]').replaceChildren(sectionHead('Invoices'), h('p', { class: 'text-bone-400' }, 'Coming soon.'));
}
