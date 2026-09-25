import { $, h, sectionHead } from './core';

export async function renderToday() {
  $('[data-view="today"]').replaceChildren(sectionHead('Today'), h('p', { class: 'text-bone-400' }, 'Coming soon.'));
}
