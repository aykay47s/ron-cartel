/* Couriers, countries and zones.
 *
 * The shop sells worldwide, so a delivery option has to know two things the
 * old one did not: who carries it, and where it is allowed to go. Checkout
 * asks the customer for a country and only offers what actually reaches it.
 *
 * Courier marks are drawn here rather than fetched. Real carrier logos are
 * trademarks and hotlinking them is both a legal and a broken-image problem;
 * a clean glyph plus the carrier's name in type says the same thing.
 */

export const COURIERS = {
  '':           { name: 'No courier',   glyph: 'box' },
  royalmail:    { name: 'Royal Mail',   glyph: 'post' },
  parcelforce:  { name: 'Parcelforce',  glyph: 'van' },
  dpd:          { name: 'DPD',          glyph: 'van' },
  evri:         { name: 'Evri',         glyph: 'box' },
  yodel:        { name: 'Yodel',        glyph: 'box' },
  ups:          { name: 'UPS',          glyph: 'van' },
  fedex:        { name: 'FedEx',        glyph: 'plane' },
  dhl:          { name: 'DHL',          glyph: 'plane' },
  tnt:          { name: 'TNT',          glyph: 'plane' },
  palletways:   { name: 'Palletways',   glyph: 'pallet' },
  collect:      { name: 'Collection',   glyph: 'pin' },
};

/* ISO-2 for everywhere we might ship. Kept short enough to read, long enough
   to cover where Sur-Rons actually go. */
export const COUNTRIES = [
  ['GB', 'United Kingdom'], ['IE', 'Ireland'], ['FR', 'France'], ['DE', 'Germany'],
  ['NL', 'Netherlands'], ['BE', 'Belgium'], ['LU', 'Luxembourg'], ['ES', 'Spain'],
  ['PT', 'Portugal'], ['IT', 'Italy'], ['AT', 'Austria'], ['CH', 'Switzerland'],
  ['DK', 'Denmark'], ['SE', 'Sweden'], ['NO', 'Norway'], ['FI', 'Finland'],
  ['PL', 'Poland'], ['CZ', 'Czechia'], ['SK', 'Slovakia'], ['HU', 'Hungary'],
  ['RO', 'Romania'], ['BG', 'Bulgaria'], ['GR', 'Greece'], ['HR', 'Croatia'],
  ['SI', 'Slovenia'], ['EE', 'Estonia'], ['LV', 'Latvia'], ['LT', 'Lithuania'],
  ['MT', 'Malta'], ['CY', 'Cyprus'],
  ['US', 'United States'], ['CA', 'Canada'], ['AU', 'Australia'], ['NZ', 'New Zealand'],
  ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['ZA', 'South Africa'],
  ['JP', 'Japan'], ['SG', 'Singapore'], ['HK', 'Hong Kong'],
];

const EU = new Set(['IE','FR','DE','NL','BE','LU','ES','PT','IT','AT','DK','SE',
  'FI','PL','CZ','SK','HU','RO','BG','GR','HR','SI','EE','LV','LT','MT','CY']);

export const ZONES = [
  ['GB',    'United Kingdom only'],
  ['EU',    'UK + Europe'],
  ['WORLD', 'Anywhere'],
];

export const countryName = (code) =>
  (COUNTRIES.find(([c]) => c === code) || [null, code])[1];

/* Does this option reach that country?  `zone` is one of the presets above or
   a comma-separated ISO-2 list for anything hand-picked. */
export function reaches(zone, country) {
  const z = String(zone || 'GB').trim().toUpperCase();
  const cc = String(country || 'GB').trim().toUpperCase();
  if (z === 'WORLD') return true;
  if (z === 'GB') return cc === 'GB';
  if (z === 'EU') return cc === 'GB' || EU.has(cc);
  return z.split(',').map((x) => x.trim()).filter(Boolean).includes(cc);
}

export const forCountry = (options, country) =>
  options.filter((o) => o.enabled && reaches(o.zone, country));

/* "Two to three working days" from the numbers, so the shop owner types a
   couple of digits instead of writing the same sentence four times. */
export function leadTime(min, max) {
  const a = Number(min) || 0, b = Number(max) || 0;
  if (!a && !b) return '';
  if (!a || a === b) return `${b || a} working day${(b || a) === 1 ? '' : 's'}`;
  if (!b) return `From ${a} working days`;
  return `${a} to ${b} working days`;
}

/* Free delivery over a threshold, decided server-side like every other price. */
export const priceFor = (opt, subtotal_p) =>
  (opt.free_over_p > 0 && subtotal_p >= opt.free_over_p) ? 0 : opt.price_p;
