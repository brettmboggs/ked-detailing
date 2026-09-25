// Random sticker codes for a batch of door-jamb QR labels.
//   node tools/sticker-codes.mjs 250 > stickers.csv
// Upload the CSV to a printer that does variable-data QR labels. Each QR
// encodes the url column; Jacob scans a sticker in the app to link it to a car.
// Random, not sequential, so nobody can walk through other people's cars.
import { randomInt } from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O or 1/I
const SITE = process.env.KED_SITE || 'https://www.kedservice.com';
const count = Number(process.argv[2] || 250);

const codes = new Set();
while (codes.size < count) {
  codes.add(Array.from({ length: 7 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''));
}
console.log('code,url');
for (const c of codes) console.log(`${c},${SITE}/c/${c}`);
