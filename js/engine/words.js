// Amounts in words for invoices and quotations (v0.22.2): "Two million three hundred thousand birr and fifty cents only".
// English, short scale. Pure.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];

/** The names of a currency's whole and hundredth units; others use the code ("1,000 KES" reads "one thousand KES"). */
export const UNITS = {
  ETB: ['birr', 'birr', 'cent', 'cents'], USD: ['US dollar', 'US dollars', 'cent', 'cents'], EUR: ['euro', 'euros', 'cent', 'cents'],
  GBP: ['pound', 'pounds', 'penny', 'pence'], CNY: ['yuan', 'yuan', 'fen', 'fen'], AED: ['dirham', 'dirhams', 'fils', 'fils'],
};

function below1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : '');
  if (!h) return rest;
  return `${ONES[h]} hundred${r ? ` and ${rest}` : ''}`;
}

/** A whole number in words: 2312730 → "two million three hundred and twelve thousand seven hundred and thirty". */
export function numberWords(n) {
  n = Math.floor(Math.abs(+n || 0));
  if (n === 0) return 'zero';
  const parts = [];
  for (const [size, name] of SCALES) {
    if (n >= size) { parts.push(`${numberWords(Math.floor(n / size))} ${name}`); n %= size; }
  }
  if (n) parts.push(parts.length && n < 100 ? `and ${below1000(n)}` : below1000(n));
  return parts.join(' ');
}

/** An amount in words with its currency, rounded to cents: "Five thousand birr and fifty cents only". */
export function amountWords(value, currency = '') {
  const v = Math.round(Math.abs(+value || 0) * 100);
  const whole = Math.floor(v / 100), cents = v % 100;
  const [one, many, c1, cn] = UNITS[currency] || [currency, currency, 'cent', 'cents'];
  const text = `${numberWords(whole)} ${whole === 1 ? one : many}`.trim()
    + (cents ? ` and ${numberWords(cents)} ${cents === 1 ? c1 : cn}` : '') + ' only';
  return (+value < 0 ? 'minus ' : '') + text.charAt(0).toUpperCase() + text.slice(1);
}
