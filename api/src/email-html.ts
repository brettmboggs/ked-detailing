import type { Brand } from './brand.ts';

/**
 * The branded HTML every customer email goes out in: the logo on the site's
 * black with a gold rule, the message on white, the main link as a gold
 * button, and the business's details underneath.
 *
 * Callers only ever write plain text. `sendEmail` turns that text into this
 * layout on its way out, so nothing that sends email has to think about how
 * it looks, and the plain text still goes as the text/plain part.
 *
 * Email HTML is its own dialect: tables for layout, inline styles only, no
 * web fonts, and nothing that Gmail or Outlook strip.
 */

export interface EmailAction {
  label: string;
  url: string;
}

export interface EmailParts {
  subject: string;
  /** The message as written, paragraphs separated by blank lines. */
  text: string;
  /** Shown as a button under the message. Its URL is taken out of the text. */
  action?: EmailAction | null;
  /** Small print under the business details, e.g. the unsubscribe line. */
  footer?: { text: string; link?: EmailAction } | null;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const URL_RE = /https?:\/\/[^\s<>"')]+[^\s<>"').,:;!?]/g;

/** Customer pages a message may link to, and what their button says. */
const PAGES: [RegExp, string][] = [
  [/\/pay\/?\?/, 'View your invoice'],
  [/\/approve\/?\?/, 'See the add-ons'],
  [/\/booking\/?\?/, 'View your booking'],
  [/\/done\/?\?/, 'See your car'],
  [/\/car\/?\?/, 'View your certificate'],
  [/\/quote\/?/, 'Get a quote'],
];

/** The first link in the text to one of the business's own customer pages. */
export function findAction(text: string, site: string): EmailAction | null {
  for (const url of text.match(URL_RE) ?? []) {
    if (!url.startsWith(site) && !url.startsWith(site.replace('://www.', '://'))) continue;
    const page = PAGES.find(([re]) => re.test(url));
    if (page) return { label: page[1], url };
  }
  return null;
}

/** One paragraph of plain text as HTML: escaped, links live, line breaks kept. */
function paragraph(p: string, brand: Brand) {
  let out = '';
  let last = 0;
  for (const m of p.matchAll(URL_RE)) {
    out += esc(p.slice(last, m.index));
    out += `<a href="${esc(m[0])}" style="color:${brand.colors.text};text-decoration:underline;word-break:break-all">${esc(m[0])}</a>`;
    last = m.index! + m[0].length;
  }
  return (out + esc(p.slice(last))).replace(/\n/g, '<br>');
}

/** The button replaces the bare link: "Here's your invoice: https://…" reads "Here's your invoice." */
function withoutUrl(p: string, url: string) {
  return p
    .split(url)
    .join('')
    .replace(/:[ \t]*(?=\n|$)/g, '.')
    .replace(/[ \t]+(?=\n|$)/g, '')
    .trim();
}

function button(a: EmailAction, brand: Brand) {
  const { gold, ink } = brand.colors;
  // Bulletproof button: the table cell carries the colour for clients that
  // ignore padding on links.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 24px">
<tr><td bgcolor="${gold}" style="background:${gold};border-radius:2px">
<a href="${esc(a.url)}" style="display:inline-block;padding:15px 28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${ink};text-decoration:none">${esc(a.label)}</a>
</td></tr></table>`;
}

export function renderEmail(brand: Brand, e: EmailParts): string {
  const { ink, gold, bone, paper, text, muted } = brand.colors;
  // The button goes straight after the paragraph its link was in.
  const parts = e.text.trim().split(/\n\s*\n/).map((p) => p.trim());
  const at = e.action ? parts.findIndex((p) => p.includes(e.action!.url)) : -1;
  const html = parts
    .map((p, i) => (i === at ? withoutUrl(p, e.action!.url) : p))
    .map((p, i) => {
      const para = p ? `<p style="margin:0 0 18px">${paragraph(p, brand)}</p>` : '';
      return i === at ? `${para}\n${button(e.action!, brand)}` : para;
    });
  const paragraphs = html.join('\n') + (e.action && at < 0 ? button(e.action, brand) : '');
  const body = parts.map((p, i) => (i === at ? withoutUrl(p, e.action!.url) : p)).join(' ');
  // The inbox preview line: the opening words, not "View in browser".
  const preheader = body.replace(/\s+/g, ' ').slice(0, 140);
  const siteHost = brand.siteUrl.replace(/^https?:\/\//, '');
  const social = [
    brand.instagram && `<a href="${esc(brand.instagram)}" style="color:${gold};text-decoration:none">Instagram</a>`,
    brand.facebook && `<a href="${esc(brand.facebook)}" style="color:${gold};text-decoration:none">Facebook</a>`,
  ].filter(Boolean);
  const small = e.footer
    ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#8a8e95">${esc(e.footer.text)}${
        e.footer.link ? ` <a href="${esc(e.footer.link.url)}" style="color:#8a8e95;text-decoration:underline">${esc(e.footer.link.label)}</a>` : ''
      }</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(e.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${bone};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${bone}">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bone}" style="background:${bone}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">

<tr><td align="center" bgcolor="${ink}" style="background:${ink};padding:30px 24px 26px;border-bottom:3px solid ${gold}">
<a href="${esc(brand.siteUrl)}" style="text-decoration:none"><img src="${esc(brand.logoUrl)}" width="200" height="113" alt="${esc(brand.name)}" style="display:block;border:0;width:200px;height:auto;color:${paper};font-family:Helvetica,Arial,sans-serif;font-size:20px;font-weight:700"></a>
</td></tr>

<tr><td bgcolor="${paper}" style="background:${paper};padding:36px 32px 30px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:${text}">
${paragraphs}
</td></tr>

<tr><td bgcolor="${ink}" style="background:${ink};padding:26px 32px 28px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#b9b5ac">
<p style="margin:0 0 6px;font-size:14px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${paper}">${esc(brand.name)}</p>
<p style="margin:0 0 10px;font-style:italic;color:${muted}">${esc(brand.motto)}</p>
<p style="margin:0">
<a href="tel:${esc(brand.phoneE164)}" style="color:${gold};text-decoration:none">${esc(brand.phone)}</a>
&nbsp;·&nbsp; <a href="${esc(brand.siteUrl)}" style="color:${gold};text-decoration:none">${esc(siteHost)}</a>${
    social.length ? `\n&nbsp;·&nbsp; ${social.join(' &nbsp;·&nbsp; ')}` : ''
  }
</p>
<p style="margin:6px 0 0;color:${muted}">${esc(brand.legalName)} · ${esc(brand.city)}, ${esc(brand.region)}</p>
${small}
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
