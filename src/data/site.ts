/**
 * Single source of truth for site content.
 * Copy carried over from the Squarespace build unless noted.
 */

export const business = {
  name: "Knock Em' Down Detailing",
  // Registered name on the Housecall Pro booking profile. See NOTES.md.
  legalName: "Knock Em Down Auto & Marine Detailing",
  tagline: 'Obsessed With the Details.',
  city: 'St. Louis',
  region: 'MO',
  phone: '(314) 223-2988',
  phoneHref: 'tel:+13142232988',
  email: 'knockemdowndetailing@gmail.com',
  instagram: 'https://www.instagram.com/knockemdowndetailing/',
  instagramHandle: '@knockemdowndetailing',
  bookingUrl:
    'https://book.housecallpro.com/book/Knock-Em-Down-Auto--Marine-Detailing/18c82a94d510423988a8e7909d38557d?v2=true',
} as const;

export const hero = {
  eyebrow: 'Mobile detailing · St. Louis',
  headline: ['Obsessed', 'With the', 'Details.'],
  sub: "Mobile car detailing in St. Louis designed to protect, enhance, and revive your vehicle's shine. All at home or at the office.",
} as const;

export const intro =
  "We're not just detailers, we're car people. From daily drivers to collector cars, our St. Louis team brings meticulous craftsmanship and the latest detailing technology to every appointment. With thousands of vehicles restored, protected, and perfected, we deliver the kind of finish that makes enthusiasts proud and turns heads at every stoplight.";

/**
 * Service copy is verbatim from the existing site by request.
 * Level III/IV ordering issue is documented in NOTES.md — not changed here.
 */
export const services = [
  {
    level: 'Level I',
    name: 'The Tune-Up',
    price: '$180',
    duration: '2–3 hours',
    summary:
      'A fast, efficient exterior and light interior clean that keeps your car looking sharp between deeper services.',
    includes: [
      'Foam + contact wash',
      'Wheel and tire cleaning',
      'Light interior vacuum',
      'Glass cleaning',
      'Finishing touches',
    ],
    closer:
      'Perfect for maintaining daily drivers and staying ahead of buildup.',
    photo: 'foam-spray-driveway.jpg',
  },
  {
    level: 'Level II',
    name: 'The Refresh',
    price: null,
    duration: 'Half day – full day',
    summary:
      'Designed to reset both inside and out, The Refresh delivers a deeper clean with full paint decontamination and full interior restoration.',
    includes: [
      'Foam + contact wash',
      'Clay bar / iron remover',
      'Wheel and tire deep clean',
      'Interior scrub — plastics, vents, buttons',
      'Stain removal',
      'Glass polish',
      'Odor neutralization',
    ],
    closer:
      'Ideal for cars that need more than maintenance. This is where the reset happens.',
    photo: 'interior-amg-seat.jpg',
  },
  {
    level: 'Level III',
    name: 'The Knockout',
    price: null,
    duration: '1–2 days',
    summary:
      'Our top-tier detail, built for enthusiasts, collectors, and long-term protection.',
    includes: [
      'Everything in Level II',
      'Engine bay detail',
      'Hot water extraction or steam cleaning for carpets and seats',
      'Paint sealant application',
      'UV and contaminant shielding',
    ],
    closer:
      'Locks in unmatched gloss and delivers a finish worthy of any show car.',
    photo: 'panamera-front.jpg',
  },
  {
    level: 'Level IV',
    name: 'The Revival',
    price: null,
    duration: 'By quote',
    summary:
      'Built for drivers who want their paint restored to a new level of clarity.',
    includes: [
      'Everything in Level I',
      'Prep wash and clay bar treatment',
      'One-step machine polish',
      'Removes light scratches, swirls, and oxidation',
      'Six-month paint protectant',
    ],
    closer:
      'Eliminates up to 50% of imperfections while greatly increasing depth and reflection.',
    photo: 'headlight-macro.jpg',
  },
] as const;

export const testimonials = [
  {
    quote:
      "They brought my '67 Camaro back to life. The paint hasn't looked this deep since it left the factory… absolutely flawless.",
    name: 'Mark T.',
    detail: 'St. Louis Car Collector',
  },
  {
    quote:
      "Their precision blew me away. Every vent, seam, and stitch was spotless. I've never seen my car this flawless, even brand new.",
    name: 'Alex M.',
    detail: 'St. Louis, MO',
  },
  {
    quote:
      "I'm meticulous about my cars, and they still found details I missed. The level of care is unmatched. Worth every penny.",
    name: 'David P.',
    detail: 'Porsche Enthusiast',
  },
  {
    quote:
      'My SUV was a rolling disaster with kids and coffee stains. After Jacob came out, it looks like it just rolled out of a showroom.',
    name: 'Jessica R.',
    detail: 'St. Charles',
  },
] as const;

export const faqs = [
  {
    q: 'How long does a full detail typically take?',
    a: 'Timing depends on the package. A Level I Tune-Up typically takes 2–3 hours, Level II The Refresh is a half-day to full-day service, and Level III The Knockout may take 1–2 days depending on paint correction and coating cure times.',
  },
  {
    q: 'Do you offer mobile services, or do I need to bring my car somewhere?',
    a: 'We are a fully mobile detailing service. We come to your home or workplace with all the equipment and products needed. All we require is adequate space to work.',
  },
  {
    q: 'Can you detail exotics, classics, or collector cars?',
    a: 'Absolutely. We specialize in careful, high-end detailing for luxury, exotic, and collector vehicles. Extra precautions are always taken to ensure your investment is protected and finished to show-quality standards.',
  },
] as const;

/** Marquee strip — drawn from vehicles visible in his own photo library. */
export const marque = [
  'Porsche',
  '911 Targa',
  'Ferrari F12',
  'Air-Cooled 964',
  'G-Wagon',
  'Escalade V',
  'Rivian R1S',
  'Corvette',
  'Daily Drivers',
  'Collector Cars',
] as const;

export const gallery = [
  { src: 'porsche-badge-foam.jpg', alt: 'Foam sheeting across the Panamera Turbo badge on a white Porsche', span: 'wide' },
  { src: 'caliper-macro.jpg', alt: 'Yellow Porsche brake caliper being cleaned behind the spokes of a wheel', span: 'tall' },
  { src: 'van-logo.jpg', alt: 'The Knock Em Down Mobile Detailing Service logo on the side of the work van' },
  { src: 'golden-hour-flare.jpg', alt: 'Detailer working on a white Porsche Panamera in low golden-hour sun' , span: 'wide' },
  { src: 'jacob-portrait.jpg', alt: 'Jacob taking a booking call in a Knock Em Down hoodie', span: 'tall' },
  { src: 'foam-panamera.jpg', alt: 'White Porsche Panamera buried under thick foam during a contact wash' },
  { src: 'gwagon-dusk.jpg', alt: 'Blacked-out Mercedes G63 finished and parked at dusk' },
  { src: 'wheel-cloth.jpg', alt: 'Hand cleaning a wheel face with a red microfiber cloth', span: 'tall' },
  { src: 'panamera-rear.jpg', alt: 'Rear three-quarter of a finished white Porsche Panamera' },
  { src: 'interior-amg-door.jpg', alt: 'Red quilted AMG door panel after a full interior detail' },
  { src: 'ked-hoodie.jpg', alt: 'Knock Em Down embroidered logo on a crew hoodie' },
  { src: 'exhaust-tips.jpg', alt: 'Foam running over the polished quad exhaust tips of a performance car', span: 'tall' },
  { src: 'porsche-964-red.jpg', alt: 'Air-cooled Porsche 911 964 on BBS wheels after detailing' },
  { src: 'ferrari-f12.jpg', alt: 'Ferrari F12 and Corvette detailed on a dealership lot' },
  { src: 'van-equipment.jpg', alt: 'The mobile rig loaded out with equipment, doors open on location' },
  { src: 'brake-caliper.jpg', alt: 'Macro detail of a red brake caliper behind a clean wheel' },
] as const;

/** Clip used for the type-masked band — a separate shot from the hero. */
export const band = {
  video: '/video/band-splash.mp4',
  poster: '/video/band-splash.jpg',
  word: 'Knock Em Down',
} as const;

/** Root-relative so the same nav works from the home page and /store. */
export const nav = [
  { label: 'Work', href: '/#work' },
  { label: 'Services', href: '/#services' },
  { label: 'Reviews', href: '/#reviews' },
  { label: 'FAQs', href: '/#faqs' },
  { label: 'Store', href: '/store' },
  { label: 'Contact', href: '/#contact' },
] as const;
