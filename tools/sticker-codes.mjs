// Random sticker codes for a batch of door-jamb QR labels.
//   node tools/sticker-codes.mjs 250 > stickers.csv
// Upload the CSV to a printer that does variable-data QR labels, or use
// tools/sticker-order.mjs to lay them out and order them from Printful. Each QR
// encodes the url column; Jacob scans a sticker in the app to link it to a car.
// Random, not sequential, so nobody can walk through other people's cars.
import { randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O or 1/I
export const SITE = process.env.KED_SITE || 'https://www.kedservice.com';

export function makeCodes(count) {
  const codes = new Set();
  while (codes.size < count) {
    codes.add(Array.from({ length: 7 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''));
  }
  return [...codes];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('code,url');
  for (const c of makeCodes(Number(process.argv[2] || 250))) console.log(`${c},${SITE}/c/${c}`);
}
