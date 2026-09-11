/**
 * Single source of truth for site content.
 *
 * Types are declared explicitly rather than relying on `as const`, because a
 * const-asserted array gives every entry its own literal type, and optional
 * fields then disappear from the resulting union.
 */

/* ------------------------------------------------------------------ types */

export interface Service {
  level: string;
  name: string;
  /**
   * Always null today: every vehicle is quoted individually. Kept on the type
   * so a fixed price can be reintroduced per tier without a refactor.
   */
  price: string | null;
  duration: string;
  summary: string;
  includes: string[];
  closer: string;
  /** File name inside src/assets/photos/. */
  photo: string;
}

export interface Testimonial {
  quote: string;
  name: string;
  /** What they had done, where it is known. */
  detail: string;
  /** Where the review was left. */
  source: string;
}

export interface Faq {
  q: string;
  a: string;
}

export interface GalleryItem {
  src: string;
  alt: string;
  /** Grid footprint. Items without a span render square. */
  span?: 'tall' | 'wide';
}

export interface NavItem {
  label: string;
  href: string;
}

/* --------------------------------------------------------------- business */

export const business = {
  name: "Knock Em' Down Detailing",
  /** Registered LLC name. The business genuinely covers boats as well as cars. */
  legalName: 'Knock Em Down Auto & Marine Detailing',
  tagline: 'Obsessed With the Details.',
  /** Jacob's own line, carried over from his business listings. */
  motto: 'Founded on quality, built on service, continued on referrals.',
  operator: 'Jacob',
  /**
   * Base of operations. Deliberately not published as a street address — it is
   * a home address, and this is a service-area business.
   */
  baseCity: 'High Ridge',
  city: 'St. Louis',
  region: 'MO',
  hours: 'Mon–Fri, 9am–5pm',
  phone: '(314) 223-2988',
  phoneHref: 'tel:+13142232988',
  email: 'knockemdowndetailing@gmail.com',
  instagram: 'https://www.instagram.com/knockemdowndetailing/',
  instagramHandle: '@knockemdowndetailing',
  facebook: 'https://www.facebook.com/knockemdowndetailing/',
  reviewsUrl: 'https://reviews.birdeye.com/knock-em-down-auto-marine-detailing-167601558157721',
  rating: '5.0',
  /** Google Business Profile count. Rendered as "25+" so it does not go stale. */
  reviewCount: 25,
  bookingUrl:
    'https://book.housecallpro.com/book/Knock-Em-Down-Auto--Marine-Detailing/18c82a94d510423988a8e7909d38557d?v2=true',
} as const;

export const hero = {
  eyebrow: 'Mobile auto & marine detailing · St. Louis',
  headline: ['Obsessed', 'With the', 'Details.'],
  sub: 'We bring the water, the power and the products to your driveway. You keep your Saturday.',
  /** Shown under the package list. */
  pricingNote: 'Every vehicle is different, so every job is quoted on its own.',
} as const;

export const intro =
  "Jacob has put hands on a salvage-title Maserati, a '72 Monte Carlo and a brand-new Rivian, and the daily driver with crushed goldfish under the back seat gets the same process as the show car. Nothing is rushed and nothing is handed off to someone else. Founded on quality, built on service, continued on referrals.";

/* --------------------------------------------------------------- services */

/**
 * The tiers, steps and inclusions are Jacob's and are unchanged. Only the
 * connective prose around them was tightened.
 *
 * Level III/IV ordering is a known inconsistency — see NOTES.md.
 */
export const services: Service[] = [
  {
    level: 'Level I',
    name: 'The Tune-Up',
    price: null,
    duration: '2–3 hours',
    summary:
      'The maintenance detail. Keeps a car sharp between deeper services so road grime never gets the chance to set in.',
    includes: [
      'Foam + contact wash',
      'Wheel and tire cleaning',
      'Light interior vacuum',
      'Glass cleaning',
      'Finishing touches',
    ],
    closer: 'Best for daily drivers on a regular schedule.',
    photo: 'foam-spray-driveway.jpg',
  },
  {
    level: 'Level II',
    name: 'The Refresh',
    price: null,
    duration: 'Half day – full day',
    summary:
      'A full reset, inside and out. The paint gets decontaminated and the interior gets stripped back and rebuilt.',
    includes: [
      'Foam + contact wash',
      'Clay bar / iron remover',
      'Wheel and tire deep clean',
      'Interior scrub — plastics, vents, buttons',
      'Stain removal',
      'Glass polish',
      'Odor neutralization',
    ],
    closer: 'For cars that need more than maintenance. This is where the reset happens.',
    photo: 'interior-amg-seat.jpg',
  },
  {
    level: 'Level III',
    name: 'The Knockout',
    price: null,
    duration: '1–2 days',
    summary:
      'Everything in The Refresh, plus the engine bay, deep carpet extraction and a sealant that actually holds.',
    includes: [
      'Everything in Level II',
      'Engine bay detail',
      'Hot water extraction or steam cleaning for carpets and seats',
      'Paint sealant application',
      'UV and contaminant shielding',
    ],
    closer: 'Built for enthusiasts, collectors and long-term protection.',
    photo: 'panamera-front.jpg',
  },
  {
    level: 'Level IV',
    name: 'The Revival',
    price: null,
    duration: 'By quote',
    summary:
      'Paint correction. A one-step machine polish that cuts swirls, light scratches and oxidation back out of the clear coat.',
    includes: [
      'Prep wash and clay bar treatment',
      'One-step machine polish',
      'Removes light scratches, swirls and oxidation',
      'Up to 50% of imperfections eliminated',
      'Six-month paint protectant',
    ],
    closer: 'For drivers who want depth and reflection back, not just clean.',
    photo: 'headlight-macro.jpg',
  },
];

/* ----------------------------------------------------------- testimonials */

/**
 * Real five-star reviews from Jacob's public review profile, not written for
 * the site. Nina's is excerpted because the source itself truncates it.
 * Confirm these are still live before launch — see NOTES.md.
 */
export const testimonials: Testimonial[] = [
  {
    quote:
      'I saw Jacob’s van around my area and sent him a quick email. He responded quickly, professionally, and set realistic expectations for pricing and timelines. He did an excellent paint correction on my Rivian R1S. The result was amazing, and along the way he answered all of my questions and discussed his approach to each of the trouble spots I pointed out.',
    name: 'Ian R.',
    detail: 'Rivian R1S — paint correction',
    source: 'Google',
  },
  {
    quote:
      'Jacob did an incredible job restoring a Maserati from salvage to showroom ready! I would highly recommend his services to anyone who values their car’s long term longevity!',
    name: 'Rich Z.',
    detail: 'Maserati — salvage restoration',
    source: 'Google',
  },
  {
    quote:
      'I don’t write reviews often, but this experience absolutely deserved one. My car looks absolutely incredible. I genuinely don’t think it has ever looked this good, not even when I first got it from the dealership.',
    name: 'Nina Hanser',
    detail: 'Full detail',
    source: 'Google',
  },
  {
    quote:
      'Jacob detailed my father in law’s 72 Monte Carlo and it looks amazing! The mirror finish the car has now is incredible. He knows the process that works and we love the result!',
    name: 'Brandon Crites',
    detail: '1972 Monte Carlo',
    source: 'Google',
  },
  {
    quote:
      'We’ve used Jacob several times over the last few years for detailing — from a mini van to a pickup truck. His attention to detail and cleanliness is unmatched.',
    name: 'Jenna Jordan',
    detail: 'Repeat customer',
    source: 'Google',
  },
  {
    quote:
      'Jacob did an amazing job. I am highly particular about detailing my car and Jacob exceeded expectations. Highly recommend.',
    name: 'Costa Raptis',
    detail: 'Full detail',
    source: 'Google',
  },
];

/* -------------------------------------------------------------------- faq */

export const faqs: Faq[] = [
  {
    q: 'Do I need to bring the car somewhere?',
    a: 'No. The service is fully mobile — we come to your home or workplace with everything needed. All we need is enough room to work around the vehicle.',
  },
  {
    q: 'How long does a detail take?',
    a: 'It depends on the package. A Level I Tune-Up runs 2–3 hours. Level II is a half day to a full day. Level III can run 1–2 days depending on correction work and cure times. You get a realistic window up front, not a guess.',
  },
  {
    q: 'Will you work on exotics, classics and collector cars?',
    a: 'That is a lot of what we do. Porsches, air-cooled classics, a salvage-title Maserati brought back to showroom, a 1972 Monte Carlo taken to a mirror finish. Extra precautions come standard on anything rare or irreplaceable.',
  },
  {
    q: 'Do you detail boats?',
    a: 'Yes. The business is Knock Em Down Auto & Marine Detailing, so hulls, gelcoat, upholstery and trailers are all fair game. Send over what you have and we will scope it.',
  },
  {
    q: 'Which areas do you cover?',
    a: 'Based in High Ridge and working across the greater St. Louis metro, including St. Charles and Jefferson County. If you are not sure you are in range, call and ask.',
  },
  {
    q: 'How often should a car be detailed?',
    a: 'For most daily drivers, a maintenance detail every three to four months stops contamination bonding to the paint. Cars that live outside, park under trees or see winter salt need it more often.',
  },
];

/* ----------------------------------------------------------------- marque */

/** Vehicles actually worked on, drawn from the photo library and public reviews. */
export const marque: string[] = [
  'Porsche',
  'Maserati',
  'Rivian R1S',
  'Air-Cooled 964',
  'G-Wagon',
  'Ferrari F12',
  'Monte Carlo',
  'Escalade V',
  'Boats & Trailers',
  'Daily Drivers',
];

/* ---------------------------------------------------------------- gallery */

export const gallery: GalleryItem[] = [
  {
    src: 'porsche-badge-foam.jpg',
    alt: 'Foam sheeting across the Panamera Turbo badge on a white Porsche',
    span: 'wide',
  },
  {
    src: 'caliper-macro.jpg',
    alt: 'Yellow Porsche brake caliper being cleaned behind the spokes of a wheel',
    span: 'tall',
  },
  {
    src: 'van-logo.jpg',
    alt: 'The Knock Em Down Mobile Detailing Service logo on the side of the work van',
  },
  {
    src: 'golden-hour-flare.jpg',
    alt: 'Detailer working on a white Porsche Panamera in low golden-hour sun',
    span: 'wide',
  },
  {
    src: 'jacob-portrait.jpg',
    alt: 'Jacob taking a booking call in a Knock Em Down hoodie',
    span: 'tall',
  },
  {
    src: 'foam-panamera.jpg',
    alt: 'White Porsche Panamera buried under thick foam during a contact wash',
  },
  { src: 'gwagon-dusk.jpg', alt: 'Blacked-out Mercedes G63 finished and parked at dusk' },
  {
    src: 'wheel-cloth.jpg',
    alt: 'Hand cleaning a wheel face with a red microfiber cloth',
    span: 'tall',
  },
  { src: 'panamera-rear.jpg', alt: 'Rear three-quarter of a finished white Porsche Panamera' },
  { src: 'interior-amg-door.jpg', alt: 'Red quilted AMG door panel after a full interior detail' },
  { src: 'ked-hoodie.jpg', alt: 'Knock Em Down embroidered logo on a crew hoodie' },
  {
    src: 'exhaust-tips.jpg',
    alt: 'Foam running over the polished quad exhaust tips of a performance car',
    span: 'tall',
  },
  { src: 'porsche-964-red.jpg', alt: 'Air-cooled Porsche 911 964 on BBS wheels after detailing' },
  { src: 'ferrari-f12.jpg', alt: 'Ferrari F12 and Corvette detailed on a dealership lot' },
  {
    src: 'van-equipment.jpg',
    alt: 'The mobile rig loaded out with equipment, doors open on location',
  },
  { src: 'brake-caliper.jpg', alt: 'Macro detail of a red brake caliper behind a clean wheel' },
];

/** Clip used for the type-masked band — a separate shot from the hero. */
export const band = {
  video: '/video/band-splash.mp4',
  poster: '/video/band-splash.jpg',
  word: 'Knock Em Down',
} as const;

/** Root-relative so the same nav works from the home page and /store. */
export const nav: NavItem[] = [
  { label: 'Work', href: '/#work' },
  { label: 'Services', href: '/#services' },
  { label: 'Reviews', href: '/#reviews' },
  { label: 'FAQs', href: '/#faqs' },
  { label: 'Store', href: '/store' },
  { label: 'Contact', href: '/#contact' },
];
