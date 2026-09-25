import { $, h, sectionHead } from './core';

export async function renderInsights() {
  $('[data-view="insights"]').replaceChildren(sectionHead('Insights'), h('p', { class: 'text-bone-400' }, 'Coming soon.'));
}
