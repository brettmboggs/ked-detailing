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

/* ---------------------------------------------------------------- cutover */

/**
 * The one switch for online quotes and booking. Off: every Book button goes
 * to Housecall Pro, and /quote stays hidden (noindex, out of the sitemap, with
 * a sample-prices banner). On: the buttons go to /quote, the packages show
 * "from $X", and /quote is public. Turn it on only once Jacob's real prices
 * and hours are saved, and push; the site rebuilds with them.
 */
export const quoteLive = false;

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
  /** Finishes "Mobile auto and marine detailing across …" in the footer. */
  serviceArea: 'the greater St. Louis metro',
  city: 'St. Louis',
  region: 'MO',
  hours: 'Seven days a week',
  phone: '(314) 223-2988',
  phoneHref: 'tel:+13142232988',
  email: 'knockemdowndetailing@gmail.com',
  instagram: 'https://www.instagram.com/knockemdowndetailing/',
  instagramHandle: '@knockemdowndetailing',
  facebook: 'https://www.facebook.com/knockemdowndetailing/',
  reviewsUrl: 'https://reviews.birdeye.com/knock-em-down-auto-marine-detailing-167601558157721',
  rating: '5.0',
  /** Exact count on the Google Business Profile, verified 10 Sep 2026. */
  reviewCount: 25,
  bookingUrl:
    'https://book.housecallpro.com/book/Knock-Em-Down-Auto--Marine-Detailing/18c82a94d510423988a8e7909d38557d?v2=true',
} as const;

export const hero = {
  eyebrow: 'Mobile auto & marine detailing · St. Louis',
  /** The long label wraps badly on a phone. */
  eyebrowShort: 'Auto & marine · St. Louis',
  headline: ['Obsessed', 'With the', 'Details.'],
  sub: 'We bring the water, the power and the products to your driveway. You keep your Saturday.',
  /** Shown under the package list. */
  pricingNote: 'Every vehicle is different, so every job is quoted on its own.',
} as const;

export const intro =
  "Jacob details for Porsche St. Louis, and the daily driver with crushed goldfish under the back seat gets the same process as anything sitting on that showroom floor. Nothing is rushed and nothing is handed to someone else. Founded on quality, built on service, continued on referrals.";

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
    photo: 'porsche-964-red.jpg',
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
    photo: 'gwagon-estate.jpg',
  },
];

/**
 * Also bookable on his Housecall Pro page but missing from the old website.
 * Ceramic coating in particular is a high-value service that was invisible.
 */
export const alsoAvailable: { name: string; blurb: string }[] = [
  {
    name: 'Paint Correction & Ceramic Coating',
    blurb:
      'Multi-stage correction followed by a ceramic coat for paint that needs more than a six-month sealant. Quoted after we see the panels.',
  },
  {
    name: 'Marine Maintenance',
    blurb:
      'Hulls, gelcoat, upholstery and trailers. Same process and the same standard, on a bigger canvas.',
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
      'Always been the best. He has looked after not only mine but a majority of my clients cars too. I would not trust anyone else with my clients.',
    name: 'Josh Ogilvie',
    detail: 'Looks after his clients’ cars',
    source: 'Google',
  },
  {
    quote:
      'My car looks absolutely incredible. I genuinely don’t think it has ever looked this good, not even when I first got it from the dealership. Every inch of the interior and exterior was spotless, and it was obvious that Jacob treated my car with the same care and pride as if it were his own.',
    name: 'Nina Hanser',
    detail: 'Full detail',
    source: 'Google',
  },
  {
    quote:
      'After spilling a can of gas in the back of my car, Jacob came out the next day and worked tirelessly to get it cleaned up. It was 101 degrees out with 1000% humidity and he never complained or even really took a break.',
    name: 'Jen Robson',
    detail: 'Interior rescue',
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
    quote: 'Have detailed numerous vehicles for us and the service is always top notch!',
    name: 'Fairway Automotive',
    detail: 'Dealer, multiple vehicles',
    source: 'Google',
  },
  {
    quote:
      'My car carries around my multiple dogs and he was able to get all of the hair out from the floorboards. Everything looks so great on the inside and out!',
    name: 'Samantha Charpentier',
    detail: 'SUV — interior',
    source: 'Google',
  },
  {
    quote:
      'He has been taking care of my car since 2019 and has always done a tremendous job. He makes the car look like new again.',
    name: 'Franco Ignelzi',
    detail: 'Customer since 2019',
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
    a: 'That is a lot of what we do. We detail for Porsche St. Louis, and privately for air-cooled classics and cars like a 1972 Monte Carlo taken to a mirror finish. Anything rare or irreplaceable is routine here rather than a special occasion.',
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

/**
 * Marquee ticker. Reads as scope — the kind of work that comes through — rather
 * than a claim that each specific car did.
 *
 * Evidenced by the photo library, the reviews or his socials: Porsche, the
 * Panamera Turbo, the air-cooled 911, the GT3, Ferrari, G-Wagon, Escalade-V,
 * Rivian R1S, the '72 Monte Carlo, boats and daily drivers.
 *
 * The remaining marques are scope claims. Strike any Jacob would not want to
 * stand behind — they are single lines here.
 */
export const marque: string[] = [
  'Porsche',
  '911 GT3',
  'Air-Cooled 911',
  'Panamera Turbo',
  'Ferrari',
  'Corvette',
  'AMG',
  'G-Wagon',
  'BMW M',
  'Audi RS',
  'Range Rover',
  'Escalade-V',
  'Bronco',
  'Raptor',
  'Rivian R1S',
  'Restomods',
  'Classics',
  'Exotics',
  'Show Cars',
  'Monte Carlo',
  'Lifted Trucks',
  'Work Trucks',
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
    src: 'van-porsche-dealer.jpg',
    alt: 'The Knock Em Down van working on site at a Porsche dealership',
    span: 'tall',
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
  { src: 'escalade-v.jpg', alt: 'Cadillac Escalade-V with gloss-finished black paint' },
  {
    src: 'wheel-cloth.jpg',
    alt: 'Hand cleaning a wheel face with a red microfiber cloth',
    span: 'tall',
  },
  { src: 'panamera-rear.jpg', alt: 'Rear three-quarter of a finished white Porsche Panamera' },
  { src: 'interior-amg-door.jpg', alt: 'Red quilted leather door panel after a full interior detail' },
  { src: 'ked-hoodie.jpg', alt: 'Knock Em Down embroidered logo on a crew hoodie' },
  {
    src: 'exhaust-tips.jpg',
    alt: 'Foam running over the polished quad exhaust tips of a performance car',
    span: 'tall',
  },
  { src: 'rivian-r1s.jpg', alt: 'Blue Rivian R1S after a paint correction, shot in the driveway' },
  { src: 'ferrari-f12.jpg', alt: 'A white Ferrari F12 and a blue Ferrari parked at a dealership' },
  {
    src: 'van-equipment.jpg',
    alt: 'The mobile rig loaded out with equipment, doors open on location',
  },
  { src: 'brake-caliper.jpg', alt: 'Macro detail of a red brake caliper behind a clean wheel' },
  {
    src: 'headlight-macro.jpg',
    alt: 'Close-up of a polished headlight throwing rainbow reflections',
    span: 'wide',
  },
];

/**
 * The small row of work under the Instagram handoff.
 *
 * Curated, not pulled live — a real feed needs a Graph API token on Jacob's
 * account. Deliberately only four, so it stays a taste of the work rather than
 * turning back into a gallery. Swap the file names to refresh it.
 */
export const recent: GalleryItem[] = [
  { src: 'porsche-badge-foam.jpg', alt: 'Foam sheeting across the Panamera Turbo badge' },
  { src: 'caliper-macro.jpg', alt: 'Yellow brake caliper cleaned behind the spokes of a wheel' },
  { src: 'golden-hour-flare.jpg', alt: 'Rinsing a white Porsche into low golden-hour sun' },
  { src: 'ferrari-f12.jpg', alt: 'A white Ferrari F12 and a blue Ferrari at a dealership' },
];

/** Clip used for the type-masked band — a separate shot from the hero. */
export const band = {
  video: '/video/band-splash.mp4',
  poster: '/video/band-splash.jpg',
  word: 'Knock Em Down',
} as const;

/**
 * Header nav. Root-relative so it works from every page.
 * Blog sits in the footer only — seven items will not fit the header at 1024px.
 */
export const nav: NavItem[] = [
  { label: 'Work', href: '/#work' },
  { label: 'Services', href: '/#services' },
  { label: 'Reviews', href: '/#reviews' },
  { label: 'FAQs', href: '/#faqs' },
  { label: 'Store', href: '/store' },
  { label: 'Contact', href: '/#contact' },
];

/** Footer carries everything in the header plus the blog. */
export const footerNav: NavItem[] = [...nav, { label: 'Notes', href: '/blog' }];
