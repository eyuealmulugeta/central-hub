// v0.99.0 (owner, 7 Nov, Phase G1): the activity record of Central Hub and Field Report (activity/<id>): every
// document generated, printed, shared, emailed, downloaded or saved with the app's own buttons (and every print),
// with who, position, app, project, page, document, number, channel, recipient and time.
// Read by the Admin and Tier 1 (GM, Owner, CEO, Board); kept 12 months; written once, never changed.

export const ACTIONS = { generate: 'Generated', print: 'Printed', share: 'Shared', email: 'Emailed', download: 'Downloaded', save: 'Saved', view: 'Viewed', send: 'Sent' };
export const actionWord = k => ACTIONS[k] || k || '';
export const KEYS = ['id', 'app', 'email', 'name', 'position', 'project', 'projectName', 'page', 'action', 'channel', 'doc', 'no', 'to', 'at'];

const s = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const rand = () => Math.random().toString(36).slice(2, 8);

/** The record written to activity/<id> (only the KEYS firestore.rules accepts). */
export function entry(e, who, now = Date.now()) {
  return {
    id: `${who.app}_${now.toString(36)}_${rand()}`, app: who.app, email: s(who.email, 120).toLowerCase(), name: s(who.name, 80), position: s(who.position, 60),
    project: s(e.project ?? who.project, 60), projectName: s(e.projectName ?? who.projectName, 80), page: s(e.page, 60),
    action: ACTIONS[e.action] ? e.action : 'save', channel: s(e.channel, 40), doc: s(e.doc, 120), no: s(e.no, 40), to: s(e.to, 160), at: now,
  };
}

/** The same click reported twice within a few seconds (a PDF made, then downloaded) is kept; an exact repeat is not. */
export function isRepeat(prev, e, now) {
  return !!prev && now - prev.at < 3000 && prev.action === e.action && prev.doc === e.doc && prev.channel === e.channel;
}

/** Filtered, newest first. f: { who, app, action, project, from } */
export function filtered(list, f = {}) {
  return (list || []).filter(x => (!f.who || x.email === f.who) && (!f.app || x.app === f.app) && (!f.action || x.action === f.action)
    && (!f.project || x.project === f.project || x.projectName === f.project) && (!f.from || +x.at >= f.from))
    .sort((a, b) => +b.at - +a.at);
}

/** The actions of one session (sign-in history): same person, between its start and its end. */
export const inSession = (list, e, end) => (list || []).filter(x => x.email === e.email && x.app === e.app && +x.at >= +e.start && +x.at <= end + 60000);

/** CSV rows for Excel. */
export function csvRows(list) {
  const t = ms => new Date(+ms + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  return [['When (Addis Ababa)', 'Person', 'Position', 'App', 'Project', 'Page', 'Action', 'Channel', 'Document', 'Number', 'To'],
    ...list.map(x => [t(x.at), x.name || x.email, x.position, x.app, x.projectName || x.project, x.page, actionWord(x.action), x.channel, x.doc, x.no, x.to])];
}
