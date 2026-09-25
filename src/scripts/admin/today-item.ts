/**
 * One person to contact on the Today tab: who, why, the message ready to go,
 * and one tap to text, call or email them from Jacob's own phone. Nothing
 * here sends a text; it opens Messages with the words filled in.
 */
import { h, api, ghost, small, clearError, showError } from './core';
import { action, dayFmt, goldSmall, goTab, pending, telHref, textArea, textButton } from './calendar-shared';

export interface FollowUp {
  id: string;
  kind: 'review' | 'thank_you' | 'reminder' | 'rebook' | 'winback' | 'quote_chase' | 'custom';
  status: 'open' | 'done' | 'skipped' | 'sent';
  channel: 'text' | 'email' | 'call' | null;
  title: string;
  message: string | null;
  subject: string | null;
  dueDate: string;
  customer: { id: string | null; name: string; phone: string | null; email: string | null; emailOk: boolean; textOk: boolean } | null;
  leadId: string | null;
  jobId: string | null;
  email: { state: 'queued' | 'sending' | 'sent' | 'failed'; note: string | null; sentAt: string | null } | null;
  auto: boolean;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
}

/** What kind of reach-out it is, in Jacob's words. */
export const KIND: Record<FollowUp['kind'], string> = {
  review: 'Thanks + review',
  thank_you: 'Thank you',
  reminder: 'Reminder',
  rebook: 'Due again',
  winback: 'Win back',
  quote_chase: 'Quote',
  custom: 'Your note',
};

const digits = (phone: string) => phone.replace(/[^\d+]/g, '');
const isApple = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Messages with the words filled in. iPhones want `&body=`, everyone else `?body=`. */
export function smsHref(phone: string, body: string) {
  return `sms:${digits(phone)}${isApple() ? '&' : '?'}body=${encodeURIComponent(body)}`;
}

export function mailHref(email: string, subject: string | null, body: string) {
  return `mailto:${email}?subject=${encodeURIComponent(subject ?? "Knock Em' Down Detailing")}&body=${encodeURIComponent(body)}`;
}

/** Local date plus days, for snooze undo labels. */
const shortDate = (d: string) => dayFmt(d, { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * A row for the "People to contact today" list. `changed` redraws the counts
 * around it; the row itself turns into a one-line "done, undo" so the list
 * doesn't jump.
 */
export function followUpRow(start: FollowUp, today: string, changed: () => void): HTMLElement {
  const li = h('li', { class: 'border-b border-ink-800 py-5' });
  let f = start;

  const run = async (path: string, body?: unknown) => {
    clearError();
    try {
      f = await api<FollowUp>(`/crm/follow-ups/${f.id}${path}`, { method: 'POST', body });
      return true;
    } catch (err) {
      showError(err);
      return false;
    }
  };

  /** After Done, Skip or Snooze: one line with a way back. */
  const settled = (what: string, undo: () => Promise<unknown>) => {
    const btn = h('button', { type: 'button', class: textButton }, 'Undo') as HTMLButtonElement;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await undo();
        draw();
        changed();
      } catch (err) {
        showError(err);
        btn.disabled = false;
      }
    });
    li.replaceChildren(
      h('p', { class: 'flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-bone-400' },
        h('span', { class: 'text-bone-200' }, f.customer?.name || f.title), what, btn),
    );
    changed();
  };

  const finish = (path: string, word: string, body?: unknown) => async () => {
    if (await run(path, body)) settled(word, () => api(`/crm/follow-ups/${f.id}/reopen`, { method: 'POST' }).then((x) => (f = x as FollowUp)));
  };
  const snooze = (days: number, word: string) => async () => {
    const was = f.dueDate;
    if (await run('/snooze', { days })) {
      settled(`${word}: back on ${shortDate(f.dueDate)}.`, () =>
        api<FollowUp>(`/crm/follow-ups/${f.id}`, { method: 'PATCH', body: { dueDate: was } }).then((x) => (f = x)),
      );
    }
  };

  function draw() {
    const c = f.customer;
    const message = f.message ?? '';
    const canText = !!(c?.phone && c.textOk);
    const failed = f.email?.state === 'failed';
    const queued = f.email?.state === 'queued' || f.email?.state === 'sending';

    /* ------------------------------------------------ who and why */
    const who = h(
      'div',
      { class: 'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1' },
      c?.id
        ? h('button', {
            type: 'button',
            class: 'text-left font-semibold text-bone-50 underline decoration-ink-600 underline-offset-4 hover:decoration-gold-500',
            onclick: () => {
              pending.customer = c.id;
              goTab('customers');
            },
          }, c.name)
        : h('p', { class: 'font-semibold text-bone-50' }, c?.name || 'Just you'),
      h('span', { class: `${small} ${f.kind === 'custom' ? 'text-bone-400' : 'text-gold-400'}` }, KIND[f.kind]),
    );
    const why = h('p', { class: 'mt-1 text-sm text-bone-200' }, f.title, f.dueDate < today ? h('span', { class: 'text-bone-500' }, ` · from ${shortDate(f.dueDate)}`) : null);
    const reach = c?.phone || c?.email
      ? h('p', { class: 'mt-1 text-sm tabular-nums text-bone-400' }, [c.phone, c.email].filter(Boolean).join(' · '))
      : null;
    const note = failed
      ? h('p', { class: 'mt-3 max-w-2xl border-l-2 border-gold-600 pl-4 text-sm text-bone-200' }, `The email didn't go${f.email?.note ? `: ${f.email.note}` : '.'} ${canText ? 'Text them instead.' : ''}`)
      : queued
        ? h('p', { class: 'mt-3 max-w-2xl border-l-2 border-ink-600 pl-4 text-sm text-bone-400' }, 'This one is set to email itself on the next run. Text or call instead if you like.')
        : null;

    /* ------------------------------------------------ the message */
    const shown = h('p', { class: 'mt-3 max-w-2xl whitespace-pre-wrap border-l-2 border-ink-700 pl-4 text-sm leading-relaxed text-bone-200' }, message || 'No message. Write one if you want to text them.');
    const editor = h('textarea', { class: `${textArea} mt-3 max-w-2xl`, rows: 6, maxlength: 2000, 'aria-label': 'Message' }) as HTMLTextAreaElement;
    editor.value = message;
    const editWrap = h('div', { hidden: true });
    const save = action('Save message', async () => {
      f = await api<FollowUp>(`/crm/follow-ups/${f.id}`, { method: 'PATCH', body: { message: editor.value.trim() || null } });
      draw();
    }, goldSmall);
    editWrap.append(editor, h('div', { class: 'mt-3 flex flex-wrap items-center gap-3' }, save.btn,
      h('button', { type: 'button', class: textButton, onclick: () => ((editWrap.hidden = true), (shown.hidden = false)) }, 'Cancel'), save.status));
    const edit = h('button', { type: 'button', class: textButton, onclick: () => ((editWrap.hidden = false), (shown.hidden = true), editor.focus()) }, 'Edit message');

    const copy = h('button', { type: 'button', class: textButton }, 'Copy') as HTMLButtonElement;
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(message);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Select the words above to copy';
      }
    });

    /* ------------------------------------------------ reach out */
    // After opening Messages, Mail or the phone, ask whether it happened.
    const confirm = h('div', { class: 'mt-4 flex flex-wrap items-center gap-3 border-l-2 border-gold-500 pl-4', hidden: true });
    const ask = (question: string, label: string, how: 'text' | 'call' | 'email') => () => {
      confirm.replaceChildren(
        h('span', { class: 'text-sm text-bone-200' }, question),
        h('button', { type: 'button', class: goldSmall, onclick: finish(how === 'text' ? '/texted' : '/done', 'Done.', how === 'text' ? undefined : { how }) }, label),
      );
      confirm.hidden = false;
    };

    const primary: HTMLElement[] = [];
    if (canText && message) {
      primary.push(h('a', { class: goldSmall, href: smsHref(c!.phone!, message), onclick: ask('Sent it?', 'Yes, I texted them', 'text') }, 'Text'));
    }
    if (c?.phone) primary.push(h('a', { class: primary.length ? ghost : goldSmall, href: telHref(c.phone), onclick: ask('Talked to them?', 'Yes, mark it done', 'call') }, 'Call'));
    if (c?.email && c.emailOk && f.email?.state !== 'sent' && message && (f.channel === 'email' || failed || !canText)) {
      primary.push(h('a', { class: primary.length ? ghost : goldSmall, href: mailHref(c.email, f.subject, message), onclick: ask('Sent the email?', 'Yes, mark it done', 'email') }, 'Email'));
    }

    const later = h(
      'div',
      { class: 'mt-3 flex flex-wrap items-center gap-x-5 gap-y-2' },
      h('button', { type: 'button', class: textButton, onclick: finish('/done', 'Done.') }, 'Done'),
      h('button', { type: 'button', class: textButton, onclick: finish('/skip', 'Skipped.') }, 'Skip'),
      h('button', { type: 'button', class: textButton, onclick: snooze(1, 'Tomorrow') }, 'Tomorrow'),
      h('button', { type: 'button', class: textButton, onclick: snooze(7, 'Next week') }, 'Next week'),
      message ? copy : null,
      edit,
    );

    li.replaceChildren(
      ...[
        who,
        why,
        reach,
        note,
        shown,
        editWrap,
        primary.length ? h('div', { class: 'mt-4 flex flex-wrap items-center gap-3' }, ...primary) : null,
        confirm,
        later,
      ].filter(Boolean) as HTMLElement[],
    );
  }

  draw();
  return li;
}
