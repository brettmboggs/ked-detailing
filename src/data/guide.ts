/**
 * The /guide page: what each treatment is, who needs it and why it takes skill.
 * Written for someone who has only ever been through a car wash. Claims stay
 * inside what the packages in site.ts actually include.
 *
 * `pricing` ties a treatment to the live price list: `addOn` and `service` are
 * pricing ids, `included` are package ids that already do it.
 */
export interface GuideTopic {
  id: string;
  name: string;
  /** The symptom the customer notices, for the card deck. */
  symptom: string;
  /** One line, plain words. */
  plain: string;
  who: string[];
  what: string;
  skill: string;
  photo?: string;
  photoAlt?: string;
  pricing: { included?: string[]; addOn?: string; service?: string; condition?: string };
}

export const guideTopics: GuideTopic[] = [
  {
    id: 'clay-bar',
    name: 'Clay bar and iron remover',
    symptom: 'The paint feels rough, even right after a wash',
    plain: 'Pulls out the grit that is stuck in the paint, which a wash mitt slides right over.',
    who: [
      'Put your hand in a sandwich bag and run it across the hood. If it feels like fine sandpaper, you need it.',
      'Tiny orange or brown dots on white or silver paint are rail dust and brake dust rusting on the surface.',
      'Any car that is about to be polished, sealed or coated. Protection will not bond to dirty paint.',
    ],
    what: 'An iron remover goes on first and dissolves the metal particles. You can watch it turn purple as it works. Then a clay bar glides over every panel on a layer of lubricant and lifts out what is left: tree sap mist, industrial fallout, overspray.',
    skill: 'Clay picks up whatever it touches. Press too hard, skip the lubricant or keep using a piece that has grit in it, and you drag that grit across the paint and leave scratches. It gets folded to a clean face constantly, and a piece that hits the ground goes in the trash.',
    photo: 'porsche-badge-foam.jpg',
    photoAlt: 'Foam running down a Porsche badge during a wash',
    pricing: { included: ['level-2', 'level-3', 'level-4'] },
  },
  {
    id: 'polishing',
    name: 'Machine polishing',
    symptom: 'Spiderwebs and swirls show up in the sun',
    plain: 'Takes a microscopically thin layer off the clear coat so it is flat again and reflects light cleanly.',
    who: [
      'Shine a phone flashlight on the paint at night. If you see circles of fine scratches around the light, those are swirls.',
      'Paint that looks dull or hazy even when it is clean.',
      'Dark cars, and any car that has been through brush car washes.',
    ],
    what: 'A machine polisher with a pad and a compound is worked across each panel in slow, overlapping passes. The Revival is a one-step polish that removes up to half the defects. Paint headed for a ceramic coating usually gets two steps: a cut, then a finishing polish.',
    skill: 'The clear coat is thinner than a sheet of paper, and once it is gone it is gone. Every car is different: some paint is soft and marks easily, some is hard and barely moves. Edges and body lines have the least paint on them and burn through first. Jacob tests a small spot first and takes only as much as the paint needs.',
    photo: 'porsche-964-red.jpg',
    photoAlt: 'A red Porsche 964 with a deep, glossy finish',
    pricing: { service: 'level-4', included: ['level-4', 'ceramic'] },
  },
  {
    id: 'sealant',
    name: 'Paint sealant',
    symptom: 'Water sits flat on the paint instead of beading',
    plain: 'A layer of protection that sits on top of the paint, so bugs, sap and road film hit it instead of your clear coat.',
    who: [
      'Spray the hood with a hose. If the water sits in flat sheets and runs off slowly, there is no protection left.',
      'Cars parked outside, under trees, or driven through winter.',
      'Anyone who wants washing to be easier. Dirt lets go of sealed paint.',
    ],
    what: 'Wax looks great and lasts weeks. A sealant is synthetic and lasts months. A ceramic coating lasts years. The sealant goes on panel by panel after the paint has been decontaminated, then it is left to cure.',
    skill: 'It only lasts as long as the surface underneath is clean. Sealant over gritty paint seals the grit in and peels off early. That is why it comes after the clay bar, never instead of it.',
    pricing: { addOn: 'sealant', included: ['level-3', 'level-4', 'ceramic'] },
  },
  {
    id: 'ceramic',
    name: 'Ceramic coating',
    symptom: 'You plan to keep this car for years',
    plain: 'A hard, glassy layer bonded to the paint that keeps its gloss and water beading for years, not months.',
    who: [
      'New cars. It is the best time to coat, before the swirls start.',
      'Anyone keeping a car for three years or more. It usually pays for itself in washes and polishing you skip.',
      'Garage-kept cars, collectors and lease returns you want spotless.',
    ],
    what: 'A decontamination wash, iron remover and clay. Then machine correction, because a coating locks in whatever is underneath it. Then the coating goes on one panel at a time, gets levelled, and cures.',
    skill: 'Most of the job is the prep, and that prep is paint correction. The coating itself has a short window: wipe it too soon and it smears, too late and it leaves a hard, rainbow-looking high spot that has to be polished off. A coating over swirls makes the swirls permanent.',
    photo: 'panamera-rear.jpg',
    photoAlt: 'The rear of a Porsche Panamera with a mirror finish',
    pricing: { service: 'ceramic' },
  },
  {
    id: 'headlights',
    name: 'Headlight restoration',
    symptom: 'Headlights are yellow, cloudy or dim at night',
    plain: 'Sands off the burned, yellowed top layer of the lens, polishes it clear and seals it so it stays that way.',
    who: [
      'Any lens that looks foggy or yellow from the outside.',
      'If your low beams barely light the road, cloudy lenses can cut the light a lot. This is a safety fix, not just a looks one.',
      'Cars about to be sold. Clear headlights make a car look years younger.',
    ],
    what: 'The lens is masked off and wet sanded through several grits, each finer than the last, then machine polished until it is clear. A UV-blocking sealant goes on at the end.',
    skill: 'The plastic is soft and the paint around it is close. Skip a grit and the sanding marks show forever. Skip the UV seal and the yellow comes back in a few months, which is what happens with the kits from the auto parts store.',
    photo: 'headlight-macro.jpg',
    photoAlt: 'A close-up of a clear, restored headlight',
    pricing: { addOn: 'headlights' },
  },
  {
    id: 'trim',
    name: 'Trim restoration',
    symptom: 'The black plastic has gone gray and chalky',
    plain: 'Brings faded black plastic trim, bumpers and mirror caps back to a deep black.',
    who: [
      'SUVs and trucks with lots of unpainted plastic.',
      'Trim that leaves a white or gray mark when you rub it.',
      'Cars that look clean but still old. Faded trim is usually why.',
    ],
    what: 'The trim is deep cleaned to get the old dressings and oxidation out of the pores, the paint around it is protected, and a restorer goes on that soaks in rather than sitting on top.',
    skill: 'The shiny spray from the gas station sits on the surface, looks wet for a week and runs down the paint in the first rain. A real restoration starts with getting the plastic truly clean, and keeping it off the paint.',
    pricing: { addOn: 'trim' },
  },
  {
    id: 'engine-bay',
    name: 'Engine bay detail',
    symptom: 'Opening the hood is embarrassing',
    plain: 'A careful degrease and clean of everything under the hood, then a dressing so plastics and rubber look new.',
    who: [
      'Selling or trading in. A clean engine bay tells a buyer the car was looked after.',
      'Leaves, nests or salt built up around the cowl and battery.',
      'Older cars where leaks are hard to spot under the grime.',
    ],
    what: 'Sensitive electrics are covered, the bay is degreased and agitated by hand, rinsed gently with low pressure, dried and dressed.',
    skill: 'Water in the wrong connector can cause a warning light or worse. Knowing what to cover, how much water to use and how to dry it is the whole job. A pressure washer is the wrong tool.',
    pricing: { addOn: 'engine-bay', included: ['level-3'] },
  },
  {
    id: 'extraction',
    name: 'Hot water extraction and steam',
    symptom: 'Stains, spills or salt rings in the carpet',
    plain: 'Flushes carpets and cloth seats with hot water and pulls the dirty water back out, along with what soaked down into the padding.',
    who: [
      'White salt rings on the floor from winter boots.',
      'Kids, car seats, spilled coffee, anything that soaked in.',
      'Seats that look clean but feel sticky or smell when the car warms up.',
    ],
    what: 'Seats and carpet are pre-treated, agitated with brushes, then flushed and extracted. Steam handles the spots that should not get soaked, like seams, vents and cup holders. Then everything is dried.',
    skill: 'A vacuum only gets the surface. What you smell lives in the foam under it. Too much water and the seat stays damp for days and grows mildew. Too little and the stain wicks back up when it dries. Getting it right is about knowing how much each material can take.',
    photo: 'interior-amg-seat.jpg',
    photoAlt: 'A spotless leather seat in an AMG interior',
    pricing: { included: ['level-3'] },
  },
  {
    id: 'pet-hair',
    name: 'Pet hair removal',
    symptom: 'The dog rides along',
    plain: 'Gets out the hair that is woven into the carpet, which a vacuum alone will not pull up.',
    who: [
      'Any car a dog rides in regularly.',
      'Hair you can see stuck in the carpet weave or seat fabric after vacuuming.',
      'Before selling a car. Buyers with allergies notice.',
    ],
    what: 'Rubber brushes and stones loosen the hair from the fibers so it can be vacuumed up, section by section.',
    skill: 'There is no shortcut. Pet hair weaves itself into carpet and has to be worked out by hand, a few square inches at a time. Heavy hair can add an hour or more, which is why the quote asks how much there is.',
    pricing: { condition: 'pet-hair' },
  },
  {
    id: 'odor',
    name: 'Odor removal',
    symptom: 'It smells like smoke, food or a wet dog',
    plain: 'Finds what is causing the smell and gets rid of it, rather than covering it with a fragrance.',
    who: [
      'Smokers, or a car bought from one.',
      'Spilled milk, food or anything left in a hot car.',
      'A musty smell when the A/C comes on.',
    ],
    what: 'Every source gets cleaned out: carpet, seats, headliner, vents and the places under the seats nobody looks. Then the cabin is treated to neutralize what is left in the air.',
    skill: 'An air freshener lasts a week and then you get both smells. Smoke gets into the headliner and the vents, and spilled milk soaks down to the floor pan. The smell stays until the source is cleaned out.',
    pricing: { included: ['level-2', 'level-3'], condition: 'odor' },
  },
  {
    id: 'gelcoat',
    name: 'Gelcoat oxidation (boats)',
    symptom: 'The hull is chalky and leaves white on your hand',
    plain: 'Polishes the oxidized, chalky top layer off the gelcoat so the color and shine come back, then protects it.',
    who: [
      'Wipe the hull with your hand. If it comes away white, the gelcoat is oxidized.',
      'Boats that sit in the sun all summer at the lake.',
      'Colors that have faded, like red going pink or navy going gray.',
    ],
    what: 'The hull is washed, then machine polished with a compound matched to how bad the oxidation is, then sealed so the sun has something to burn through first.',
    skill: 'Waxing over oxidation just traps the chalk. Light oxidation polishes off quickly, heavy oxidation takes several passes, and how bad it is changes the price. That is why the quote asks.',
    pricing: { service: 'marine', condition: 'oxidation' },
  },
];

/** Short, practical. Things a customer can do between visits. */
export const guideTips: { title: string; body: string }[] = [
  {
    title: 'Skip the brush car wash',
    body: 'The spinning brushes hold grit from every car before yours. They are where most swirl marks come from. Touchless is better if you are in a hurry.',
  },
  {
    title: 'Never use dish soap',
    body: 'It is made to cut grease, and it strips sealant and wax just as well. Use a car shampoo.',
  },
  {
    title: 'Get bird droppings off fast',
    body: 'They are acidic, and on a hot St. Louis afternoon they can etch the clear coat in a day. Soak with quick detailer, then lift. Do not scrub.',
  },
  {
    title: 'Rinse the salt off in winter',
    body: 'Road brine keeps eating at the underside and wheels long after the snow melts. A rinse, underneath too, every week or two makes a real difference.',
  },
  {
    title: 'Dry with microfiber, not a bath towel',
    body: 'A bath towel or squeegee drags any grit you missed across the paint. A clean, plush microfiber towel, or a leaf blower, does not.',
  },
  {
    title: 'Wash in the shade',
    body: 'On a hot panel, soap and water dry before you rinse them and leave spots that can etch. Wash early or late, or under cover.',
  },
  {
    title: 'Put down rubber mats in winter',
    body: 'Snow and salt off your boots soak into carpet and leave white rings that only extraction gets out.',
  },
  {
    title: 'Go easy on shiny interior sprays',
    body: 'Greasy dressings make the dash glare in the windshield and the steering wheel slick. A good interior cleaner leaves a matte, factory finish.',
  },
];
