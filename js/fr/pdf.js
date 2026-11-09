// The report PDF, drawn with jsPDF (the same library and address the old app uses). A4 portrait.
// 2.11.0 (release 2): the logo and its dark blue; four boxes (Manpower, Equipment, Near miss, Incident), red when
// reported; Information, Today's Progress and Tomorrow's Plan side by side; delays, materials and requests; manpower
// (by tier) beside equipment (active, idle, down); weather as a picture (img/weather); Safety (2/3) beside the simple sign-off (1/3);
// then the photos straight after, 3 in a row, like Central Hub's report. Empty sections are left out (model/pdfplan.js).
// The client copy (d.client) has no photo times and no time under the signatures. buildPdf takes the jsPDF class,
// so the layout also runs in node for checking.

import { dayLabel } from './core/util.js';
import { totals } from './model/crew.js';
import { byZone, requestReady, planReady, planLine } from './model/end.js';
import { weatherTerm } from './model/report.js';
import { topBoxes, manpowerRows, equipmentRows, sectionsOf } from './model/pdfplan.js';

export const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

/** Loads jsPDF once; fails when there is no connection and it was never loaded. */
export function loadPdfLib() {
  if (globalThis.jspdf) return Promise.resolve(globalThis.jspdf.jsPDF);
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = JSPDF_URL;
    s.onload = () => (globalThis.jspdf ? ok(globalThis.jspdf.jsPDF) : fail(new Error('PDF library missing')));
    s.onerror = () => { s.remove(); fail(new Error('No connection to make the PDF')); };
    document.head.appendChild(s);
  });
}

// 2.11.0: colour themes (brand for headings, table heads and box outlines; soft for fills; line for rules).
// 'logo' is the logo's dark blue (icon-192.png); the other three are the options shown to the owner.
export const THEMES = {
  logo: { name: 'Logo blue', brand: [6, 43, 53], soft: [236, 242, 243], line: [221, 227, 230], accent: [201, 154, 46] },
  slate: { name: 'Slate teal', brand: [47, 93, 107], soft: [234, 243, 245], line: [210, 225, 229], accent: [127, 176, 186] },
  navy: { name: 'Navy and sand', brand: [27, 42, 78], soft: [247, 242, 232], line: [229, 221, 205], accent: [183, 148, 92] },
  sage: { name: 'Sage and stone', brand: [55, 88, 74], soft: [237, 242, 236], line: [218, 226, 216], accent: [168, 151, 112] },
};
export const THEME = 'slate';
export const BRAND = THEMES.logo.brand;
const INK = [27, 36, 48], MUTED = [110, 122, 128], WHITE = [255, 255, 255];
const RED = [180, 35, 24], RED_SOFT = [253, 236, 234], GOLD = [201, 154, 46];
const W = 595.28, H = 841.89, M = 36, CW = W - 2 * M;
const FOOT = 30;   // the footer's height above the page edge

/**
 * d: { r, project, profile, file, logo, weather, photos: [{ data, w, h, cap, at }], sig, signedAt, client, theme }.
 * Returns the jsPDF document (doc.output('blob') in the browser, doc.output('arraybuffer') in node);
 * doc.photoFit = { now, next }: the photos still needed to fill the last photo page, and that page and one more.
 */
export function buildPdf(JsPDF, d) {
  const { r, project, profile } = d;
  const doc = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
  const { brand: BRAND, soft: SOFT, line: LINE } = THEMES[d.theme] || THEMES[THEME];
  let y = M;
  const color = (c, kind = 'text') => (kind === 'text' ? doc.setTextColor(...c) : kind === 'fill' ? doc.setFillColor(...c) : doc.setDrawColor(...c));
  const font = (size, style = 'normal', c = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); color(c); };
  const newPage = () => { doc.addPage(); y = M; };
  const bottom = H - FOOT - 14;   // 2.11.0: the footer sits lower
  const room = h => { if (y + h > bottom) newPage(); };
  const lines = (text, width) => doc.splitTextToSize(String(text ?? ''), width);

  const heading = (title, x = M, width = CW) => {
    font(9.5, 'bold', BRAND);
    doc.text(title.toUpperCase(), x, y);
    color(BRAND, 'draw'); doc.setLineWidth(0.8); doc.line(x, y + 4, x + width, y + 4);
  };
  const section = title => { room(48); y += 12; heading(title); y += 18; };
  const para = (text, { size = 9.5, indent = 0, c = INK, style = 'normal', gap = 3 } = {}) => {
    font(size, style, c);
    for (const ln of lines(text, CW - indent)) { room(size + 2); doc.text(ln, M + indent, y); y += size + 2.5; }
    y += gap;
  };

  /**
   * A table with a header row; widths in fractions of the width. Numbers are right-aligned (a: 'right'),
   * text is centred unless a column says 'left'. Rows break across pages.
   */
  const table = (cols, rows, { x = M, width = CW, foot } = {}) => {
    const ws = cols.map(c => c.w * width);
    const at = (i, cx) => (cols[i].a === 'right' ? cx + ws[i] - 5 : cols[i].a === 'left' ? cx + 5 : cx + ws[i] / 2);
    const opt = i => ({ align: cols[i].a === 'right' ? 'right' : cols[i].a === 'left' ? 'left' : 'center' });
    const head = () => {
      color(BRAND, 'fill'); doc.rect(x, y - 10, width, 15, 'F');
      font(7.5, 'bold', WHITE);
      let cx = x; cols.forEach((c, i) => { doc.text(c.t.toUpperCase(), cx + ws[i] / 2, y, { align: 'center' }); cx += ws[i]; });
      y += 15;
    };
    room(32); head();
    const all = foot ? [...rows, foot] : rows;
    all.forEach((row, ri) => {
      const last = foot && ri === all.length - 1;
      font(9, last ? 'bold' : 'normal');
      const cells = row.map((v, i) => lines(v, ws[i] - 10));
      const h = Math.max(...cells.map(c => c.length)) * 11.5 + 5;
      if (y + h > bottom) { newPage(); y += 10; head(); }
      if (last) { color(SOFT, 'fill'); doc.rect(x, y - 10, width, h, 'F'); }
      let cx = x;
      cells.forEach((c, i) => { font(9, last || cols[i].b ? 'bold' : 'normal', cols[i].c || INK); doc.text(c, at(i, cx), y + 1, opt(i)); cx += ws[i]; });
      y += h;
      color(LINE, 'draw'); doc.setLineWidth(0.5); doc.line(x, y - 9, x + width, y - 9);
    });
    y += 4;
  };

  /* header: the logo, "Daily Field Report"; the date large on the right, the report number under it */
  let logo = false;
  if (d.logo) { try { doc.addImage(d.logo, 'PNG', M, y - 2, 42, 42); logo = true; } catch { /* drawn tile below */ } }
  if (!logo) { color(BRAND, 'fill'); doc.roundedRect(M, y - 2, 42, 42, 7, 7, 'F'); font(13, 'bold', GOLD); doc.text('AP', M + 21, y + 24, { align: 'center' }); }
  font(17, 'bold', BRAND); doc.text('Daily Field Report', M + 52, y + 16);
  font(9, 'normal', MUTED); doc.text('Amistad Prefab', M + 52, y + 31);
  font(15, 'bold', BRAND); doc.text(`${dayLabel(r.date)} ${r.date.slice(0, 4)}`, M + CW, y + 14, { align: 'right' });
  font(9.5, 'normal', MUTED); doc.text(`Report #${r.no}`, M + CW, y + 29, { align: 'right' });
  color(BRAND, 'draw'); doc.setLineWidth(1.2); doc.line(M, y + 44, M + CW, y + 44);
  y += 56;

  /* the boxes: title on top, figure in the middle, label at the bottom */
  const boxes = topBoxes(r), bw = CW / boxes.length, bh = 42;
  boxes.forEach((b, i) => {
    const w = bw * 0.74, x = M + i * bw + (bw - w) / 2, mid = x + w / 2;
    color(b.red ? RED_SOFT : SOFT, 'fill'); color(b.red ? RED : BRAND, 'draw'); doc.setLineWidth(b.red ? 1.1 : 0.7);
    doc.roundedRect(x, y, w, bh, 5, 5, 'FD');
    const c = b.red ? RED : BRAND;
    font(6.8, 'bold', c); doc.text(b.title.toUpperCase(), mid, y + 10, { align: 'center' });
    font(13, 'bold', c); doc.text(b.value, mid, y + 26, { align: 'center' });
    font(6.3, 'normal', b.red ? RED : MUTED); doc.text(lines(b.label, w - 6)[0] || '', mid, y + bh - 6, { align: 'center' });
  });
  y += bh + 10;

  /* Attention: what the client must read, in a red box */
  const att = (r.attention || []).map(x => String(x.text || '').trim()).filter(Boolean);
  if (att.length) {
    font(9.5, 'normal');
    const body = att.flatMap(t => lines(`• ${t}`, CW - 20)), h = 24 + body.length * 12;
    room(h + 8);
    color(RED_SOFT, 'fill'); color(RED, 'draw'); doc.setLineWidth(1.2); doc.roundedRect(M, y, CW, h, 5, 5, 'FD');
    font(9.5, 'bold', RED); doc.text('ATTENTION', M + 10, y + 15);
    font(9.5, 'normal', [120, 20, 14]); body.forEach((ln, i) => doc.text(ln, M + 10, y + 28 + i * 12));
    y += h + 10;
  }

  /* Information beside Today's Progress and Tomorrow's Plan */
  const st = r.start || {};
  const progress = byZone(r.items || []);
  const plan = (r.plan || []).filter(planReady);
  const requests = (r.requests || []).filter(requestReady);
  const show = sectionsOf(r, { progress, plan, requests });
  const cond = weatherTerm(st.cond) || st.cond || '';
  const info = [
    ['Project', project.name || ''], ['Client', project.client || ''],
    ['Location', st.location || ''], ['Working hours', st.start && st.end ? `${st.start} - ${st.end}` : ''],
    ['Weather', [cond, st.tempC !== '' && st.tempC != null ? `${st.tempC} °C` : '', st.wind].filter(Boolean).join(', '), cond],
    ['Ground', st.ground || ''],
  ];
  const cols = [{ title: 'Information', w: 0.32 }, ...(show.progress ? [{ title: "Today's Progress", w: 0 }] : []), ...(show.plan ? [{ title: "Tomorrow's Plan", w: 0 }] : [])];
  const rest = cols.length > 1 ? (1 - cols[0].w - 0.04 * (cols.length - 1)) / (cols.length - 1) : 0;
  cols.forEach((c, i) => { if (i) c.w = rest; });
  if (cols.length === 1) cols[0].w = 1;
  // the lines of each column first, so the three are drawn side by side only when they fit on this page
  font(8.5, 'normal');
  const progLines = progress.flatMap(z => [{ t: z.zone, b: true }, ...z.lines.flatMap(ln => lines(`• ${ln}`, CW * rest - 6).map(t => ({ t })))]);
  const planLines = plan.flatMap(x => lines(`• ${planLine(x)}`, CW * rest - 6).map(t => ({ t })));
  const colLines = [null, ...(show.progress ? [progLines] : []), ...(show.plan ? [planLines] : [])];
  // 2.89.0 (QA D3): a long project name or location wraps to up to 3 lines instead of being cut
  font(8.8, 'normal');
  const infoLines = info.map(([, v, pic]) => lines(v || ' ', CW * cols[0].w - 66 - (pic ? 18 : 0)).slice(0, 3));
  const infoH = infoLines.reduce((h, l) => h + 14 + (l.length - 1) * 10.5, 0), tallest = Math.max(infoH, ...colLines.slice(1).map(l => l.length * 11));
  room(Math.min(tallest + 30, bottom - M));
  y += 12;
  const top = y;
  let cx = M, end = y;
  cols.forEach((c, i) => {
    const w = CW * c.w;
    y = top; heading(c.title, cx, w); y += 18;
    if (i === 0) {
      info.forEach(([k, v, pic], n) => {
        font(6.8, 'bold', MUTED); doc.text(k.toUpperCase(), cx, y);
        font(8.8, 'normal'); infoLines[n].forEach((t, j) => doc.text(t, cx + 64, y + j * 10.5));
        if (pic && v && d.weather) { try { doc.addImage(d.weather, 'PNG', cx + w - 16, y - 11, 15, 15); } catch { /* no picture */ } }
        y += 14 + (infoLines[n].length - 1) * 10.5;
      });
    } else {
      for (const ln of colLines[i]) {
        if (y + 11 > bottom) { end = Math.max(end, y); newPage(); y += 6; }
        font(8.5, ln.b ? 'bold' : 'normal', ln.b ? BRAND : INK); doc.text(ln.t, cx, y); y += 11;
      }
    }
    end = Math.max(end, y);
    cx += w + CW * 0.04;
  });
  // thin light lines between the columns
  color(LINE, 'draw'); doc.setLineWidth(0.5);
  for (let i = 1, x = M; i < cols.length; i++) { x += CW * cols[i - 1].w + CW * 0.02; doc.line(x, top - 10, x, Math.min(end, bottom) - 4); x += CW * 0.02; }
  y = end + 4;

  /** Two tables side by side (each half the width), or one across when the other is empty: { title, cols, rows, opts }. */
  const pair = (A, B) => {
    const list = [A, B].filter(Boolean);
    if (!list.length) return;
    const both = list.length === 2, half = (CW - 16) / 2, w = both ? half : CW;
    room(Math.min(60 + 16 * Math.max(...list.map(t => t.rows.length + (t.opts?.foot ? 1 : 0))), bottom - M));
    y += 12;
    const top = y + 18, page = doc.getNumberOfPages();
    heading(list[0].title, M, w); y = top;
    table(list[0].cols, list[0].rows, { ...list[0].opts, width: w });
    const endA = y, pageA = doc.getNumberOfPages();
    if (!both) return;
    if (pageA !== page) doc.setPage(page);   // the left table ran onto a new page: the right one still starts beside it
    y = top - 18; heading(list[1].title, M + half + 16, half); y = top;
    table(list[1].cols, list[1].rows, { ...list[1].opts, x: M + half + 16, width: half });
    const pageB = doc.getNumberOfPages();
    if (pageA !== page && pageB === page) { doc.setPage(pageA); y = endA; }
    else if (pageB === pageA) y = Math.max(y, endA);
  };
  const amount = x => (x.qty != null && x.qty !== '' ? `${x.qty} ${x.unit || ''}`.trim() : '-');

  /* delays, materials received, then requests: each across the page */
  pair(show.delays && { title: 'Delays', cols: [{ t: 'Time', w: 0.13 }, { t: 'Cause', w: 0.2 }, { t: 'By', w: 0.17 }, { t: 'Hours', w: 0.12, a: 'right' }, { t: 'Details', w: 0.38, a: 'left' }],
    rows: r.delays.map(x => [x.at, x.cause, x.party || '-', String(x.hours), [x.idlePeople ? `${x.idlePeople} people idle` : '', x.idleEquipment, x.note].filter(Boolean).join(', ') || '-']) }, null);
  if (show.materials) {
    section('Materials received');
    table([{ t: 'Photo time', w: 0.13 }, { t: 'Material', w: 0.37, a: 'left' }, { t: 'Amount', w: 0.15, a: 'right' }, { t: 'Note', w: 0.35, a: 'left' }],
      r.received.map(x => [x.at || '-', x.name, amount(x), x.note || '']));
  }
  pair(show.requests && { title: 'Requests', cols: [{ t: 'Priority', w: 0.18 }, { t: 'Item', w: 0.42, a: 'left' }, { t: 'Amount', w: 0.18, a: 'right' }, { t: 'Needed by', w: 0.22 }],
    rows: requests.map(q => [q.priority, [q.category, q.text].filter(Boolean).join(': '), amount(q), q.neededBy ? dayLabel(q.neededBy) : '-']) }, null);

  /* manpower (by tier) beside equipment (active, idle, then down) */
  const tot = totals(r.crew, st.start, st.end);
  pair(show.manpower && { title: 'Manpower', cols: [{ t: 'Manpower', w: 0.56, a: 'left' }, { t: 'Qty', w: 0.18, a: 'right' }, { t: 'Man-hour', w: 0.26, a: 'right' }],
    rows: manpowerRows(r).map(x => [x.trade, String(x.qty), String(Math.round(x.hrs * 10) / 10)]), opts: { foot: ['Total', String(tot.present), String(tot.manHours)] } },
  show.equipment && { title: 'Equipment', cols: [{ t: 'Equipment', w: 0.42, a: 'left' }, { t: 'Qty', w: 0.14, a: 'right' }, { t: 'Hours', w: 0.18, a: 'right' }, { t: 'Status', w: 0.26 }],
    rows: equipmentRows(r).map(e => [e.name, String(e.qty), String(e.hrs ?? ''), e.status === 'Breakdown' ? 'Down' : e.status || '']) });

  if (show.notes) { section('Notes'); para(r.notes); }
  if (show.instructions) { section("Client engineer's instructions"); para(r.instructions); }

  /* Safety (2/3 of the row) beside the sign-off (1/3), last before the photos:
       PREPARED BY:
       Abebe Kebede
       Site Engineer   ____________      the signature sits on the line; the client copy leaves the date blank */
  const sf = r.safety || {}, gapX = 16, sw = (CW - gapX) * (2 / 3), ow = CW - gapX - sw, ox = M + sw + gapX;
  const safeText = `Toolbox talk: ${sf.toolbox ? ampm(sf.toolboxAt) || 'held' : 'not held'}  ·  ${sf.incident ? `${sf.kind || 'Incident'}: ${sf.note || 'no description'}` : 'No incidents'}`;
  font(9.5, sf.incident ? 'bold' : 'normal');
  const safeLines = show.safety ? lines(safeText, sw) : [];
  room(Math.max(70, 34 + safeLines.length * 12));
  y += 12;
  const ry = y;
  if (show.safety) {
    heading('Safety', M, sw); y = ry + 18;
    font(9.5, sf.incident ? 'bold' : 'normal', sf.incident ? RED : INK);
    for (const ln of safeLines) { doc.text(ln, M, y); y += 12; }
  }
  const safeEnd = y;
  font(8, 'bold', MUTED); doc.text('PREPARED BY:', ox, ry);
  font(10, 'bold', INK); doc.text(lines(profile.name || '', ow)[0] || '', ox, ry + 15);
  // 2.89.0 (QA D4): the whole job title: a smaller font first, then two lines (it was cut: "Senior Site")
  const posText = profile.position || '';
  let fs = 9; font(fs, 'normal', MUTED);
  while (fs > 7 && doc.getTextWidth(posText) > ow * 0.45) { fs -= 0.5; font(fs, 'normal', MUTED); }
  const posL = lines(posText, ow * 0.45).slice(0, 2);
  const px = ox + Math.min(Math.max(0, ...posL.map(t => doc.getTextWidth(t))), ow * 0.45) + 8;
  posL.forEach((t, j) => doc.text(t, ox, ry + 37 - (posL.length - 1 - j) * 9));
  const lx2 = ox + ow;
  // 2.26.0: the signature sits under the name (it covered the name's last letters)
  if (d.sig) { try { doc.addImage(d.sig, 'PNG', px, ry + 19, Math.min(lx2 - px, 66), 19); } catch { /* a bad signature image leaves the line blank */ } }
  color(INK, 'draw'); doc.setLineWidth(0.6); doc.line(px, ry + 38, lx2, ry + 38);
  if (!d.client) { font(7, 'normal', MUTED); doc.text(`${dayLabel(r.date)} ${d.signedAt || ''}`.trim(), lx2 - 2, ry + 46, { align: 'right' }); }
  y = Math.max(safeEnd, ry + 50);

  /* photos right after the sign-off, like Central Hub's report: 3 in a row, the same size (cut to fit), rounded
     corners, the caption under each; a new page carries on when this one is full */
  const pics = d.photos || [];
  const gap = 12, tw = (CW - 2 * gap) / 3, th = tw * 0.75, rowH = th + 26, headH = 30;
  const rowsFrom = top => Math.max(0, Math.floor((bottom - top - headH + gap) / rowH));
  const perPage = rowsFrom(M) * 3;
  let firstCap = rowsFrom(y + 6) * 3;
  if (!firstCap) firstCap = perPage;
  pics.forEach((p, i) => {
    const k = i % 3;
    if (i === 0) { if (rowsFrom(y + 6) === 0) newPage(); else y += 6; y += 12; heading('Photos'); y += 18; }
    else if (k === 0 && y + rowH > bottom) { newPage(); y += 12; heading('Photos'); y += 18; }
    const x = M + k * (tw + gap);
    photo(doc, p, { x, y, w: tw, h: th });
    font(8, 'normal', MUTED); doc.text(lines([d.client ? '' : p.at, p.cap].filter(Boolean).join(' · '), tw)[0] || '', x, y + th + 11);
    if (k === 2 || i === pics.length - 1) y += rowH;
  });
  const n0 = pics.length, over = n0 <= firstCap ? firstCap - n0 : (perPage - ((n0 - firstCap) % perPage)) % perPage;
  doc.photoFit = { now: over, next: over + perPage };

  /* 2.1.1: no attendance-by-name page. The PDF can reach the client; the names go to Central Hub's attendance
     sheet through the report file (meta.attendance) only. */

  /* footer on every page (2.11.0: the file name is no longer printed; it stays in the report file) */
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    color(LINE, 'draw'); doc.setLineWidth(0.5); doc.line(M, H - 34, M + CW, H - 34);
    font(7.5, 'normal', MUTED);
    doc.text(`Amistad Prefab · Daily Field Report · ${project.name || ''}`, M, H - 22);
    doc.text(`Page ${i} of ${n}`, M + CW, H - 22, { align: 'right' });
  }
  return doc;
}

/** A photo filling its tile (cut to fit, centred), with rounded corners. */
function photo(doc, p, f) {
  const pw = Number(p.w) || 4, ph = Number(p.h) || 3, s = Math.max(f.w / pw, f.h / ph), iw = pw * s, ih = ph * s;
  doc.setFillColor(240, 243, 245); doc.roundedRect(f.x, f.y, f.w, f.h, 6, 6, 'F');
  try {
    doc.saveGraphicsState();
    doc.roundedRect(f.x, f.y, f.w, f.h, 6, 6, null); doc.clip(); doc.discardPath();
    doc.addImage(p.data, 'JPEG', f.x + (f.w - iw) / 2, f.y + (f.h - ih) / 2, iw, ih);
  } catch { /* unreadable photo: the tile stays empty */ } finally { doc.restoreGraphicsState(); }
}

/** "08:00" -> "08:00 AM" */
export const ampm = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); if (!m) return ''; const h = +m[1]; return `${String(h % 12 || 12).padStart(2, '0')}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`; };

/** Which weather picture (img/weather/<name>.png) a condition uses. */
export const weatherFile = c => ({ Clear: 'clear', Sunny: 'sunny', 'Partly Cloudy': 'partly-cloudy', 'Cloudy / Overcast': 'cloudy', 'Foggy / Hazy': 'foggy', 'Light Rain': 'light-rain', 'Heavy Rain': 'heavy-rain', Windy: 'windy' })[c] || '';

/** 2.11.0: what the reporter reads about the photo pages (from doc.photoFit). */
export const fitLine = f => (!f || f.now == null ? '' : f.now
  ? `To end the report with full photo pages, insert either ${f.now} or ${f.next} more pictures.`
  : `The photo pages are full. Insert ${f.next} more pictures for one more full page.`);

/** "Zone C2 · Progress: roof sheets" (2.11.0: the time is kept apart, so the client copy can leave it out) */
export const photoCaption = (p, items = []) => {
  const it = items.find(i => i.id === p.itemId);
  const what = p.caption || (it ? `${p.captionKind}: ${it.task || it.type || it.text || 'work'}` : p.captionKind);
  return [p.zone, what].filter(Boolean).join(' · ');
};
