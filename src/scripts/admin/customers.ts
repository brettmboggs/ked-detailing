import { $, h, sectionHead } from './core';

export async function renderCustomers() {
  $('[data-view="customers"]').replaceChildren(sectionHead('Customers'), h('p', { class: 'text-bone-400' }, 'Coming soon.'));
}
