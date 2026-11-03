// v0.77.0 (owner, 3 Nov): Site instructions, the first page of the digital site book. The Site or Project Engineer
// writes up the consultant's instruction, sends it as a link, the consultant signs it on siteinst.html, Amistad answers.
// The records are in engine/siteinstr.js; the server copies the consultant's signature back (functions/siteinstr.js).

import { store } from '../core/store.js';
import { uid, fmtFull } from '../core/util.js';
import { html, chip } from './dom.js';
import { pictureFor, tell } from '../core/image.js';
import { randomKey } from '../engine/sign.js';
import { SI_MAX_PHOTOS, SI_PHOTO, SI_STATUS, SI_TONE, SI_REPLIES, siNo, newInstr, linkDoc, siLink, fromSigned, waiting, overdue } from '../engine/siteinstr.js';
import { docHead, docSec, signoff, docFoot, footText } from './print.js';

let open = '';        // the instruction shown
let editing = '';     // the instruction being written
let printing = '';    // the instruction shown as a printable page
let checked = new Set();   // links already looked up this session

const listOf = c => [...(c.ws.siteInstr || [])].sort((a, b) => (b.no || 0) - (a.no || 0));
const find = (c, id) => (c.ws.siteInstr || []).find(x => x.id === id);
/** Who writes: the Admin, Office, and the project's Site or Project Engineer. */
export const mayWrite = (role, ranks) => role === 'owner' || role === 'office' || (role === 'site' && (ranks || []).some(r => r === 'site_engineer' || r === 'project_manager'));
const base = () => location.origin + location.pathname.replace(/[^/]*$/, '');
const me = () => store.signature?.split(',')[0] || store.user?.name || store.user?.email || '';

/** The menu badge: answers to give, and replies overdue. */
export const pendingCount = c => waiting(c.ws?.siteInstr, c.today).length;

/** The consultant's answer, looked up once per link while the page is open (the server also copies it every 2 minutes). */
function lookUp(c) {
  for (const x of c.ws.siteInstr || []) {
    if (x.status !== 'sent' || !x.link || checked.has(x.link)) continue;
    checked.add(x.link);
    Promise.resolve(store.readDoc(`company/main/sisigned/${x.link}`)).then(s => {
      if (s && mayWrite(store.role, store.ranks)) store.update(ws => { const r = ws.siteInstr.find(y => y.id === x.id); if (r && r.status === 'sent') Object.assign(r, fromSigned(s)); });
    }).catch(() => {});
  }
}

export function render(c) {
  lookUp(c);
  if (printing === '*') return paperList(c);
  if (printing && find(c, printing)) return paper(c, find(c, printing));
  const list = listOf(c), may = mayWrite(store.role, store.ranks), wait = waiting(list, c.today);
  return html`
    <section class="card">
      <div class="card-head"><h2>Site instructions · ${c.project.name}</h2>
        <div class="actions">${may ? html`<button class="btn primary small" data-act="siNew">New site instruction</button>` : ''}
        ${list.length ? html`<button class="btn ghost small" data-act="siPrintAll">Print the list</button>` : ''}</div></div>
      <p class="muted">The consultant's instructions on site, numbered. Write one up, send the link: the consultant reads and signs it on their phone, without an account. Then answer it.</p>
      ${wait.length ? html`<p class="callout warn"><b>!</b> <span>${wait.length} waiting for Amistad's answer: ${wait.map(x => siNo(x.no)).join(', ')}</span></p>` : ''}
      ${editing ? form(c, find(c, editing)) : ''}
      ${list.length ? html`<table class="tbl"><thead><tr><th>No.</th><th>Date</th><th>Subject</th><th>From</th><th>Status</th><th>Reply by</th></tr></thead><tbody>
        ${list.map(x => html`<tr class="clickable" data-act="siOpen" data-id="${x.id}"><td><b>${siNo(x.no)}</b></td><td>${fmtFull(x.date)}</td><td>${x.subject || '—'}${x.costTime ? html` ${chip('Cost or time', 'warn')}` : ''}</td>
          <td>${x.from || ''}</td><td>${chip(SI_STATUS[x.status] || x.status, SI_TONE[x.status])}</td><td>${x.dueBy ? html`<span class="${overdue(x, c.today) ? 'bad' : ''}">${fmtFull(x.dueBy)}</span>` : ''}</td></tr>
          ${open === x.id ? html`<tr><td colspan="6">${detail(c, x, may)}</td></tr>` : ''}`)}
      </tbody></table>` : html`<p class="empty">No site instruction yet.${may ? ' Use "New site instruction".' : ''}</p>`}
    </section>`;
}

function form(c, x) {
  if (!x) return '';
  return html`<form class="entry si-form" data-form="siSave" data-id="${x.id}">
    <h3>${siNo(x.no)} · ${x.status === 'draft' ? 'draft' : 'sent: changes are not in the consultant\'s copy'}</h3>
    <div class="grid2"><label>Date <input type="date" name="date" value="${x.date}" required></label>
      <label>Reply by <input type="date" name="dueBy" value="${x.dueBy || ''}"></label>
      <label>From (the consultant) <input name="from" value="${x.from}" placeholder="Name and company" required></label>
      <label>To <input name="to" value="${x.to}"></label>
      <label>Subject <input name="subject" value="${x.subject}" required></label>
      <label>Location or zone <input name="zone" value="${x.zone || ''}"></label></div>
    <label>The instruction <textarea name="text" rows="5" required>${x.text}</textarea></label>
    <label class="check"><input type="checkbox" name="costTime" ${x.costTime ? 'checked' : ''}> It changes the cost or the time (an extra work order later)</label>
    <div class="si-photos">${(x.photos || []).map((p, i) => html`<span><img src="${p}" alt="Photo ${i + 1}"><button type="button" class="btn ghost small" data-act="siPhotoDel" data-id="${x.id}" data-i="${i}">Remove</button></span>`)}
      ${(x.photos || []).length < SI_MAX_PHOTOS ? html`<label class="btn small">Add photo <input type="file" accept="image/*" data-chg="siPhoto" data-id="${x.id}" hidden></label>` : ''}</div>
    <div class="actions left"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-act="siCancel">Close</button></div>
  </form>`;
}

function detail(c, x, may) {
  const k = x.consultant;
  return html`<div class="si-detail">
    <p><b>${x.subject}</b>${x.zone ? html` · ${x.zone}` : ''}</p><p class="pre">${x.text}</p>
    ${(x.photos || []).length ? html`<div class="si-photos">${x.photos.map((p, i) => html`<img src="${p}" alt="Photo ${i + 1}">`)}</div>` : ''}
    ${k ? html`<p class="callout ${x.status === 'commented' ? 'warn' : 'ok'}"><span>${x.status === 'commented' ? 'Comment' : 'Signed'} by ${k.name}, ${new Date(k.at).toLocaleString()}${k.comment ? html`: "${k.comment}"` : ''}</span></p><img class="doc-sig-img" src="${k.image}" alt="Signature">` : ''}
    ${x.reply ? html`<p class="muted">Amistad: ${SI_STATUS[x.reply]} by ${x.replyBy}, ${fmtFull(x.replyAt.slice(0, 10))}${x.replyNote ? ` · ${x.replyNote}` : ''}</p>` : ''}
    <div class="actions left">
      ${may && x.status === 'draft' ? html`<button class="btn small" data-act="siEdit" data-id="${x.id}">Edit</button><button class="btn primary small" data-act="siSend" data-id="${x.id}">Send for signature</button>` : ''}
      ${may && x.status === 'sent' ? html`<button class="btn small" data-act="siCopy" data-id="${x.id}">Copy the link again</button>` : ''}
      <button class="btn ghost small" data-act="siPrint" data-id="${x.id}">Print</button></div>
    ${may && ['signed', 'commented', 'sent', 'accepted', 'disputed'].includes(x.status) ? html`<form class="entry" data-form="siReply" data-id="${x.id}">
      <label>Amistad's answer <select name="reply">${SI_REPLIES.map(([v, t]) => html`<option value="${v}" ${x.reply === v ? 'selected' : ''}>${t}</option>`)}</select></label>
      <label>Note <input name="note" value="${x.replyNote || ''}" maxlength="400"></label><button class="btn small">Save the answer</button></form>` : ''}
  </div>`;
}

/** The A4 page: one instruction with both signatures, or (printing = '*') the list. */
function paper(c, x) {
  const ref = siNo(x.no), k = x.consultant || {};
  return html`<div class="actions left no-print"><button class="btn primary" data-act="siDoPrint">Print</button><button class="btn ghost" data-act="siPrint" data-id="">Back</button></div>
  <section class="card sheet"><div class="paper dsr" data-foot="${footText(c, 'Site instruction', ref)}">
    ${docHead(c, { title: 'Site instruction', sub: x.subject, ref, status: SI_STATUS[x.status], facts: [['Project', c.project.name], ['Date', fmtFull(x.date)], ['From', x.from], ['To', x.to], ['Location', x.zone || '—'], ['Reply by', x.dueBy ? fmtFull(x.dueBy) : '—'], ['Cost or time', x.costTime ? 'Yes' : 'No']] })}
    ${docSec(1, 'Instruction', html`<p class="pre">${x.text}</p>`)}
    ${(x.photos || []).length ? docSec(2, 'Photos', html`<div class="si-photos print">${x.photos.map(p => html`<img src="${p}" alt="">`)}</div>`) : ''}
    ${docSec((x.photos || []).length ? 3 : 2, 'Answer', html`<p>${x.reply ? `${SI_STATUS[x.reply]} · ${x.replyNote || ''}` : 'Not answered yet.'}</p>${k.comment ? html`<p>Consultant's comment: ${k.comment}</p>` : ''}`)}
    ${signoff([{ label: 'Consultant', name: k.name || x.from, sig: k.image || '', note: k.at ? fmtFull(k.at.slice(0, 10)) : 'Date' }, { label: 'For Amistad Prefab', name: x.replyBy || x.by, note: x.replyAt ? fmtFull(x.replyAt.slice(0, 10)) : 'Date' }])}
    ${docFoot(footText(c, 'Site instruction', ref))}
  </div></section>`;
}
function paperList(c) {
  const list = listOf(c).reverse();
  return html`<div class="actions left no-print"><button class="btn primary" data-act="siDoPrint">Print</button><button class="btn ghost" data-act="siPrint" data-id="">Back</button></div>
  <section class="card sheet"><div class="paper dsr" data-foot="${footText(c, 'Site instructions', '')}">
    ${docHead(c, { title: 'Register of site instructions', sub: c.project.name, facts: [['Project', c.project.name], ['As of', fmtFull(c.today)], ['Instructions', String(list.length)]] })}
    <table class="tbl"><thead><tr><th>No.</th><th>Date</th><th>Subject</th><th>From</th><th>Status</th><th>Signed</th></tr></thead><tbody>
      ${list.map(x => html`<tr><td>${siNo(x.no)}</td><td>${fmtFull(x.date)}</td><td>${x.subject}</td><td>${x.from}</td><td>${SI_STATUS[x.status]}</td><td>${x.consultant ? fmtFull(x.consultant.at.slice(0, 10)) : ''}</td></tr>`)}
    </tbody></table>${docFoot(footText(c, 'Site instructions', ''))}
  </div></section>`;
}
async function copy(url) {
  try { await navigator.clipboard.writeText(url); tell('✓ Link copied: paste it in WhatsApp, Telegram or an email to the consultant.'); }
  catch { prompt('Copy this link for the consultant:', url); }
}

export const actions = {
  siNew(el, c) {
    if (!mayWrite(store.role, store.ranks)) return;
    const x = newInstr(c.ws.siteInstr, c.today, me(), uid('si'));
    store.update(ws => { (ws.siteInstr ||= []).push(x); });
    editing = x.id; open = '';
  },
  siOpen(el) { open = open === el.dataset.id ? '' : el.dataset.id; editing = ''; },
  siEdit(el) { editing = el.dataset.id; },
  siCancel() { editing = ''; },
  siPhotoDel(el) { const i = Number(el.dataset.i); store.update(ws => { const r = ws.siteInstr.find(y => y.id === el.dataset.id); if (r) r.photos = r.photos.filter((_, j) => j !== i); }); },
  async siSend(el, c) {
    const x = find(c, el.dataset.id);
    if (!x || !x.from || !x.subject || !x.text) return tell('Fill in From, Subject and the instruction first (Edit).');
    if (!confirm(`Send ${siNo(x.no)} to ${x.from} for signature? After sending, the consultant's copy does not change.`)) return;
    const link = randomKey(30);
    try { await store.writeDoc(`company/main/silinks/${link}`, linkDoc(x, c.project, link, store.user?.email || me())); }
    catch { return tell('The link could not be made. Check the internet connection and try again.'); }
    store.update(ws => { const r = ws.siteInstr.find(y => y.id === x.id); if (r) Object.assign(r, { status: 'sent', link, sentAt: new Date().toISOString(), sentBy: me() }); });
    copy(siLink(base(), link, !store.cloud));
  },
  siCopy(el, c) { const x = find(c, el.dataset.id); if (x?.link) copy(siLink(base(), x.link, !store.cloud)); },
  siPrint(el) { printing = el.dataset.id || ''; },
  siPrintAll() { printing = '*'; },
  siDoPrint() { print(); },
};

export const changes = {
  async siPhoto(el) {
    const f = el.files?.[0], id = el.dataset.id;
    if (!f) return;
    try {
      const { dataUrl } = await pictureFor(f, SI_PHOTO, 'photo');
      store.update(ws => { const r = ws.siteInstr.find(y => y.id === id); if (r && (r.photos || []).length < SI_MAX_PHOTOS) r.photos = [...(r.photos || []), dataUrl]; });
    } catch (err) { tell(err.message); }
  },
};

export const submits = {
  siSave(fd, c, formEl) {
    const id = formEl?.dataset.id;
    const v = k => String(fd.get(k) || '').trim();
    store.update(ws => { const r = ws.siteInstr.find(y => y.id === id); if (r) Object.assign(r, { date: v('date'), dueBy: v('dueBy'), from: v('from'), to: v('to'), subject: v('subject'), zone: v('zone'), text: v('text'), costTime: fd.get('costTime') === 'on' }); });
    editing = ''; open = id;
  },
  siReply(fd, c, formEl) {
    const id = formEl?.dataset.id, reply = String(fd.get('reply') || '');
    if (!SI_REPLIES.some(([k]) => k === reply)) return false;
    store.update(ws => { const r = ws.siteInstr.find(y => y.id === id); if (r) Object.assign(r, { reply, status: reply, replyNote: String(fd.get('note') || '').trim().slice(0, 400), replyBy: me(), replyAt: new Date().toISOString() }); });
  },
};

