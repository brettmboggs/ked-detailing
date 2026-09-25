import { currentSite } from './site.ts';
import type { Bindings } from './lib.ts';

/**
 * Who the business is, in one place: the name, contact details, logo and
 * colours every customer email and document is dressed in.
 *
 * Contact details come from the website document Jacob edits in the app, so
 * a new phone number or Instagram link reaches the emails as soon as he saves
 * it. Everything else is the defaults below.
 */

export interface Brand {
  name: string;
  legalName: string;
  /** First name, for "Text Jacob". */
  owner: string;
  motto: string;
  phone: string;
  /** E.164, for tel: and sms: links. */
  phoneE164: string;
  email: string;
  city: string;
  region: string;
  instagram: string | null;
  facebook: string | null;
  siteUrl: string;
  /** White logo on transparent, 400×225. Sits on `colors.ink`. */
  logoUrl: string;
  colors: { ink: string; gold: string; bone: string; paper: string; text: string; muted: string };
}

// TENANT: this is Knock Em' Down's profile. See docs/multi-tenant.md.
const DEFAULTS = {
  name: "Knock Em' Down Detailing",
  legalName: 'Knock Em Down Auto & Marine Detailing',
  owner: 'Jacob',
  motto: 'Founded on quality, built on service, continued on referrals.',
  phone: '(314) 223-2988',
  email: 'knockemdowndetailing@gmail.com',
  city: 'High Ridge',
  region: 'MO',
  instagram: 'https://www.instagram.com/knockemdowndetailing/',
  facebook: 'https://www.facebook.com/knockemdowndetailing/',
  // The site's own palette (ink-950, gold-500, bone-50).
  colors: { ink: '#07080a', gold: '#e8b14c', bone: '#f4f1ea', paper: '#ffffff', text: '#1b1c1f', muted: '#6b6f76' },
};

/** "(314) 223-2988" → "+13142232988". US numbers only, like the site's validator. */
const e164 = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  return `+${digits.length === 10 ? `1${digits}` : digits}`;
};

export const siteUrl = (env: Bindings) => (env.SITE_URL || 'https://www.kedservice.com').replace(/\/$/, '');

export async function getBrand(env: Bindings): Promise<Brand> {
  const { content } = await currentSite(env.DB);
  const c = content.contact ?? {};
  const site = siteUrl(env);
  const phone = c.phone || DEFAULTS.phone;
  return {
    ...DEFAULTS,
    phone,
    phoneE164: e164(phone),
    email: c.email || DEFAULTS.email,
    instagram: c.instagram || DEFAULTS.instagram,
    facebook: c.facebook || DEFAULTS.facebook,
    siteUrl: site,
    logoUrl: `${site}/email/logo.png`,
  };
}
