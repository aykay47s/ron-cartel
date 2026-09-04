/* UK banks, for the "who is this money going to" line on the payment page.
 *
 * Seeing "Starling" against the account number does more for trust than any
 * amount of reassuring copy — it tells the buyer the details are real and
 * gives them something to check against when the transfer screen in their own
 * app asks them to confirm the payee.
 *
 * The marks are drawn here rather than fetched. Bank logos are trademarks,
 * hotlinking them breaks the moment the bank reorganises its CDN, and a
 * two-letter monogram in the bank's own colour reads just as clearly.
 */
export const BANKS = {
  '':           { name: '',                 short: '',   colour: '#6E6963' },
  starling:     { name: 'Starling Bank',    short: 'S',  colour: '#6935D3' },
  monzo:        { name: 'Monzo',            short: 'M',  colour: '#FF4F40' },
  revolut:      { name: 'Revolut',          short: 'R',  colour: '#0666EB' },
  tide:         { name: 'Tide',             short: 'T',  colour: '#00B0A6' },
  mettle:       { name: 'Mettle',           short: 'Me', colour: '#2E1A47' },
  barclays:     { name: 'Barclays',         short: 'B',  colour: '#00AEEF' },
  hsbc:         { name: 'HSBC',             short: 'H',  colour: '#DB0011' },
  lloyds:       { name: 'Lloyds',           short: 'L',  colour: '#006A4D' },
  natwest:      { name: 'NatWest',          short: 'N',  colour: '#5A287F' },
  santander:    { name: 'Santander',        short: 'Sa', colour: '#EC0000' },
  halifax:      { name: 'Halifax',          short: 'Hx', colour: '#005EB8' },
  nationwide:   { name: 'Nationwide',       short: 'Nw', colour: '#00234B' },
  tsb:          { name: 'TSB',              short: 'Ts', colour: '#2D3092' },
  cooperative:  { name: 'The Co-operative', short: 'Co', colour: '#00B1E7' },
  metro:        { name: 'Metro Bank',       short: 'Mb', colour: '#E4003B' },
  chase:        { name: 'Chase',            short: 'C',  colour: '#117ACA' },
  wise:         { name: 'Wise',             short: 'W',  colour: '#9FE870' },
  other:        { name: 'Other',            short: '•',  colour: '#6E6963' },
};

/* A monogram tile in the bank's colour. Inline so it costs no request and
   cannot break, and it degrades to a grey tile for a bank we do not list. */
export function bankMark(key, size = 30) {
  const b = BANKS[key] || BANKS.other;
  if (!b.short) return '';
  const font = size <= 22 ? 10 : 12.5;
  return `<span class="bankmark" style="width:${size}px;height:${size}px;` +
         `background:${b.colour};font-size:${font}px" aria-hidden="true">${b.short}</span>`;
}

export const bankName = (key) => (BANKS[key] || BANKS['']).name;
