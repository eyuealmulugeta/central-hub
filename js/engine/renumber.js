// v1.63.0 (owner, 15 Nov): Field Report numbers count every working day, with or without a report; only the project's
// days off are skipped. Past reports are renumbered once: the first numbered report keeps its number, each next one
// gets the last one's number plus the working days after it (at least 1). workDays: weekdays worked, 0 = Sunday.

const DAY = 864e5;

/** The working days after date a, up to and including date b; at least 1. */
export function workDaysAfter(workDays, nonWorking, a, b) {
  const wd = Array.isArray(workDays) && workDays.length ? workDays.map(Number) : [1, 2, 3, 4, 5, 6], nw = new Set(nonWorking || []);
  let n = 0, t = Date.parse(a + 'T12:00:00Z');
  const end = Date.parse(b + 'T12:00:00Z');
  for (let i = 0; i < 4000 && !Number.isNaN(t); i++) {
    t += DAY;
    if (t > end) break;
    const d = new Date(t);
    if (wd.includes(d.getUTCDay()) && !nw.has(d.toISOString().slice(0, 10))) n++;
  }
  return Math.max(1, n);
}

const pad = n => (String(n).length > 3 ? String(n) : String(n).padStart(3, '0'));

/** The plan for one project: [{ id, date, from, to, pdf, newPdf }] for every Field Report report with a number. */
export function planRenumber(reports, project) {
  const rows = (reports || []).filter(r => r?.source === 'field' && r.field && Number(r.field.no) && /^\d{4}-\d{2}-\d{2}$/.test(r.date || ''))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out = [];
  let prev = null, no = 0;
  for (const r of rows) {
    no = prev ? no + workDaysAfter(project?.workDays, project?.nonWorking, prev, r.date) : Number(r.field.no);
    const pdf = r.field.pdf || '';
    out.push({ id: r.id, date: r.date, from: pad(Number(r.field.no)), to: pad(no), pdf, newPdf: pdf.replace(/_(\d{3,4})(_[A-Z0-9]{2,4})?\.pdf$/, `_${pad(no)}$2.pdf`) });
    prev = r.date;
  }
  return out;
}

/** The numbers to send to Field Report ({ 'yyyy-mm-dd': n }). */
export const numbersOf = plan => Object.fromEntries(plan.map(x => [x.date, Number(x.to)]));

/** Apply a plan to a workspace's reports (field.no, field.pdf and the database copy's number). */
export function applyRenumber(ws, plan) {
  for (const x of plan) {
    if (x.from === x.to) continue;
    const r = (ws.reports || []).find(y => y.id === x.id);
    if (!r?.field) continue;
    r.field = { ...r.field, no: x.to, ...(r.field.pdf ? { pdf: x.newPdf } : {}) };
    if (r.full?.r) r.full = { ...r.full, r: { ...r.full.r, no: Number(x.to) } };
  }
  return ws;
}
