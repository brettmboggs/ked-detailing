import { $, h, sectionHead } from './core';

export async function renderInventory() {
  $('[data-view="inventory"]').replaceChildren(sectionHead('Inventory'), h('p', { class: 'text-bone-400' }, 'Coming soon.'));
}
