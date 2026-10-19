// All projects, in step with Field Report. Central Hub is the source: a project set up here (name, client, site,
// activities, working week, non-working dates, hold, who sees it) is created or changed in Field Report's shared list,
// which is what the Field Report app shows on the desktop and the phone. Compare shows the differences, Sync applies them,
// and "keep in step" does it by itself a few seconds after something changes.

import { store } from '../core/store.js';
import { fieldConfig, syncProjects, removeProject, linkCheck, explainLink } from '../sync/fieldreport.js';
import { fieldProjectOf, fingerprint, countryOf } from '../engine/fieldproject.js';
import { tell } from '../core/image.js';
import { todayISO } from '../core/util.js';
import { html } from './dom.js';

const AUTO_KEY = 'sf:fieldsync';
const SIG_KEY = 'sf:fieldsync-sig';
const get = key => { try { return localStorage.getItem(key); } catch { return null; } };
const put = (key, value) => { try { localStorage.setItem(key, value); } catch { /* not remembered */ } };
export const autoOn = () => get(AUTO_KEY) === '1';

let busy = false;
let table = null;      // the last comparison or sync: { at, rows, extra, missing, did }
let said = null;       // { ok, text }
let timer = null;
let failedAt = 0;
let who = { email: '', rows: null, error: '' };   // the email being checked on this tab, and Field Report's answer

const say = (ok, text) => { said = { ok, text }; tell(`${ok ? '✓' : '✗'} ${text}`); store.notify(); };
const configured = () => { const c = fieldConfig.get(); return !!(c.url && c.key); };

const WORDS = { create: ['Will be created', 'info'], update: ['Will be changed', 'warn'], same: ['In step', 'ok'], created: ['Created', 'ok'], updated: ['Changed', 'ok'], skipped: ['Needs attention', 'warn'], nocode: ['Not sent', ''], failed: ['Failed', 'high'] };

/** The inputs of a run: every project, the people with access, the price regions. */
const inputs = () => ({ projects: store.projects, users: store.users, regions: store.global.regions });

async function run(dry) {
  if (busy) return;
  if (!configured()) { say(false, 'Fill in the Field Report web app URL and manager key first (Field Report tab, step 1).'); return; }
  if (!dry && store.readOnly) { say(false, 'A co-owner cannot change anything.'); return; }
  busy = true; said = null; store.notify();
  try {
    const out = await syncProjects({ ...inputs(), dry, today: todayISO() });
    table = { at: new Date(), ...out, did: !dry };
    // after a sync, read Field Report once more so the 'Linked there' column shows what it holds now
    if (!dry) {
      try {
        const again = await syncProjects({ ...inputs(), dry: true, today: todayISO() });
        table.rows = out.rows.map(r => ({ ...r, linkedCount: again.rows.find(x => x.id === r.id)?.linkedCount }));
      } catch { /* the column stays empty */ }
    }
    const n = k => out.rows.filter(r => r.action === k).length;
    put(SIG_KEY, signature());
    if (dry) {
      const todo = n('create') + n('update');
      say(todo === 0 && !n('skipped'), todo ? `${todo} project${todo === 1 ? '' : 's'} differ${todo === 1 ? 's' : ''} from Field Report. Press "Sync all projects now" to make them the same.` : n('skipped') ? `${n('skipped')} project${n('skipped') === 1 ? ' needs' : 's need'} attention below.` : 'Every project is the same in Field Report.');
    } else {
      const failed = n('failed');
      say(!failed, `Field Report is now in step: ${n('created')} created, ${n('updated')} changed, ${n('same')} already the same${failed ? `, ${failed} failed (see below)` : ''}.`);
    }
  } catch (err) {
    say(false, `${dry ? 'Could not compare' : 'Not synced'}: ${err.message}`);
  }
  busy = false;
  store.notify();
}

/** What a sync would send, as a fingerprint: it changes when a project or who is linked to it changes. */
function signature() {
  const { projects, users, regions } = inputs();
  const people = users.map(u => [u.email, (u.projects || []).slice().sort()]);
  return fingerprint(projects.filter(p => p.fieldCode).map(p => fieldProjectOf(p, { regions }))) + JSON.stringify(people).length + people.map(x => x[0] + x[1].join('')).join('|').length;
}

/**
 * Called after each draw. When "keep in step" is on, something changed since the last sync and the Admin is signed in,
 * the sync runs by itself a few seconds later (and not again for five minutes after a failure).
 */
export function autoSync() {
  if (!autoOn() || busy || !configured() || !store.isAdmin || store.readOnly || !store.projects.some(p => p.fieldCode)) return;
  if (signature() === get(SIG_KEY) || Date.now() - failedAt < 5 * 60 * 1000) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await run(false);
    if (said && !said.ok) failedAt = Date.now();
  }, 6000);
}

export function body() {
  const auto = autoOn();
  const rows = table?.rows || [];
  const country = id => { const p = store.projects.find(x => x.id === id); return p ? countryOf(p, store.global.regions) : ''; };
  return html`
    <section class="card set-box">
      <h3>All projects, the same in Field Report <span class="muted">Central Hub is the source</span></h3>
      <p class="muted">What is set for a project here (name, client, site, activities, working week, non-working dates, on hold) is created or changed in Field Report's list of projects, which the Field Report app shows on the desktop and on phones. Change it here, not there. Field Report keeps its own working hours, report day and coordinates. Who sees a project there is the people linked to it here (their email goes in its linked list): nothing else gives access.</p>
      <div class="actions left">
        <button class="btn" type="button" data-act="compareProjects" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : 'Compare with Field Report'}</button>
        <button class="btn primary" type="button" data-act="syncProjects" ${busy ? 'disabled' : ''}>Sync all projects now</button>
        <label class="check"><input type="checkbox" data-chg="autoSync" ${auto ? 'checked' : ''}> Keep Field Report in step automatically</label>
      </div>
      ${said ? html`<p class="callout ${said.ok ? 'ok' : 'bad'}" role="status"><b>${said.ok ? '✓' : '✗'}</b> <span>${said.text}</span></p>` : ''}
      ${auto ? html`<p class="muted">On: a few seconds after a project or the people linked to it change, this browser sends it to Field Report. It works while this browser is open and signed in as the Admin.</p>` : ''}
      <table class="table compact">
        <thead><tr><th>Project</th><th>Code</th><th>Country</th><th class="r">Linked there</th><th>State</th></tr></thead>
        <tbody>${store.projects.map(p => {
          const r = rows.find(x => x.id === p.id);
          const [word, tone] = r ? WORDS[r.action] || [r.action, ''] : ['Not compared yet', ''];
          return html`<tr>
            <td><b>${p.name}</b></td>
            <td>${p.fieldCode || html`<span class="muted">none</span>`}${r?.source === 'built-in' ? html` <span class="chip" title="Built into the Field Report script. The first sync adopts it, and Central Hub manages it from then on.">built-in</span>` : ''}</td>
            <td><input class="narrow" maxlength="3" value="${p.fieldCc || r?.heldCc || country(p.id)}" data-chg="fieldCc" data-id="${p.id}" data-fk="fcc-${p.id}" aria-label="Country code of ${p.name}" placeholder="ETH" title="Three letters, for example ETH. Field Report files the project's reports under it: change it only if it is wrong."></td>
            <td class="r">${r?.linkedCount ?? html`<span class="muted">—</span>`}</td>
            <td><span class="chip ${tone}">${word}</span>${r?.changes?.length ? html` <span class="muted">${r.changes.map(c => c.label).join(', ')}</span>` : ''}${r?.note ? html`<br><span class="${r.action === 'failed' || r.action === 'skipped' ? 'bad' : 'muted'}">${r.note}</span>` : ''}</td>
          </tr>`;
        })}</tbody>
      </table>
      ${table?.extra?.length ? html`
        <h3>In Field Report only</h3>
        <p class="muted">Field Report has these projects, but no project here uses their code. Nothing is removed unless you ask.</p>
        <ul class="list">${table.extra.map(x => html`<li class="split"><span><b>${x.code}</b> ${x.name || ''}</span><button class="btn ghost small" type="button" data-act="removeFromField" data-code="${x.code}">Remove from Field Report</button></li>`)}</ul>` : ''}
      <h3>Why can this email see which projects?</h3>
      <p class="muted">Type a Google email to see, for every project, whether Field Report shows it to that person and why. A person who sees a project that is not theirs, or none of theirs, is explained here.</p>
      <form data-form="whoCheck" class="entry">
        <input type="email" name="email" value="${who.email}" placeholder="name@gmail.com" required aria-label="Email to check" class="wide">
        <button class="btn">Check this email</button>
      </form>
      ${who.error ? html`<p class="callout bad"><b>✗</b> <span>${who.error}</span></p>` : ''}
      ${who.rows ? html`<table class="table compact">
        <thead><tr><th>Project</th><th>Status</th><th>Linked list</th><th>Sees it</th><th>Why</th></tr></thead>
        <tbody>${who.rows.map(r => { const e = explainLink(r); return html`<tr>
          <td><b>${r.code}</b> ${r.name || ''}</td><td>${r.status || ''}</td><td>${r.inLinked ? 'In it' : r.hasLinked ? 'Not in it' : 'Empty'}</td>
          <td><span class="chip ${r.visible ? (e.tone === 'warn' ? 'warn' : 'ok') : ''}">${r.visible ? 'Yes' : 'No'}</span></td><td class="${e.tone === 'warn' ? 'bad' : 'muted'}">${e.text}</td></tr>`; })}</tbody>
      </table>` : ''}
      <p class="muted">Removing a project from Field Report takes it off the shared list only. Its Drive folders and reports stay. The last project cannot be removed.</p>
    </section>`;
}

export const submits = {
  /** Ask Field Report why an email can or cannot see each project. */
  async whoCheck(fd) {
    const email = String(fd.get('email') || '').trim().toLowerCase();
    who = { email, rows: null, error: '' };
    if (!configured()) { who.error = 'Fill in the Field Report web app URL and manager key first (Field Report tab, step 1).'; store.notify(); return false; }
    try { who.rows = await linkCheck(email); }
    catch (err) { who.error = err.message; }
    store.notify();
    return false;
  },
};

export const actions = {
  compareProjects() { return run(true); },
  syncProjects() { return run(false); },
  async removeFromField(el) {
    const code = el.dataset.code;
    if (!confirm(`Remove ${code} from Field Report's list of projects?\n\nIts Drive folders and reports stay. The site can no longer pick it in the Field Report app.`)) return;
    try { await removeProject(code); say(true, `${code} was removed from Field Report's list.`); await run(true); }
    catch (err) { say(false, err.message); }
  },
};

export const changes = {
  autoSync(el) {
    put(AUTO_KEY, el.checked ? '1' : '0');
    if (el.checked) { put(SIG_KEY, ''); failedAt = 0; }
    tell(el.checked ? '✓ Field Report will be kept in step automatically.' : '✓ Automatic sync is off.');
  },
  /** The three-letter country Field Report files the project under. */
  fieldCc(el) { store.patchProject(el.dataset.id, { fieldCc: el.value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) }); },
};
