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

/** 2.94.0 (owner R5): the PDF drawn inside the app (view only: no file, no share, no download). pdf.js, version 3.11.174;
 *  its worker runs on the page (loaded first), so no cross-site worker is needed. */
export const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const addScript = src => new Promise((ok, fail) => {
  const s = document.createElement('script'); s.src = src; s.onload = ok;
  s.onerror = () => { s.remove(); fail(new Error('No connection to show the report')); }; document.head.appendChild(s);
});
export async function loadPdfView() {
  if (!globalThis.pdfjsWorker) await addScript(PDFJS_URL.replace('pdf.min.js', 'pdf.worker.min.js'));
  if (!globalThis.pdfjsLib) await addScript(PDFJS_URL);
  if (!globalThis.pdfjsLib) throw new Error('Report viewer missing');
  globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_URL.replace('pdf.min.js', 'pdf.worker.min.js');
  return globalThis.pdfjsLib;
}

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
// 2.96.0 (owner R7, layout A): every other row shaded; the bar's empty part; a 'nothing to report' box
const STRIPE = [242, 246, 247], TRACK = [222, 231, 234], OK = [31, 122, 74], OK_SOFT = [227, 243, 234];
const RED = [180, 35, 24], RED_SOFT = [253, 236, 234], GOLD = [201, 154, 46];
const W = 595.28, H = 841.89, M = 36, CW = W - 2 * M;
const FOOT = 30;   // the footer's height above the page edge

/**
 * d: { r, project, profile, file, logo, weather, photos: [{ data, w, h, cap, at }], sig, signedAt, client, theme }.
 * Returns the jsPDF document (doc.output('blob') in the browser, doc.output('arraybuffer') in node);
 * doc.photoFit = { now, next }: the photos still needed to fill the last photo page, and that page and one more.
 */
/** 2.94.0 (owner R5): photos in a row on the PDF: 3 (the usual) or 2 bigger ones, chosen by the Site Engineer. */
export const PHOTO_RATIO = 3 / 4;   // 3.0.2: height / width of a photo frame (slightly landscape)
export const photoCols = r => (Number((r || {}).photoCols) === 2 ? 2 : 3);

/** 2.94.0: DRAFT until the PE or the GM approves, then APPROVED; top right of every page of the in-app view. */
function stampOn(doc, stamp, right) {
  const ok = stamp === 'APPROVED', w = ok ? 74 : 54;
  doc.setFillColor(...(ok ? [220, 245, 228] : [254, 240, 214])); doc.setDrawColor(...(ok ? [22, 120, 60] : [176, 96, 10]));
  doc.setLineWidth(0.8); doc.roundedRect(right - w, 10, w, 17, 4, 4, 'FD');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...(ok ? [22, 120, 60] : [176, 96, 10]));
  doc.text(ok ? 'APPROVED' : 'DRAFT', right - w / 2, 21.5, { align: 'center' });
}

export function buildPdf(JsPDF, d) {
  const { r, project, profile } = d;
  const doc = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
  const { brand: BRAND, soft: SOFT, line: LINE } = THEMES[d.theme] || THEMES[THEME];
  let y = M;
  // 2.96.0 (owner R7: "cover the 1st page fully with the data"): the space left on page 1 is shared out between its
  // sections on a second layout (d.pad), so the data reaches the footer; the photos always start on page 2
  const pad = Number(d.pad) || 0;
  let gaps = 0;
  const color = (c, kind = 'text') => (kind === 'text' ? doc.setTextColor(...c) : kind === 'fill' ? doc.setFillColor(...c) : doc.setDrawColor(...c));
  const font = (size, style = 'normal', c = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); color(c); };
  const newPage = () => { doc.addPage(); y = M; };
  const BOTTOM = H - FOOT - 14;   // 2.11.0: the footer sits lower
  // 3.0.2 (owner, 12 Nov: "the 1st page data should always adjust to fill the page and second page is for the photos"):
  // when the data runs past page 1, page 1 is drawn a little smaller (d.scale, down to 70%, kept centred) so it
  // all fits; the room on the page grows by the same share. Below 70% (d.noFit) it carries on to page 2 as before.
  const s = d.noFit ? 1 : Number(d.scale) || 1;
  let bottom = s === 1 ? BOTTOM : M + (BOTTOM - M) / s;
  if (s !== 1) doc.internal.write(`q ${s} 0 0 ${s} ${((W * (1 - s)) / 2).toFixed(2)} ${((H - M) * (1 - s)).toFixed(2)} cm`);
  const room = h => { if (y + h > bottom) newPage(); };
  const lines = (text, width) => doc.splitTextToSize(String(text ?? ''), width);

  const heading = (title, x = M, width = CW) => {
    font(9.5, 'bold', BRAND);
    doc.text(title.toUpperCase(), x, y);
    color(BRAND, 'draw'); doc.setLineWidth(0.8); doc.line(x, y + 4, x + width, y + 4);
  };
  const section = title => { room(48); y += 12 + pad; gaps++; heading(title); y += 18; };
  const stripe = (x, top, w, h) => { color(STRIPE, 'fill'); doc.rect(x, top, w, h, 'F'); };
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
      else if (ri % 2) stripe(x, y - 10, width, h);   // 2.96.0: every other row shaded
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
  y += 12 + pad; gaps++;
  const top = y;
  let cx = M, end = y;
  cols.forEach((c, i) => {
    const w = CW * c.w;
    y = top; heading(c.title, cx, w); y += 18;
    if (i === 0) {
      info.forEach(([k, v, pic], n) => {
        if (n % 2) stripe(cx - 3, y - 9, w + 3, 14 + (infoLines[n].length - 1) * 10.5);   // 2.96.0
        font(6.8, 'bold', MUTED); doc.text(k.toUpperCase(), cx, y);
        font(8.8, 'normal'); infoLines[n].forEach((t, j) => doc.text(t, cx + 64, y + j * 10.5));
        if (pic && v && d.weather) { try { doc.addImage(d.weather, 'PNG', cx + w - 16, y - 11, 15, 15); } catch { /* no picture */ } }
        y += 14 + (infoLines[n].length - 1) * 10.5;
      });
    } else {
      colLines[i].forEach((ln, li) => {
        if (y + 11 > bottom) { end = Math.max(end, y); newPage(); y += 6; }
        if (li % 2) stripe(cx - 3, y - 8.5, w + 3, 11);   // 2.96.0
        font(8.5, ln.b ? 'bold' : 'normal', ln.b ? BRAND : INK); doc.text(ln.t, cx, y); y += 11;
      });
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
    y += 12 + pad; gaps++;
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
  const num = n => Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 1 });

  /* 2.96.0 (owner R7, layout A): each activity against its total amount of work. The figures on the left, the bar on
     the right: done before (dark), done today (gold), still to do (light). From Central Hub's schedule (d.progress). */
  const prog = (d.progress || []).filter(x => x && Number(x.total) > 0);
  if (prog.length) {
    const nameW = 150, figW = 118, barX = M + nameW + figW + 10, barW = CW - nameW - figW - 14, rh = 14.5;
    const share = x => Math.min(1, (Number(x.before) + Number(x.now)) / Number(x.total));
    const overall = Math.round((prog.reduce((t, x) => t + share(x), 0) / prog.length) * 100);
    room(Math.min(48 + prog.length * rh, bottom - M));
    y += 12 + pad; gaps++;
    heading(`Progress against the total work · ${overall}% overall`); y += 17;
    prog.forEach((x, i) => {
      if (y + rh > bottom) { newPage(); y += 6; }
      if (i % 2) stripe(M, y - 10, CW, rh);
      const done = Number(x.before) + Number(x.now), pc = Math.round(share(x) * 100);
      font(8.6, 'bold', INK); doc.text(lines(x.name, nameW - 8)[0] || '', M + 4, y);
      font(8.6, 'normal', INK); doc.text(x.unit === '%' ? `${pc}%` : `${num(done)} / ${num(x.total)} ${x.unit || ''} · ${pc}%`, M + nameW + figW - 2, y, { align: 'right' });
      const by = y - 7.5, bh = 8.5, wb = barW * Math.min(1, Number(x.before) / Number(x.total)), wn = Math.max(0, barW * share(x) - wb);
      color(TRACK, 'fill'); doc.rect(barX, by, barW, bh, 'F');
      if (wb > 0) { color(BRAND, 'fill'); doc.rect(barX, by, wb, bh, 'F'); }
      if (wn > 0) { color(GOLD, 'fill'); doc.rect(barX + wb, by, wn, bh, 'F'); }
      y += rh;
    });
    font(6.5, 'normal', MUTED);
    [0, 25, 50, 75, 100].forEach(t => doc.text(`${t}%`, barX + (barW * t) / 100, y - 2, { align: t === 0 ? 'left' : t === 100 ? 'right' : 'center' }));
    let lx = M + 4;
    for (const [c, t] of [[BRAND, 'Done before'], [GOLD, 'Done today'], [TRACK, 'Still to do']]) {
      color(c, 'fill'); doc.rect(lx, y - 7.5, 9, 6, 'F'); font(6.8, 'normal', MUTED); doc.text(t, lx + 12, y - 2.5); lx += 18 + doc.getTextWidth(t) + 6;
    }
    y += 4;
  }

  /* 2.96.0: two short blocks side by side; an empty one says something useful in a soft box instead of being left out */
  const block = (title, items, fill, red = false) => ({ title, items: items || [], fill, red });
  const duo = (A, B) => {
    const half = (CW - 16) / 2;
    const wrap = X => { font(9, 'normal'); return X.items.map(t => lines(t, half - 10)); };
    const fillLines = X => { font(8.4, 'normal'); return lines(X.fill.text, half - 34); };
    const hOf = X => (X.items.length ? wrap(X).reduce((t, l) => t + l.length * 11 + 3, 0) : 16 + fillLines(X).length * 10.5 + 8);
    const h = Math.max(hOf(A), hOf(B));
    room(Math.min(h + 34, bottom - M));
    y += 12 + pad; gaps++;
    const top = y;
    [[A, M], [B, M + half + 16]].forEach(([X, x]) => {
      y = top; heading(X.title, x, half); y += 17;
      if (X.items.length) {
        wrap(X).forEach((ls, i) => {
          if (i % 2) stripe(x, y - 9, half, ls.length * 11 + 3);
          font(9, 'normal', X.red && i === 0 ? RED : INK); ls.forEach((t, j) => doc.text(t, x + 4, y + j * 11));
          y += ls.length * 11 + 3;
        });
      } else {
        const fl = fillLines(X), bh = 16 + fl.length * 10.5 + 4, ok = X.fill.ok !== false;
        color(ok ? OK_SOFT : SOFT, 'fill'); doc.roundedRect(x, y - 9, half, bh, 4, 4, 'F');
        color(WHITE, 'fill'); doc.circle(x + 11, y - 9 + bh / 2, 6, 'F');
        font(7, 'bold', ok ? OK : BRAND); doc.text(ok ? 'OK' : 'i', x + 11, y - 9 + bh / 2 + 2.4, { align: 'center' });
        font(8.8, 'bold', ok ? OK : BRAND); doc.text(X.fill.title, x + 24, y + 1);
        font(8.4, 'normal', MUTED); fl.forEach((t, j) => doc.text(t, x + 24, y + 12 + j * 10.5));
      }
    });
    y = top + 17 + h;
  };

  const sf = r.safety || {};
  const instr = String(r.instructions || '').split('\n').map(t => t.trim()).filter(Boolean);
  const matReq = requests.filter(q => /material/i.test(q.category || '')).length;
  const safety = block('Safety', sf.incident || sf.toolbox ? [
    sf.incident ? `${sf.kind || 'Incident'}: ${sf.note || 'no description'}` : 'No incident',
    `Toolbox talk: ${sf.toolbox ? ampm(sf.toolboxAt) || 'held' : 'not held'}`,
  ] : [], { title: 'No incident today', text: 'No accident or near miss was reported on site today.' }, !!sf.incident);
  const delayLine = x => {
    const more = [x.idlePeople ? `${x.idlePeople} people idle` : '', x.idleEquipment, x.note].filter(Boolean).join(', ');
    return [x.at, `${x.cause}${x.party ? ` (${x.party})` : ''}`, `${x.hours} h`, more].filter(Boolean).join(' · ');
  };
  const delayHrs = (r.delays || []).reduce((t, x) => t + (Number(x.hours) || 0), 0);
  duo(safety, block((r.delays || []).length ? `Delays · ${num(delayHrs)} h` : 'Delays', (r.delays || []).map(delayLine),
    { title: 'No delays', text: 'Every planned working hour was worked.' }));
  duo(block('Materials received', (r.received || []).map(x => [x.name, amount(x) !== '-' ? amount(x) : '', x.note].filter(Boolean).join(' · ')),
    { title: 'Nothing delivered today', text: matReq ? `${matReq} material request${matReq === 1 ? '' : 's'} from site ${matReq === 1 ? 'is' : 'are'} with the office.` : 'No material is waiting on a request from site.', ok: false }),
  block("Client engineer's instructions", instr, { title: 'No new instructions', text: "The client's engineer gave no new instruction today." }));

  pair(show.requests && { title: 'Requests', cols: [{ t: 'Priority', w: 0.18 }, { t: 'Item', w: 0.42, a: 'left' }, { t: 'Amount', w: 0.18, a: 'right' }, { t: 'Needed by', w: 0.22 }],
    rows: requests.map(q => [q.priority, [q.category, q.text].filter(Boolean).join(': '), amount(q), q.neededBy ? dayLabel(q.neededBy) : '-']) }, null);

  /* manpower (by tier) beside equipment (active, idle, then down) */
  const tot = totals(r.crew, st.start, st.end);
  pair(show.manpower && { title: 'Manpower', cols: [{ t: 'Manpower', w: 0.56, a: 'left' }, { t: 'Qty', w: 0.18, a: 'right' }, { t: 'Man-hour', w: 0.26, a: 'right' }],
    rows: manpowerRows(r).map(x => [x.trade, String(x.qty), String(Math.round(x.hrs * 10) / 10)]), opts: { foot: ['Total', String(tot.present), String(tot.manHours)] } },
  show.equipment && { title: 'Equipment', cols: [{ t: 'Equipment', w: 0.42, a: 'left' }, { t: 'Qty', w: 0.14, a: 'right' }, { t: 'Hours', w: 0.18, a: 'right' }, { t: 'Status', w: 0.26 }],
    rows: equipmentRows(r).map(e => [e.name, String(e.qty), String(e.hrs ?? ''), e.status === 'Breakdown' ? 'Down' : e.status || '']) });

  if (show.notes) { section('Notes'); para(r.notes); }

  /* the sign-off, at the right, last on page 1:
       PREPARED BY:
       Abebe Kebede
       Site Engineer   ____________      the signature sits on the line; the client copy leaves the date blank */
  const ow = (CW - 16) / 3, ox = M + CW - ow;
  room(64);
  y += 12 + pad; gaps++;
  const ry = y;
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
  y = ry + 50;

  // page 1 full: lay out once more with the space left shared between the sections (only when the data fits on page 1);
  // 3.0.2: no upper limit on the share, and data too long for page 1 is drawn smaller until it fits
  const one = doc.getNumberOfPages() === 1;
  if (!one && !d.noFit) return buildPdf(JsPDF, { ...d, pad: 0, ...(s > 0.72 ? { scale: Math.round((s - 0.05) * 100) / 100 } : { scale: 1, noFit: true }) });
  if (s !== 1) doc.internal.write('Q');
  if (!d.pad && one && gaps && bottom - y > 16) return buildPdf(JsPDF, { ...d, pad: (bottom - y - 6) / gaps });
  bottom = BOTTOM;   // the photo pages are full size

  /* 2.96.0 (owner R7): the photos start on page 2 and fill each page: 3 across and 4 down (2 across and 3 down when the
     Site Engineer chose bigger photos), one even gap, the caption under each; page 3 and on carry on the same way */
  const pics = d.photos || [];
  // 3.0.2 (owner, 12 Nov: "Make it a slightly landscape rather than a square"): every photo frame is 4:3 landscape;
  // the rows share the page's spare height (at most 28 pt between rows), the rest stays white at the bottom
  const COLS = photoCols(r), ROWS = COLS === 2 ? 3 : 4, per = COLS * ROWS, gap = 8, capH = 12;
  let gtop = 0, cw = 0, ph = 0, rgap = gap;
  pics.forEach((p, i) => {
    const k = i % per;
    if (k === 0) {
      newPage(); y += 12; heading('Photos'); y += 12; gtop = y; cw = (CW - (COLS - 1) * gap) / COLS;
      ph = Math.min(cw * PHOTO_RATIO, (bottom - gtop - (ROWS - 1) * gap) / ROWS - capH);
      rgap = Math.min(28, Math.max(gap, (bottom - gtop - ROWS * (ph + capH)) / (ROWS - 1)));
    }
    const x = M + (k % COLS) * (cw + gap), top = gtop + Math.floor(k / COLS) * (ph + capH + rgap);
    photo(doc, p, { x, y: top, w: cw, h: ph });
    font(8, 'normal', MUTED); doc.text(lines([d.client ? '' : p.at, d.client || !p.gal ? '' : 'From Gallery', p.cap].filter(Boolean).join(' · '), cw)[0] || '', x, top + ph + capH - 3);   // 2.93.0: office copy only
  });
  const over = pics.length ? (per - (pics.length % per)) % per : 0;
  doc.photoFit = { now: over, next: over + per };

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
    if (d.stamp) stampOn(doc, d.stamp, M + CW);   // 2.94.0: the in-app final report only (never the sent file)
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
