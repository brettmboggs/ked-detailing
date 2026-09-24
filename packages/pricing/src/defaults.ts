import type { PricingConfig } from './types.ts';

/**
 * PLACEHOLDER NUMBERS. Rough St. Louis mobile-detailing market rates, used to
 * build and test the quote flow. None of this is Jacob's pricing yet — replace
 * it with his real numbers before the quote page goes public.
 *
 * All money in cents.
 */
export const defaultConfig: PricingConfig = {
  version: 1,

  vehicleClasses: [
    { id: 'compact', label: 'Coupe or compact', examples: 'Civic, Miata, 911, Model 3', multiplier: 0.9 },
    { id: 'sedan', label: 'Sedan', examples: 'Camry, Accord, 3 Series, Model S', multiplier: 1 },
    { id: 'crossover', label: 'Small SUV or crossover', examples: 'RAV4, CR-V, Macan, Model Y', multiplier: 1.15 },
    { id: 'large', label: 'Full-size SUV or truck', examples: 'Tahoe, F-150, G-Wagon, R1S', multiplier: 1.3 },
    { id: 'xl', label: 'Van, 3-row or lifted', examples: 'Suburban, Sprinter, Odyssey, lifted trucks', multiplier: 1.45 },
  ],

  services: [
    {
      id: 'level-1',
      name: 'The Tune-Up',
      level: 'Level I',
      craft: 'vehicle',
      base: 15000,
      hours: [2, 3],
      spread: 0.08,
      // A maintenance wash doesn't do stain or odor work, so they don't price in.
      ignoresConditions: ['stains', 'odor'],
    },
    {
      id: 'level-2',
      name: 'The Refresh',
      level: 'Level II',
      craft: 'vehicle',
      base: 27500,
      hours: [4, 7],
      spread: 0.1,
    },
    {
      id: 'level-3',
      name: 'The Knockout',
      level: 'Level III',
      craft: 'vehicle',
      base: 45000,
      hours: [8, 14],
      spread: 0.12,
    },
    {
      id: 'level-4',
      name: 'The Revival',
      level: 'Level IV',
      craft: 'vehicle',
      base: 65000,
      hours: [6, 10],
      spread: 0.15,
      // Paint correction. The interior isn't part of the job.
      ignoresConditions: ['pet-hair', 'interior', 'stains', 'odor'],
    },
    {
      id: 'ceramic',
      name: 'Paint Correction & Ceramic Coating',
      level: '',
      craft: 'vehicle',
      base: 0,
      hours: [10, 18],
      spread: 0,
      inspectionOnly: true,
      ignoresConditions: ['pet-hair', 'interior', 'stains', 'odor'],
    },
    {
      id: 'marine',
      name: 'Marine Maintenance',
      level: '',
      craft: 'boat',
      base: 1500, // per foot
      hours: [0.15, 0.25], // per foot
      spread: 0.15,
    },
  ],

  conditions: [
    {
      id: 'pet-hair',
      question: 'Pet hair?',
      craft: 'vehicle',
      options: [
        { id: 'none', label: 'No pet hair', add: 0, hours: 0, scalesWithSize: false },
        { id: 'some', label: 'Some pet hair', add: 4000, hours: 0.5, scalesWithSize: true },
        { id: 'heavy', label: 'Heavy pet hair', add: 9000, hours: 1.5, scalesWithSize: true },
      ],
    },
    {
      id: 'interior',
      question: 'How is the interior?',
      craft: 'vehicle',
      options: [
        { id: 'normal', label: 'Normal use', add: 0, hours: 0, scalesWithSize: false },
        { id: 'heavy', label: 'Heavily soiled interior', add: 6000, hours: 1, scalesWithSize: true },
        {
          id: 'extreme',
          label: 'Mold, fluids or spills',
          add: 15000,
          hours: 2,
          scalesWithSize: true,
          flagsInspection: true,
        },
      ],
    },
    {
      id: 'stains',
      question: 'Stains on seats or carpet?',
      craft: 'vehicle',
      options: [
        { id: 'none', label: 'No stains', add: 0, hours: 0, scalesWithSize: false },
        { id: 'few', label: 'A few stains', add: 3000, hours: 0.5, scalesWithSize: false },
        { id: 'many', label: 'Lots of stains', add: 7500, hours: 1, scalesWithSize: true },
      ],
    },
    {
      id: 'odor',
      question: 'Any smells?',
      craft: 'vehicle',
      options: [
        { id: 'none', label: 'No odor', add: 0, hours: 0, scalesWithSize: false },
        { id: 'smoke', label: 'Smoke odor', add: 10000, hours: 1, scalesWithSize: false },
      ],
    },
    {
      id: 'exterior',
      question: 'How dirty is the outside?',
      craft: 'vehicle',
      options: [
        { id: 'normal', label: 'Normal road dirt', add: 0, hours: 0, scalesWithSize: false },
        { id: 'heavy', label: 'Mud, sap or heavy bugs', add: 4000, hours: 0.5, scalesWithSize: true },
      ],
    },
    {
      id: 'oxidation',
      question: 'How is the gelcoat?',
      craft: 'boat',
      options: [
        { id: 'good', label: 'Shiny, no chalkiness', add: 0, hours: 0, scalesWithSize: false },
        { id: 'moderate', label: 'Dull or chalky', add: 400, hours: 0.05, scalesWithSize: true },
        {
          id: 'heavy',
          label: 'Heavy oxidation',
          add: 800,
          hours: 0.1,
          scalesWithSize: true,
          flagsInspection: true,
        },
      ],
    },
    {
      id: 'mildew',
      question: 'Mildew on the upholstery?',
      craft: 'boat',
      options: [
        { id: 'none', label: 'No mildew', add: 0, hours: 0, scalesWithSize: false },
        { id: 'some', label: 'Mildew on upholstery', add: 7500, hours: 1, scalesWithSize: false },
      ],
    },
  ],

  addOns: [
    {
      id: 'headlights',
      label: 'Headlight restoration',
      description: 'Sand, polish and seal cloudy headlights.',
      craft: 'vehicle',
      price: 8000,
      hours: 1,
      scalesWithSize: false,
    },
    {
      id: 'engine-bay',
      label: 'Engine bay detail',
      description: 'Degrease, rinse and dress the engine bay.',
      craft: 'vehicle',
      price: 6000,
      hours: 0.75,
      scalesWithSize: false,
      includedIn: ['level-3'],
    },
    {
      id: 'sealant',
      label: 'Paint sealant',
      description: 'Months of gloss and water beading, not weeks.',
      craft: 'vehicle',
      price: 7500,
      hours: 0.75,
      scalesWithSize: true,
      includedIn: ['level-3', 'level-4', 'ceramic'],
    },
    {
      id: 'trim',
      label: 'Trim restoration',
      description: 'Bring faded black plastic trim back to black.',
      craft: 'vehicle',
      price: 5000,
      hours: 0.5,
      scalesWithSize: true,
    },
    {
      id: 'trailer',
      label: 'Trailer wash',
      description: 'Wash the trailer, wheels and bunks.',
      craft: 'boat',
      price: 5000,
      hours: 0.75,
      scalesWithSize: false,
    },
  ],

  travel: {
    zones: [
      // Placeholder zoning by ZIP prefix. 630/631 covers the city, the county
      // and Jefferson County around High Ridge (63049).
      { id: 'core', label: 'St. Louis & Jefferson County', zips: ['630', '631'], fee: 0 },
      { id: 'st-charles', label: 'St. Charles County', zips: ['633'], fee: 2500 },
      { id: 'outer', label: 'Outer Missouri', zips: ['636'], fee: 5000 },
    ],
    outsideFee: null,
  },

  minimum: 12000,
  roundTo: 500,
  boatFeet: [14, 40],
};
