// Project codes and report file names. These must match the old app exactly: Central Hub and the
// Apps Script find a report by its file name, e.g. 2026-10-20_ETH_MJO_CHB_100.pdf.

import { pad } from './util.js';

const clean = x => String(x || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** Country code, project code and short name of a project (the old app's pcodes()). */
export function codesOf(p) {
  const n = p.name || '';
  const k = /mosestro|\bmos\b/i.test(n) ? ['ISR', 'MOS'] : /bags|sacks|katanga|b&s/i.test(n) ? ['DRC', 'BAG'] : /chb|mojo|modjo/i.test(n) ? ['ETH', 'MJO', 'CHB'] : null;
  const code = clean(p.code || p.pcode).slice(0, 6) || (k ? k[1] : (n.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'PRJ'));
  return {
    cc: clean(p.cc).slice(0, 3) || (k ? k[0] : 'UNK'),
    code,
    pn: clean(p.pn || p.pname).slice(0, 6) || (k && k[2] && code === k[1] ? k[2] : ''),
  };
}

/** "2026-10-20_ETH_MJO_CHB_100.pdf" */
export function pdfName(p, date, no) {
  const c = codesOf(p);
  return `${date}_${c.cc}_${c.code}_${c.pn ? c.pn + '_' : ''}${pad(no)}.pdf`;
}
