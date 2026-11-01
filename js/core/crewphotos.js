// v0.37.0: the crew's HR photos, small, for Field Report: fieldPhotos/<project id> = { at, m: { team member id: picture },
// k: { team member id: which photo it was made from } }. Made on the Admin's computer (the photos live in HR, which only
// the Admin reads) and written only when one changed. A member is matched to HR by personId, else by the same name.

const nameKey = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const keyOf = src => `${src.length}:${src.slice(-24)}`;

/** The HR photo of a team member, or ''. */
export function photoOf(m, staff) {
  const p = (m.personId && staff.find(s => s.id === m.personId)) || staff.find(s => nameKey(s.name) && nameKey(s.name) === nameKey(m.name));
  return p?.photo || '';
}

/** A square picture `side` pixels wide, cut from the middle of the photo. */
export function thumb(src, side = 72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'), s = Math.min(img.width, img.height);
      c.width = c.height = side;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, side, side);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = reject;
    img.src = src;
  });
}

/** Every project with a Field Report code: its active team's pictures. Returns how many projects were written. */
export async function syncCrewPhotos(api, projects, staff, make = thumb) {
  let wrote = 0;
  for (const p of projects.filter(x => x.fieldCode)) {
    const team = (await api.list(`projects/${p.id}/team`)).filter(m => m.active !== false);
    const old = (await api.get(`fieldPhotos/${p.id}`)) || {};
    const m = {}, k = {};
    for (const t of team) {
      const src = photoOf(t, staff);
      if (!src) continue;
      k[t.id] = keyOf(src);
      m[t.id] = old.k?.[t.id] === k[t.id] && old.m?.[t.id] ? old.m[t.id] : await make(src).catch(() => '');
      if (!m[t.id]) { delete m[t.id]; delete k[t.id]; }
    }
    if (JSON.stringify(k) !== JSON.stringify(old.k || {})) { await api.set(`fieldPhotos/${p.id}`, { at: new Date().toISOString(), m, k }); wrote++; }
  }
  return wrote;
}
