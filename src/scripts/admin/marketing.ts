import { $, h, sectionHead } from './core';

export async function renderMarketing() {
  $('[data-view="marketing"]').replaceChildren(sectionHead('Marketing'), h('p', { class: 'text-bone-400' }, 'Coming soon.'));
}
