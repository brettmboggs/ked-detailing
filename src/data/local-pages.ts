/**
 * Service pages (/services/<slug>/) and service-area pages (/areas/<slug>/).
 *
 * These exist so the site can rank for what people actually search: "ceramic
 * coating St. Louis", "mobile detailing Chesterfield". Each page has to earn
 * its place with something of its own. Google treats near-identical town
 * pages as doorway spam, so every area carries its own ZIPs, drive time and
 * travel fee (worked out from the live pricing and scheduling data at build)
 * and a note that is only true of that place.
 *
 * Every claim here is one the rest of the site already makes. Don't add
 * product names, warranty lengths or prices that aren't in the pricing
 * config: those come from Jacob.
 *
 * TENANT: all of this is Knock Em' Down's. See docs/multi-tenant.md.
 */

export interface Faq {
  q: string;
  a: string;
}

export interface ServicePage {
  slug: string;
  /** Pricing service id for "From $X" and the quote link. */
  serviceId: string;
  title: string;
  description: string;
  eyebrow: string;
  headline: [string, string];
  /** Photo in src/assets/photos. */
  photo: string;
  photoAlt: string;
  intro: string;
  sections: { heading: string; body: string[]; list?: string[] }[];
  duration: string;
  /** A real review from site.ts testimonials, by name, when one fits. */
  review?: string;
  faqs: Faq[];
  related: string[];
}

export const servicePages: ServicePage[] = [
  {
    slug: 'ceramic-coating',
    serviceId: 'ceramic',
    title: "Ceramic Coating St. Louis | Knock Em' Down Detailing",
    description:
      'Mobile ceramic coating in St. Louis: paint correction first, then the coat, applied at your home. Certificate, care guide and upkeep reminders included.',
    eyebrow: 'Ceramic coating · St. Louis',
    headline: ['Ceramic coating,', 'in your driveway.'],
    photo: 'porsche-badge-foam.jpg',
    photoAlt: 'Foam running off a Porsche badge during the prep wash before a coating',
    intro:
      "A ceramic coating is a hard, glassy layer bonded to your paint. Water beads and sheets off, dirt lets go in the wash, and the finish keeps its gloss for years instead of months. Jacob applies it at your home or office across the St. Louis area, and he does the prep properly first, because a coating locks in whatever is underneath it.",
    sections: [
      {
        heading: 'Correction first, then the coat',
        body: [
          'Coating over swirls and water spots seals them in. So every coating starts with a full decontamination wash and clay, then a machine polish to take the swirls, light scratches and oxidation out of the clear coat. Only then does the coating go on, panel by panel.',
          "How much correction your paint needs is the one thing that can't be priced from a form. That's why coatings are quoted after Jacob has seen the panels.",
        ],
      },
      {
        heading: 'What you get',
        body: ['Every coated car leaves with its paperwork, so the protection is on record whoever owns it next.'],
        list: [
          'Decontamination wash, iron remover and clay bar',
          'Machine paint correction matched to your paint',
          'Ceramic coating applied panel by panel',
          'A coating certificate and care guide, emailed to you',
          "A reminder when the coating's maintenance visit is due",
          'An online page for the car with its coating and service dates, for you or whoever owns it next',
        ],
      },
      {
        heading: 'Looking after it',
        body: [
          'Give it a week to cure before the first wash. After that, a hand wash with a pH-neutral soap is all it needs. Skip automatic washes with brushes, and get bird droppings and tree sap off within a day or two.',
          'Most coatings want a maintenance visit about once a year to decontaminate the surface and top it up. You will get a reminder when yours is due, and the visit keeps the warranty going.',
        ],
      },
    ],
    duration: 'Usually 6–10 hours, depending on the correction',
    faqs: [
      {
        q: 'How long does a ceramic coating last?',
        a: "It depends on the coating and how the car is looked after. Your certificate states the warranty term for the coating you get, and yearly maintenance visits keep it valid.",
      },
      {
        q: 'Can you coat a brand-new car?',
        a: 'Yes, and it is the best time. New cars still usually need a light polish to take out marks from transport and dealer washes before the coating goes on.',
      },
      {
        q: 'Do you need a garage?',
        a: 'No. A driveway works. The van brings its own water and power. Coatings do need a dry day, so if rain is forecast Jacob will let you know and offer another day.',
      },
      {
        q: 'Is a coating worth it over a sealant?',
        a: 'A sealant (included in The Knockout) lasts months. A coating lasts years and makes every wash easier. If you keep the car a long time, the coating usually pays for itself.',
      },
    ],
    related: ['paint-correction', 'interior-detailing'],
  },
  {
    slug: 'paint-correction',
    serviceId: 'level-4',
    title: "Paint Correction St. Louis | Knock Em' Down Detailing",
    description:
      'Mobile paint correction in St. Louis. A machine polish that cuts swirls, light scratches and oxidation out of the clear coat, done at your home or office.',
    eyebrow: 'Paint correction · St. Louis',
    headline: ['Swirls out.', 'Depth back.'],
    photo: 'gwagon-estate.jpg',
    photoAlt: 'A black G-Wagon with a corrected, mirror-like finish',
    intro:
      "Swirl marks, haze and fine scratches live in the clear coat, the top layer of your paint. A wash can't touch them. Paint correction is a machine polish that levels the clear coat so light reflects cleanly again, which is where the depth and gloss come back from. Jacob does it at your home or office anywhere in the St. Louis area.",
    sections: [
      {
        heading: 'The Revival: a one-step correction',
        body: [
          "Level IV, The Revival, is a one-step machine polish. It is the right call for most daily drivers: it takes out up to half of the imperfections in one pass and leaves the paint glossy and protected for about six months.",
        ],
        list: [
          'Prep wash and clay bar treatment',
          'One-step machine polish',
          'Removes light scratches, swirls and oxidation',
          'Up to 50% of imperfections eliminated',
          'Six-month paint protectant',
        ],
      },
      {
        heading: 'When it needs more',
        body: [
          'Deeper defects, very soft paint, or a car headed for a ceramic coating can call for multi-stage correction: a cutting step, then a finishing polish. That is quoted after Jacob has seen the panels under light, so you pay for what the paint needs and nothing it does not.',
          'Some scratches go through the clear coat. Those can be improved but not polished out, and Jacob will tell you which is which before starting.',
        ],
      },
    ],
    duration: '4–7 hours; multi-stage work up to about 10',
    review: 'Ian R.',
    faqs: [
      {
        q: 'Will paint correction remove every scratch?',
        a: 'It removes what is in the clear coat: swirls, haze, water spots and light scratches. If you can catch a scratch with a fingernail, it is usually deeper and can be reduced but not erased.',
      },
      {
        q: 'Is it safe for my paint?',
        a: 'Correction removes a very thin layer of clear coat, so it is done with care and only as much as needed. That is why it is quoted after an inspection and not sold by the hour.',
      },
      {
        q: 'Should I coat the car afterwards?',
        a: 'If you want the result to last years instead of months, yes. Correction is the prep a ceramic coating needs anyway.',
      },
    ],
    related: ['ceramic-coating', 'interior-detailing'],
  },
  {
    slug: 'interior-detailing',
    serviceId: 'level-2',
    title: "Interior Car Detailing St. Louis | Knock Em' Down",
    description:
      'Mobile interior detailing in St. Louis: stain removal, hot water extraction, pet hair and odor, done at your home. Instant quote online.',
    eyebrow: 'Interior detailing · St. Louis',
    headline: ['Stripped back.', 'Rebuilt clean.'],
    photo: 'interior-amg-seat.jpg',
    photoAlt: 'A detailed leather seat in a Mercedes-AMG interior',
    intro:
      "Crushed snacks under the seats, a dog's winter coat in the carpet, a coffee that went sideways. Interior detailing is where most of the time in a real detail goes, and where the difference is easiest to feel. Jacob does it in your driveway anywhere around St. Louis, with his own water and power.",
    sections: [
      {
        heading: 'The Refresh: a full reset',
        body: ['Level II, The Refresh, strips the interior back and rebuilds it, and does the paint while it is there.'],
        list: [
          'Interior scrub: plastics, vents and buttons',
          'Stain removal',
          'Glass polish',
          'Odor neutralization',
          'Foam and contact wash, clay bar and wheels outside',
        ],
      },
      {
        heading: 'When it needs the deep clean',
        body: [
          'Level III, The Knockout, adds hot water extraction or steam for the carpets and seats, the engine bay and a paint sealant. It is the one for cars that have been lived in hard, or that are being sold or handed down.',
          'Pet hair, heavy staining, smoke and mildew each take real extra time, so they are priced on their own in the instant quote instead of being a surprise on the day.',
        ],
      },
    ],
    duration: '1½–4 hours, depending on condition',
    review: 'Nina Hanser',
    faqs: [
      {
        q: 'Can you get pet hair out?',
        a: 'Yes. It is slow work, so it is its own line in the quote (some or heavy), which keeps the price honest for cars without it.',
      },
      {
        q: 'Can you remove smoke smell?',
        a: 'Smoke odor is treated as its own job on top of the detail. Tell Jacob how bad it is when you ask for a quote, and he will say what to expect.',
      },
      {
        q: 'Do I need to be home?',
        a: 'Only to hand over the keys and look at it at the end. Plenty of customers are at work while Jacob is in the parking lot.',
      },
    ],
    related: ['paint-correction', 'ceramic-coating'],
  },
  {
    slug: 'boat-detailing',
    serviceId: 'marine',
    title: "Boat Detailing St. Louis | Knock Em' Down Detailing",
    description:
      'Mobile boat detailing around St. Louis: hulls, gelcoat oxidation, vinyl and upholstery, mildew and trailers. Same process as the cars, on a bigger canvas.',
    eyebrow: 'Marine detailing · St. Louis',
    headline: ['Boats get', 'the same standard.'],
    photo: 'van-equipment.jpg',
    photoAlt: "The detailing van's water tank, pressure washer and equipment",
    intro:
      "Knock Em' Down is registered as an auto and marine detailing business, and boats get the same process and standard as the cars. Gelcoat chalks, vinyl mildews and hulls pick up river and lake grime, and all of it comes back with the right products and patience. Jacob comes to your home or wherever the boat is stored around St. Louis.",
    sections: [
      {
        heading: 'What a boat detail covers',
        body: ['Every boat is quoted by its length and condition, so the instant quote asks for both.'],
        list: [
          'Hull and deck wash',
          'Gelcoat oxidation removal and polish, as the boat needs it',
          'Vinyl and upholstery cleaning and protection',
          'Mildew treatment',
          'Trailer, wheels and bunks, if you want them done',
        ],
      },
      {
        heading: 'Before the season and after it',
        body: [
          'The two best times are before you put in, so the gelcoat is protected for the summer, and before it goes into storage, so dirt and mildew are not sealed in over the winter.',
        ],
      },
    ],
    duration: 'Depends on length and condition',
    faqs: [
      {
        q: 'What size boats do you do?',
        a: 'The quote covers boats from about 14 to 40 feet. Bigger than that, text Jacob.',
      },
      {
        q: 'Can you come to a marina or storage lot?',
        a: 'It depends on the rules where it is kept. Say where the boat is when you ask for a quote and Jacob will let you know.',
      },
      {
        q: 'Do you fix chalky, faded gelcoat?',
        a: 'Yes. Oxidation is priced by how bad it is, from dull to heavily chalked, and is polished back rather than just waxed over.',
      },
    ],
    related: ['ceramic-coating', 'interior-detailing'],
  },
];

export interface AreaPage {
  slug: string;
  name: string;
  county: string;
  /** Their ZIPs, for the travel fee, the drive time and the page. */
  zips: string[];
  /** Only true of this place. One or two sentences. */
  note: string;
  /** Which service to lead with here, from servicePages. */
  lead: string;
  nearby: string[];
}

export const areaPages: AreaPage[] = [
  {
    slug: 'brentwood',
    name: 'Brentwood',
    county: 'St. Louis County',
    zips: ['63144'],
    note: 'Brentwood is home base. Jacob lives and works here, so it gets the shortest drive, the easiest scheduling and no travel charge.',
    lead: 'paint-correction',
    nearby: ['ladue', 'clayton', 'webster-groves', 'kirkwood'],
  },
  {
    slug: 'ladue',
    name: 'Ladue',
    county: 'St. Louis County',
    zips: ['63124'],
    note: 'Ladue is minutes from home base. Long private drives and big garages mean the work happens out of sight, and the van brings its own water and power, so nobody needs to let anyone into the house.',
    lead: 'ceramic-coating',
    nearby: ['clayton', 'frontenac', 'brentwood', 'creve-coeur'],
  },
  {
    slug: 'clayton',
    name: 'Clayton',
    county: 'St. Louis County',
    zips: ['63105'],
    note: 'Clayton is next door to home base. The car can be done at home or in your office garage during the workday, and the same person handles it every time.',
    lead: 'paint-correction',
    nearby: ['ladue', 'brentwood', 'central-west-end', 'creve-coeur'],
  },
  {
    slug: 'frontenac',
    name: 'Frontenac',
    county: 'St. Louis County',
    zips: ['63131'],
    note: "Frontenac's garages hold cars that come out on weekends and sit the rest of the week. A sealant or a ceramic coating keeps them ready to drive without a full wash every time.",
    lead: 'ceramic-coating',
    nearby: ['ladue', 'town-and-country', 'creve-coeur', 'kirkwood'],
  },
  {
    slug: 'town-and-country',
    name: 'Town and Country',
    county: 'St. Louis County',
    zips: ['63131', '63017'],
    note: 'Town and Country sits between home base and Chesterfield along I-64, and private streets and gated drives are routine. Jacob works alone, so the same person is on your property every time.',
    lead: 'paint-correction',
    nearby: ['frontenac', 'chesterfield', 'creve-coeur', 'wildwood'],
  },
  {
    slug: 'creve-coeur',
    name: 'Creve Coeur',
    county: 'St. Louis County',
    zips: ['63141'],
    note: 'Plenty of Creve Coeur details happen in an office or medical-building garage while the owner works. Leave the keys in the morning and the car is finished before you head home.',
    lead: 'interior-detailing',
    nearby: ['ladue', 'frontenac', 'town-and-country', 'clayton'],
  },
  {
    slug: 'central-west-end',
    name: 'Central West End',
    county: 'City of St. Louis',
    zips: ['63108'],
    note: "The Central West End's private places and carriage-house garages are tight, and the van is set up for that: its own water and power, so a curb or a single garage bay is all it needs.",
    lead: 'interior-detailing',
    nearby: ['clayton', 'brentwood', 'ladue'],
  },
  {
    slug: 'kirkwood',
    name: 'Kirkwood',
    county: 'St. Louis County',
    zips: ['63122'],
    note: "Kirkwood's old trees are lovely until they drop sap, pollen and bird droppings on your paint. A sealant or a ceramic coating makes that wash off instead of etching in.",
    lead: 'ceramic-coating',
    nearby: ['webster-groves', 'brentwood', 'frontenac', 'town-and-country'],
  },
  {
    slug: 'webster-groves',
    name: 'Webster Groves',
    county: 'St. Louis County',
    zips: ['63119'],
    note: 'Webster Groves has the same tree canopy as its neighbor Kirkwood, and the same sap and pollen season. A single-car driveway is all the van needs.',
    lead: 'paint-correction',
    nearby: ['kirkwood', 'brentwood', 'clayton'],
  },
  {
    slug: 'chesterfield',
    name: 'Chesterfield',
    county: 'St. Louis County',
    zips: ['63017', '63005'],
    note: "Chesterfield sees plenty of luxury and collector cars, and they get the same careful process as everything else. Office parks in Chesterfield Valley are an easy place to leave the car with Jacob for the day.",
    lead: 'paint-correction',
    nearby: ['town-and-country', 'wildwood', 'frontenac', 'creve-coeur'],
  },
  {
    slug: 'wildwood',
    name: 'Wildwood',
    county: 'St. Louis County',
    zips: ['63038', '63040'],
    note: 'Wildwood has long drives and bigger lots, often without an outside tap where you want one. The van carries its own water and power, so nothing needs hooking up, and there is no travel charge out this far.',
    lead: 'ceramic-coating',
    nearby: ['chesterfield', 'town-and-country'],
  },
];
