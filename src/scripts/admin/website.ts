import { $, h, sectionHead } from './core';

export async function renderWebsite() {
  $('[data-view="website"]').replaceChildren(sectionHead('Website'), h('p', { class: 'text-bone-400' }, 'Coming soon.'));
}
