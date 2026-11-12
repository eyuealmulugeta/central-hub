// v1.58.0 (owner R8): the weekly, monthly and custom-range client report as a PDF in layout A, the daily report's
// layout (R7): page 1 the data (boxes, information, the progress chart with the bars on the right, side-by-side
// boxes, every other row shaded, filled to the footer), the photos from page 2, 3 x 4 filling the page.
// Pure: it takes jsPDF and the saved report (doc.data is reportSnapshot's frozen copy); js/ui/periodpdf.js feeds it.

import { fromDay } from '../core/util.js';

const W = 595.28, H = 841.89, M = 36, CW = W - 2 * M, FOOT = 30;
const BRAND = [6, 43, 53], SOFT = [236, 242, 243], LINE = [221, 227, 230], GOLD = [201, 154, 46];
const INK = [27, 36, 48], MUTED = [110, 122, 128], WHITE = [255, 255, 255], RED = [180, 35, 24], RED_SOFT = [253, 236, 234];
const STRIPE = [242, 246, 247], TRACK = [222, 231, 234], OK = [31, 122, 74], OK_SOFT = [227, 243, 234];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const TITLES = { weekly: 'Weekly Progress Report', monthly: 'Monthly Progress Report', custom: 'Progress Report', daily: 'Progress Report' };
// the schedule keeps its dates as day numbers, the reports as 'YYYY-MM-DD'
const iso = v => (typeof v === 'number' && Number.isFinite(v) ? fromDay(v) : typeof v === 'string' ? v : '');
const dm = v => { const s = iso(v); return s ? `${+s.slice(8, 10)} ${MON[+s.slice(5, 7) - 1]}` : ''; };
const dmy = v => { const s = iso(v); return s ? `${dm(s)} ${s.slice(0, 4)}` : ''; };
/** "9 – 15 Nov 2026", "1 – 30 Nov 2026", "28 Oct – 3 Nov 2026" */
export function rangeLabel(from, to) {
  if (!from || !to) return '';
  if (from.slice(0, 7) === to.slice(0, 7)) return `${+from.slice(8, 10)} – ${dm(to)} ${to.slice(0, 4)}`;
  return from.slice(0, 4) === to.slice(0, 4) ? `${dm(from)} – ${dm(to)} ${to.slice(0, 4)}` : `${dm(from)} ${from.slice(0, 4)} – ${dm(to)} ${to.slice(0, 4)}`;
}

/** The chart rows: the saved chart, or (reports saved before v1.58.0) each task's progress as it stood. */
export const chartRows = data => (data.chart && data.chart.length ? data.chart
  : (data.rows || []).filter(r => !r.milestone && r.name).map(r => ({ name: r.name, unit: '%', total: 100, before: Math.round(r.progress || 0), now: 0 })));

/**
 * d: { kind, number, from, to, data, remarks, project: { name, client, location }, preparedBy, approvedBy, approvedAt,
 * logo, photos: [{ data, w, h, cap }] }. Returns the jsPDF document; doc.photoPages = the pages of photos.
 */
export function buildPeriodPdf(JsPDF, d) {
  const data = d.data || {};
  const doc = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
  const pad = Number(d.pad) || 0;
  let y = M, gaps = 0;
  const color = (c, kind = 'text') => (kind === 'text' ? doc.setTextColor(...c) : kind === 'fill' ? doc.setFillColor(...c) : doc.setDrawColor(...c));
  const font = (size, style = 'normal', c = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); color(c); };
  const bottom = H - FOOT - 14;
  const newPage = () => { doc.addPage(); y = M; };
  const room = h => { if (y + h > bottom) newPage(); };
  const lines = (t, w) => doc.splitTextToSize(String(t ?? ''), w);
  const stripe = (x, top, w, h) => { color(STRIPE, 'fill'); doc.rect(x, top, w, h, 'F'); };
  const heading = (title, x = M, width = CW) => {
    font(9.5, 'bold', BRAND); doc.text(title.toUpperCase(), x, y);
    color(BRAND, 'draw'); doc.setLineWidth(0.8); doc.line(x, y + 4, x + width, y + 4);
  };
  const section = title => { room(48); y += 12 + pad; gaps++; heading(title); y += 18; };
  const title = TITLES[d.kind] || TITLES.custom;
  const p = d.project || {};

  /* header */
  let logo = false;
  if (d.logo) { try { doc.addImage(d.logo, 'PNG', M, y - 2, 42, 42); logo = true; } catch { /* the tile below */ } }
  if (!logo) { color(BRAND, 'fill'); doc.roundedRect(M, y - 2, 42, 42, 7, 7, 'F'); font(13, 'bold', GOLD); doc.text('AP', M + 21, y + 24, { align: 'center' }); }
  font(17, 'bold', BRAND); doc.text(title, M + 52, y + 16);
  font(9, 'normal', MUTED); doc.text('Amistad Prefab', M + 52, y + 31);
  font(15, 'bold', BRAND); doc.text(rangeLabel(d.from, d.to), M + CW, y + 14, { align: 'right' });
  font(9.5, 'normal', MUTED); doc.text(d.number || '', M + CW, y + 29, { align: 'right' });
  color(BRAND, 'draw'); doc.setLineWidth(1.2); doc.line(M, y + 44, M + CW, y + 44);
  y += 56;

  /* the boxes */
  const manDays = (data.manpower || []).reduce((s, m) => s + (+m.days || 0), 0);
  const delayDays = (data.delays || []).reduce((s, x) => s + (+x.delayDays || 0), 0);
  const prog = Math.round(+data.progress || 0), plan = Math.round(+data.plannedProgress || 0);
  const boxes = [
    { t: 'Progress', v: `${prog}%`, l: `Plan ${plan}%`, red: prog + 5 < plan },
    { t: 'Report days', v: String(data.reportDays || 0), l: 'Approved daily reports' },
    { t: 'Man-days', v: String(manDays), l: 'Crew on site' },
    { t: 'Delays', v: delayDays ? `${delayDays} d` : '0', l: delayDays ? 'Lost to delays' : 'None', red: delayDays > 0 },
  ];
  const bw = CW / boxes.length, bh = 42;
  boxes.forEach((b, i) => {
    const w = bw * 0.74, x = M + i * bw + (bw - w) / 2, mid = x + w / 2, c = b.red ? RED : BRAND;
    color(b.red ? RED_SOFT : SOFT, 'fill'); color(c, 'draw'); doc.setLineWidth(b.red ? 1.1 : 0.7);
    doc.roundedRect(x, y, w, bh, 5, 5, 'FD');
    font(6.8, 'bold', c); doc.text(b.t.toUpperCase(), mid, y + 10, { align: 'center' });
    font(13, 'bold', c); doc.text(b.v, mid, y + 26, { align: 'center' });
    font(6.3, 'normal', b.red ? RED : MUTED); doc.text(b.l, mid, y + bh - 6, { align: 'center' });
  });
  y += bh + 10;

  /* information, two columns, every other row shaded */
  const slip = Math.round(+data.slip || 0);
  const info = [
    ['Project', p.name], ['Client', p.client], ['Location', p.location], ['Period', rangeLabel(d.from, d.to)],
    ['Weather', (data.weather || []).join(', ')], ['Planned finish', dmy(data.planEnd)],
    ['Forecast finish', dmy(data.end)], ['Against plan', slip > 0 ? `${slip} days behind` : slip < 0 ? `${-slip} days ahead` : 'On plan'],
  ];
  section('Information');
  const half = (CW - 16) / 2, rows = Math.ceil(info.length / 2), top = y;
  info.forEach(([k, v], n) => {
    const col = n < rows ? 0 : 1, row = n % rows, x = M + col * (half + 16), yy = top + row * 14;
    if (row % 2) stripe(x - 3, yy - 9, half + 3, 14);
    font(6.8, 'bold', MUTED); doc.text(k.toUpperCase(), x, yy);
    font(9, 'normal'); doc.text(lines(v || ' ', half - 80)[0] || ' ', x + 78, yy);
  });
  y = top + rows * 14 + 2;

  /* the progress chart: name, figures, then the bar on the right */
  const chart = chartRows(data);
  if (chart.length) {
    const overall = Math.round(chart.reduce((s, r) => s + Math.min(100, (r.before + r.now) / (r.total || 100) * 100), 0) / chart.length);
    section(`Progress over the period · ${overall}% overall`);
    const nx = M, fx = M + 150 + 118, bx = fx + 12, bwid = M + CW - bx;
    chart.forEach((r, i) => {
      room(14);
      if (i % 2) stripe(M - 3, y - 9, CW + 3, 13);
      const tot = r.total || 100, b = Math.min(1, r.before / tot), n = Math.min(1 - b, r.now / tot);
      font(8.5, 'bold'); doc.text(lines(r.name, 146)[0] || '', nx, y);
      font(8.5, 'normal', MUTED); doc.text(`${Math.round((b + n) * 100)}%${r.now ? ` (+${Math.round(n * 100)})` : ''}`, fx, y, { align: 'right' });
      color(TRACK, 'fill'); doc.rect(bx, y - 7, bwid, 8, 'F');
      if (b) { color(BRAND, 'fill'); doc.rect(bx, y - 7, bwid * b, 8, 'F'); }
      if (n) { color(GOLD, 'fill'); doc.rect(bx + bwid * b, y - 7, bwid * n, 8, 'F'); }
      y += 13;
    });
    font(6.5, 'normal', MUTED);
    [[BRAND, 'Before the period'], [GOLD, 'This period'], [TRACK, 'Still to do']].forEach(([c, t], i) => {
      const x = M + i * 80; color(c, 'fill'); doc.rect(x, y - 5, 8, 5, 'F'); font(6.5, 'normal', MUTED); doc.text(t, x + 11, y - 0.5);
    });
    [0, 25, 50, 75, 100].forEach(v => doc.text(`${v}%`, bx + bwid * v / 100, y - 0.5, { align: v ? (v === 100 ? 'right' : 'center') : 'left' }));
    y += 6;
  }

  /* two boxes side by side: a list, or a short "nothing to report" box */
  const block = (x, w, head, items, fill, red) => {
    let yy = y;
    font(9.5, 'bold', red && items.length ? RED : BRAND); doc.text(head.toUpperCase(), x, yy);
    color(red && items.length ? RED : BRAND, 'draw'); doc.setLineWidth(0.8); doc.line(x, yy + 4, x + w, yy + 4);
    yy += 17;
    if (!items.length) {
      color(OK_SOFT, 'fill'); doc.roundedRect(x, yy - 9, w, 30, 4, 4, 'F');
      font(6.5, 'bold', OK); doc.text('OK', x + 7, yy + 9);
      font(8.5, 'bold', OK); doc.text(fill[0], x + 24, yy + 2);
      font(7.5, 'normal', MUTED); doc.text(lines(fill[1], w - 30)[0] || '', x + 24, yy + 13);
      return yy + 26;
    }
    items.forEach((t, i) => {
      font(8.5); const ls = lines(t, w - 6);
      if (i % 2) stripe(x - 3, yy - 8.5, w + 3, ls.length * 11);
      ls.forEach(l => { doc.text(l, x, yy); yy += 11; });
    });
    return yy;
  };
  const duo = (A, B) => {
    const w = (CW - 16) / 2;
    const tall = Math.max(A[1].length, B[1].length, 2) * 12 + 30;
    room(Math.min(tall, bottom - M)); y += 12 + pad; gaps++;
    const end = Math.max(block(M, w, ...A), block(M + w + 16, w, ...B));
    y = end;
  };
  const safety = (data.safety || []).filter(s => s.status || (s.notes || []).length)
    .map(s => [dm(s.date), s.status, s.toolbox ? 'toolbox talk held' : '', ...(s.notes || [])].filter(Boolean).join(' · '));
  const delays = (data.delays || []).map(x => [dm(x.date), x.task, `${x.delayDays} d`, x.note].filter(Boolean).join(' · '));
  duo(['Safety', safety, ['No incident reported', 'No accident or near miss in this period.'], true],
    [`Delays${delayDays ? ` · ${delayDays} d` : ''}`, delays, ['No delays', 'The work went on as planned.'], true]);
  const recv = (data.received || []).map(x => [dm(x.date), x.name, [x.qty, x.unit].filter(Boolean).join(' ')].filter(Boolean).join(' · '));
  const issues = (data.issues || []).map(x => [x.title, x.due ? `due ${dm(x.due)}` : ''].filter(Boolean).join(' · '));
  duo(['Materials received', recv, ['Nothing delivered', 'No materials arrived on site in this period.']],
    ['Open issues', issues, ['No open issues', 'Nothing is waiting for a decision.']]);

  /* tables: manpower beside equipment */
  const table = (x, w, cols, rowsIn, foot) => {
    let yy = y;
    const ws = cols.map(c => c[1] * w);
    color(BRAND, 'fill'); doc.rect(x, yy - 10, w, 15, 'F'); font(7.5, 'bold', WHITE);
    let cx = x; cols.forEach((c, i) => { doc.text(c[0].toUpperCase(), c[2] ? cx + ws[i] - 5 : cx + 5, yy, { align: c[2] ? 'right' : 'left' }); cx += ws[i]; });
    yy += 15;
    [...rowsIn, ...(foot ? [foot] : [])].forEach((row, ri, all) => {
      const last = foot && ri === all.length - 1;
      if (last) { color(SOFT, 'fill'); doc.rect(x, yy - 10, w, 14, 'F'); } else if (ri % 2) stripe(x, yy - 10, w, 14);
      font(8.5, last ? 'bold' : 'normal');
      let c2 = x; row.forEach((v, i) => { doc.text(lines(String(v), ws[i] - 8)[0] || '', cols[i][2] ? c2 + ws[i] - 5 : c2 + 5, yy, { align: cols[i][2] ? 'right' : 'left' }); c2 += ws[i]; });
      yy += 14;
    });
    return yy;
  };
  const man = (data.manpower || []).map(m => [m.trade, m.days, m.ot || 0]);
  const eqMap = new Map();
  for (const e of data.equipment || []) { const k = e.name; const v = eqMap.get(k) || { days: new Set(), status: '' }; v.days.add(e.date); v.status = e.status || v.status; eqMap.set(k, v); }
  const eq = [...eqMap].map(([n, v]) => [n, v.days.size, v.status]);
  if (man.length || eq.length) {
    const w = (CW - 16) / 2, tall = Math.max(man.length + 1, eq.length) * 14 + 40;
    room(Math.min(tall, bottom - M)); y += 12 + pad; gaps++;
    heading('Manpower', M, w); heading('Equipment', M + w + 16, w); y += 18;
    const a = man.length ? table(M, w, [['Trade', 0.5], ['Man-days', 0.25, 1], ['OT h', 0.25, 1]], man, ['Total', manDays, man.reduce((s, m) => s + (+m[2] || 0), 0)]) : y;
    const b = eq.length ? table(M + w + 16, w, [['Equipment', 0.5], ['Days', 0.2, 1], ['Status', 0.3, 1]], eq) : y;
    y = Math.max(a, b);
  }

  /* what the site wrote, and the next tasks */
  const work = (data.summary || []).map(s => `${dm(s.date)} · ${s.text}`);
  const ahead = (data.lookahead || []).slice(0, 10).map(r => `${r.name} · ${Math.round(r.progress || 0)}%${r.ef ? ` · finish ${dm(r.ef)}` : ''}`);
  if (work.length || ahead.length) {
    const w = (CW - 16) / 2;
    room(60); y += 12 + pad; gaps++;
    const end = Math.max(block(M, w, 'Work this period', work.slice(0, 14), ['Nothing written', 'The daily reports carry the details.']),
      block(M + w + 16, w, 'Coming next', ahead, ['Nothing planned', 'All tasks are done.']));
    y = end;
  }
  if (d.remarks) {
    section('Remarks');
    font(9); for (const l of lines(d.remarks, CW)) { room(12); doc.text(l, M, y); y += 12; }
  }

  /* sign-off, at the right */
  room(64); y += 16 + pad; gaps++;
  const ow = (CW - 16) / 3, ox = M + CW - ow;
  const sign = (x, label, name, note) => {
    font(7.5, 'bold', MUTED); doc.text(label, x, y);
    font(10, 'bold'); doc.text(name || ' ', x, y + 15);
    color(LINE, 'draw'); doc.setLineWidth(0.7); doc.line(x, y + 36, x + ow, y + 36);
    if (note) { font(7, 'normal', MUTED); doc.text(note, x + ow, y + 45, { align: 'right' }); }
  };
  sign(ox - ow - 16, 'PREPARED BY:', d.preparedBy || '', '');
  sign(ox, 'APPROVED BY:', d.approvedBy || '', d.approvedAt ? dm(d.approvedAt) : '');
  y += 50;

  if (!d.pad && doc.getNumberOfPages() === 1 && gaps && bottom - y > 16) return buildPeriodPdf(JsPDF, { ...d, pad: Math.min(30, (bottom - y - 6) / gaps) });

  /* the photos, from page 2: 3 x 4 filling the page */
  const photos = d.photos || [];
  const COLS = 3, ROWS = 4, per = COLS * ROWS, gap = 8, capH = 12;
  for (let i = 0; i < photos.length; i += per) {
    newPage(); heading('Photos'); y += 14;
    const cw = (CW - gap * (COLS - 1)) / COLS, ch = (bottom - y - gap * (ROWS - 1)) / ROWS;
    photos.slice(i, i + per).forEach((ph, k) => {
      const x = M + (k % COLS) * (cw + gap), top = y + Math.floor(k / COLS) * (ch + gap), ih = ch - capH;
      const s = Math.min(cw / (ph.w || 4), ih / (ph.h || 3)), w = (ph.w || 4) * s, h = (ph.h || 3) * s;
      try { doc.addImage(ph.data, 'JPEG', x + (cw - w) / 2, top + (ih - h) / 2, w, h); } catch { color(SOFT, 'fill'); doc.rect(x, top, cw, ih, 'F'); }
      font(7, 'normal', MUTED); doc.text(lines(ph.cap || '', cw)[0] || '', x, top + ch - 3);
    });
  }
  doc.photoPages = Math.ceil(photos.length / per);

  /* footer on every page */
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    color(LINE, 'draw'); doc.setLineWidth(0.5); doc.line(M, H - 32, M + CW, H - 32);
    font(7, 'normal', MUTED);
    doc.text(`Amistad Prefab · ${title} · ${p.name || ''}`, M, H - 22);
    doc.text(`Page ${i} of ${n}`, M + CW, H - 22, { align: 'right' });
  }
  return doc;
}
