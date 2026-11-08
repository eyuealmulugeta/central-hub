// 2.66.0 (owner, 7 Nov): technicians share pictures of the work they executed. A technician account opens only Share work:
// camera photos (up to 3), the task, a note; the phone refuses a picture that is blurred or too dark or bright. The Site
// Engineer or PE approves it or rejects it with a reason; a phone with 3 rejected in 7 days is reported to the Admin, who may
// block it. Kept in Central Hub's database: projects/<id>/workShots/<id>. The same file is in Central Hub (js/fr/model).

export const MAX_PHOTOS = 3;
export const PHOTO_CHARS = 230000;   // each photo's data URL; 3 stay well under Firestore's 1 MB a record
export const REJECT_REASONS = [['blur', 'Not clear'], ['dark', 'Too dark'], ['place', 'Wrong place'], ['task', 'Not this task'], ['other', 'Other']];
export const reasonWord = k => (REJECT_REASONS.find(([v]) => v === k) || [])[1] || k || '';
export const SHOT_WORD = { waiting: 'Waiting for the SE / PE', approved: 'Approved', rejected: 'Rejected' };
export const SHOT_TONE = { waiting: 'warn', approved: 'ok', rejected: 'bad' };
export const BAD_DAYS = 7, BAD_COUNT = 3;

/** Field Report roles: technician shares; engineer (SE), coordinator (PE), exec (GM), admin review. */
export const isTechnician = role => role === 'technician';
export const mayReview = role => ['engineer', 'coordinator', 'exec', 'admin'].includes(role);

/**
 * The picture check, on a small grey copy (values 0-255, w x h): sharpness = variance of the Laplacian (low = blurred),
 * light = the average. { sharp, light, ok, why }.
 */
export const SHARP_MIN = 60, LIGHT_MIN = 45, LIGHT_MAX = 240;
export function qualityOf(gray, w, h) {
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const light = gray.length ? sum / gray.length : 0;
  let n = 0, m = 0, m2 = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
    n++; const d = v - m; m += d / n; m2 += d * (v - m);
  }
  const sharp = n > 1 ? m2 / (n - 1) : 0;
  const why = light < LIGHT_MIN ? 'Too dark' : light > LIGHT_MAX ? 'Too bright' : sharp < SHARP_MIN ? 'Not clear (blurred)' : '';
  return { sharp: Math.round(sharp), light: Math.round(light), ok: !why, why };
}

/** Why a share cannot be sent, or ''. f = { taskId, note, photos: [{ url, q }] } */
export function shotProblem(f, { tasks = [] } = {}) {
  const ph = f.photos || [];
  if (!ph.length) return 'Take at least one photo of the work.';
  if (ph.length > MAX_PHOTOS) return `At most ${MAX_PHOTOS} photos.`;
  if (ph.some(p => !p.q || !p.q.ok)) return 'A photo is not clear. Take it again.';
  if (tasks.length && !tasks.some(t => t.id === f.taskId)) return 'Choose the task.';
  if (!String(f.note || '').trim()) return 'Write what was done.';
  return '';
}

/** The record written to Central Hub. */
export function shotRecord(f, { email, byName, at, pid, id, dev = '', geo = null, date }) {
  return {
    id, projectId: pid, site: true, status: 'waiting', by: String(email || '').toLowerCase(), byName: byName || email, at, date,
    taskId: String(f.taskId || ''), taskName: String(f.taskName || '').slice(0, 120), note: String(f.note || '').trim().slice(0, 300),
    photos: (f.photos || []).slice(0, MAX_PHOTOS).map(p => p.url), q: (f.photos || []).slice(0, MAX_PHOTOS).map(p => ({ sharp: p.q.sharp, light: p.q.light })),
    dev: String(dev || '').slice(0, 40), geo: geo && geo.lat != null ? { lat: geo.lat, lng: geo.lng, acc: geo.acc || 0 } : null,
  };
}

export const sortShots = list => (list || []).filter(x => x && x.id).sort((a, b) => (a.status === 'waiting' ? 0 : 1) - (b.status === 'waiting' ? 0 : 1) || String(b.at).localeCompare(String(a.at)));

/** Per technician: sent, approved, rejected and the reasons. */
export function techStats(list) {
  const m = new Map();
  for (const x of list || []) {
    if (!x?.by) continue;
    const r = m.get(x.by) || { by: x.by, byName: x.byName || x.by, sent: 0, approved: 0, rejected: 0, waiting: 0, reasons: {} };
    r.sent++; r[x.status] = (r[x.status] || 0) + 1;
    if (x.status === 'rejected') r.reasons[x.reason || 'other'] = (r.reasons[x.reason || 'other'] || 0) + 1;
    m.set(x.by, r);
  }
  return [...m.values()].sort((a, b) => b.rejected - a.rejected || a.byName.localeCompare(b.byName));
}

/** Phones with BAD_COUNT or more rejected shares in the last BAD_DAYS days: [{ dev, by, byName, count }]. */
export function badDevices(list, now = Date.now()) {
  const m = new Map(), from = now - BAD_DAYS * 864e5;
  for (const x of list || []) {
    if (x?.status !== 'rejected' || !x.dev || Date.parse(x.decidedAt || x.at) < from) continue;
    const r = m.get(x.dev) || { dev: x.dev, by: x.by, byName: x.byName || x.by, count: 0 };
    r.count++; m.set(x.dev, r);
  }
  return [...m.values()].filter(r => r.count >= BAD_COUNT);
}
