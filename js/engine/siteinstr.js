// v0.77.0 (owner, 3 Nov): the digital site book, first page: Site instructions. The consultant's instruction on site is
// written up by the project's Site or Project Engineer (projects/<id>/siteInstr/<id>), sent as a link, and signed by the
// consultant on siteinst.html without signing in. The link's copy (company/main/silinks/<link>) is what the consultant
// reads; their answer is company/main/sisigned/<link>, written once; the server (functions/siteinstr.js) copies it
// back to the instruction. Amistad then answers Accepted, Done or Disputed. Pure functions.

export const SI_MAX_PHOTOS = 6;
export const SI_PHOTO = { maxBytes: 80 * 1024, maxSide: 800 };   // six fit in one database record
export const SI_STATUS = { draft: 'Draft', sent: 'Waiting for the consultant', signed: 'Signed by the consultant', commented: 'Consultant commented', accepted: 'Accepted', done: 'Done', disputed: 'Disputed' };
export const SI_TONE = { draft: '', sent: 'warn', signed: 'info', commented: 'warn', accepted: 'ok', done: 'ok', disputed: 'high' };
export const SI_REPLIES = [['accepted', 'Accepted'], ['done', 'Done'], ['disputed', 'Disputed']];

/** "SI-007" */
export const siNo = n => `SI-${String(n || 0).padStart(3, '0')}`;
/** The next number of the project. */
export const nextNo = list => Math.max(0, ...(list || []).map(x => Number(x.no) || 0)) + 1;

/** A new instruction, numbered, dated today. */
export function newInstr(list, today, by, id) {
  return { id, no: nextNo(list), date: today, from: '', to: 'Amistad Prefab', subject: '', text: '', zone: '', photos: [], costTime: false, dueBy: '', status: 'draft', by, at: new Date().toISOString() };
}

/** The copy the consultant reads from the link: what the instruction says, nothing else of the project. */
export const linkDoc = (x, project, link, by) => ({
  id: link, pid: project.id, rid: x.id, project: project.name || '', no: siNo(x.no), date: x.date, from: x.from, to: x.to,
  subject: x.subject, text: x.text, zone: x.zone, photos: (x.photos || []).slice(0, SI_MAX_PHOTOS), costTime: !!x.costTime, dueBy: x.dueBy || '',
  status: 'sent', by, at: new Date().toISOString(),
});

export const siLink = (base, link, local = false) => `${base}siteinst.html?${local ? 'local&' : ''}k=${link}`;

/** The consultant's answer, as kept on the instruction. */
export const fromSigned = s => ({ status: s.decision === 'comment' ? 'commented' : 'signed', consultant: { name: s.name, image: s.image, comment: s.comment || '', at: s.at } });

/**
 * What needs Amistad: signed or commented and not answered yet, and any instruction past its reply date without an
 * answer. For the menu badge and the list.
 */
export function waiting(list, today) {
  return (list || []).filter(x => ['signed', 'commented'].includes(x.status) || (x.dueBy && x.dueBy < today && !['accepted', 'done', 'disputed', 'draft'].includes(x.status)));
}
export const overdue = (x, today) => !!x.dueBy && x.dueBy < today && !['accepted', 'done', 'disputed'].includes(x.status);
