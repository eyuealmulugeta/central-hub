// v0.72.0 (owner, 3 Nov, Phase G3): urgent notices from the GM. The pop-up (its own layer over every page, until
// "I've read it" or a reply) and the GM's box on the Notifications page: write, choose who, send, and the log with
// who read and what they answered. A phone notification goes to the Field Report accounts (script urgentPush).
// See engine/urgent.js.

import { store } from '../core/store.js';
import { uid } from '../core/util.js';
import { html, options, chip } from './dom.js';
import { tell } from '../core/image.js';
import * as fieldusers from './fieldusers.js';
import { pushUrgent, fieldReady } from '../sync/fieldreport.js';
import { waitingFor, recipients, targetsOf, checkUrgent, urgentRecord, answersOf, URGENT_TO, MAX_TEXT } from '../engine/urgent.js';

const when = iso => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ---- the pop-up ----
let pop = null;
function paint() {
  const me = store.user?.email;
  const n = me && waitingFor(store.urgent, me)[0];
  if (!n) { pop?.remove(); pop = null; return; }
  if (pop && pop.dataset.id === n.id) return;   // the same notice: keep what is being typed
  pop?.remove();
  pop = document.createElement('div');
  pop.className = 'urgent-pop';
  pop.dataset.id = n.id;
  pop.setAttribute('role', 'alertdialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-label', 'Urgent notice');
  pop.innerHTML = String(html`<div class="urgent-card">
    <div class="urgent-tag">Urgent notice</div>
    <p class="urgent-text">${n.text}</p>
    <p class="muted small">From ${n.fromName || 'the GM'} · ${when(n.at)}</p>
    <textarea maxlength="300" rows="2" placeholder="Or write a different reply" aria-label="Your reply"></textarea>
    <div class="urgent-acts"><button type="button" class="btn" data-u="reply">Send reply</button><button type="button" class="btn primary" data-u="read">I've read it</button></div>
  </div>`);
  pop.addEventListener('click', async e => {
    const b = e.target.closest('button[data-u]');
    if (!b) return;
    const text = pop.querySelector('textarea').value.trim();
    if (b.dataset.u === 'reply' && !text) { tell("Write your reply first, or tap I've read it."); return; }
    b.disabled = true;
    try { await store.answerUrgent(n.id, { kind: b.dataset.u, text: b.dataset.u === 'reply' ? text : '', at: new Date().toISOString(), name: store.user?.name || '' }); }
    catch (err) { b.disabled = false; tell(`Not sent: ${err.message}`); }
  });
  document.body.appendChild(pop);
  pop.querySelector('[data-u="read"]').focus();
}
/** Called once at start (main.js). */
export function watchUrgent() { store.subscribe(paint); paint(); }

// ---- the GM's box ----
let form = { kind: 'all', pid: '', email: '' };
let opened = null;
const listOf = () => recipients({ users: store.users, fieldPeople: fieldusers.current()?.people || [], projects: store.projects, me: store.user?.email });
const toOf = c => ({ ...form, pid: form.pid || c.project?.id || '' });
const toWord = n => (n.to?.kind === 'all' ? 'Everyone' : n.to?.name || '');

export function urgentBox(c) {
  if (!store.isAdmin) return '';
  const list = listOf(), to = toOf(c), targets = targetsOf(list, to);
  const sent = [...store.urgent].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return html`<section class="card urgent-box">
    <h3>Urgent notice <span class="muted">pops up full screen until read, and goes to the phones</span></h3>
    <form data-form="urgentSend" class="grid2">
      <label class="span2">Notice <textarea name="text" maxlength="${MAX_TEXT}" rows="3" required></textarea></label>
      <label>Send to <select name="kind" data-chg="urgentTo" data-k="kind">${options(URGENT_TO, to.kind)}</select></label>
      ${to.kind === 'project' ? html`<label>Project <select name="pid" data-chg="urgentTo" data-k="pid">${options(store.projects.map(p => [p.id, p.name]), to.pid)}</select></label>` : ''}
      ${to.kind === 'person' ? html`<label>Person <select name="email" data-chg="urgentTo" data-k="email">${options([['', 'Choose…'], ...list.map(x => [x.email, x.name])], to.email)}</select></label>` : ''}
      <div class="actions left span2"><button class="btn primary">Send to ${targets.length} ${targets.length === 1 ? 'person' : 'people'}</button></div>
    </form>
    ${sent.length ? html`<h4>Sent</h4><ul class="list urgent-log">${sent.map(n => {
      const a = answersOf(n);
      return html`<li><button type="button" class="btn ghost small" data-act="urgentOpen" data-id="${n.id}">${opened === n.id ? 'Hide' : 'Who read it'}</button>
        <b>${n.text}</b><br><span class="muted small">${when(n.at)} · ${toWord(n)} · ${a.read} read · ${a.replied} replied · ${a.waiting} not yet</span>
        ${opened === n.id ? html`<table class="table compact"><tbody>${a.rows.map(r => html`<tr><td>${r.name}</td>
          <td>${r.kind === 'read' ? chip('Read', 'ok') : r.kind === 'reply' ? chip('Replied', 'warn') : chip('Not yet', '')}</td>
          <td>${r.text || ''}</td><td class="muted small nowrap">${r.at ? when(r.at) : ''}</td></tr>`)}</tbody></table>` : ''}</li>`;
    })}</ul>` : ''}
  </section>`;
}

export const urgentChanges = {
  urgentTo(el) { form = { ...form, [el.dataset.k]: el.value }; },
};

export const urgentActions = {
  urgentOpen(el) { opened = opened === el.dataset.id ? null : el.dataset.id; },
};

export const urgentSubmits = {
  urgentSend(fd, c) {
    const list = listOf(), to = { ...toOf(c), kind: fd.get('kind') || form.kind };
    const targets = targetsOf(list, to), text = String(fd.get('text') || '');
    const wrong = checkUrgent(text, targets);
    if (wrong.length) { tell(wrong.join(' ')); return false; }
    if (!confirm(`Send this urgent notice to ${targets.length} ${targets.length === 1 ? 'person' : 'people'}?`)) return false;
    const name = to.kind === 'project' ? store.projects.find(p => p.id === to.pid)?.name || '' : to.kind === 'person' ? targets[0].name : 'Everyone';
    const rec = urgentRecord({ id: uid('urg_'), text, me: store.user?.email, myName: store.user?.name, to: { kind: to.kind, pid: to.kind === 'project' ? to.pid : '', name }, targets, at: new Date().toISOString() });
    const done = () => tell(`✓ Sent to ${targets.length}.`);
    store.sendUrgent(rec).then(
      () => (store.cloud && fieldReady() ? pushUrgent({ id: rec.id, title: 'Urgent notice', text: rec.text, emails: rec.emails })
        .then(done, err => tell(`✓ Sent in the apps. The phone notification failed: ${err.message}`)) : done()),
      err => tell(`Not sent: ${err.message}`));
  },
};
