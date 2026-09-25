import { $, h, sectionHead } from './core';

export async function renderBooks() {
  $('[data-view="books"]').replaceChildren(sectionHead('Books'), h('p', { class: 'text-bone-400' }, 'Coming soon.'));
}
