// The Field Report connection, shown under Settings: which Field Report project
// feeds the open Central Hub project, and where its receiver script is.
// Every button answers on the page, in green (it worked) or red (it did not), and with a short message at the top.

import { store } from '../core/store.js';
import { fieldConfig, fieldServer, buildSetup, sendSetup, fetchSetup, countsOf, probeConnection, judgeConnection, linkCheck } from '../sync/fieldreport.js';
import { todayISO } from '../core/util.js';
import { tell } from '../core/image.js';
import { html } from './dom.js';
import { toTrash } from '../engine/trash.js';
import { titleOf } from '../engine/titles.js';

let connecting = false;
let sending = false;
let assigning = false;
let clash = null;   // { projectId, code, otherId, otherName }: a code typed here that another project still holds
// What was typed in the connection form and is not saved yet. Nothing is applied until "Save and test".
let draft = {};
// The last answer of each button, for the project that was open: { projectId, ok, text, lines? } (ok is true or false)
const said = { connect: null, send: null, script: null, assign: null };
const say = (where, project, ok, text, lines = null, quiet = false) => { said[where] = { projectId: project.id, ok, text, lines }; if (!quiet) tell(`${ok ? '✓' : '✗'} ${text}`); store.notify(); };
const mine = (where, project) => (said[where]?.projectId === project.id ? said[where] : null);

// signed in to the cloud, the server holds the web app URL and key (1C): nothing is typed in a browser
const viaServer = () => !!fieldServer.call;
const hasLink = () => { if (viaServer()) return true; const cfg = fieldConfig.get(); return !!(cfg.url && cfg.key); };

/** True once reports can be fetched for this project. */
export const connected = project => !!(hasLink() && project?.fieldCode && project.fieldLabel);

export const summary = project => connected(project) ? `Connected to "${project.fieldLabel}"` : 'Not connected yet';

const shownCode = project => draft.code ?? project.fieldCode ?? '';
const dirty = project => {
  const cfg = fieldConfig.get();
  return (draft.url != null && draft.url.trim() !== (cfg.url || '')) || !!draft.key
    || (draft.code != null && draft.code.trim().toUpperCase() !== (project.fieldCode || ''));
};

/** A message with a mark in front: green with a tick, or red with a cross. */
const callout = r => html`<p class="callout ${r.ok ? 'ok' : 'bad'}" role="status"><b>${r.ok ? '✓' : '✗'}</b> <span>${r.text}</span></p>`;
const MARK = { true: '✓', false: '✗', warn: '!' };
const checklist = lines => html`<ul class="checks">${lines.map(l => html`
  <li class="check-${l.ok === true ? 'ok' : l.ok === false ? 'bad' : 'warn'}"><b>${MARK[l.ok]}</b><span><span class="check-label">${l.label}</span>${l.detail ? html`<span class="muted check-detail">${l.detail}</span>` : ''}</span></li>`)}</ul>`;

/** The people linked to the project in Central Hub, as the check wants them. */
const linkedOf = project => store.users.filter(u => (u.projects || []).includes(project.id)).map(u => ({ email: u.email, name: u.name || '', role: u.role, title: titleOf(u) }));

/** The connection to Field Report, in three steps: fill in and save, send the lists, set up the script. */
export function body(c) {
  const { project, ws } = c;
  if (draft.pid && draft.pid !== project.id) { draft = {}; clash = null; }   // what was typed for another project is never shown on this one
  const cfg = fieldConfig.get();
  const held = clash?.projectId === project.id ? clash : null;
  const changed = dirty(project);
  const plan = countsOf(buildSetup({ ...c, people: store.users }, c.today));
  const conn = mine('connect', project), sent = mine('send', project), script = mine('script', project), assigned = mine('assign', project);
  const ready = !!((viaServer() || ((cfg.url || draft.url) && (cfg.key || draft.key))) && shownCode(project));
  return html`
    <div class="set-cols">
      <section class="card set-box" id="panel-field">
        <h3>1. Connect <span class="muted">${summary(project)}</span></h3>
        <label>Code of ${project.name} in Field Report${project.fieldLabel ? html` <span class="muted">linked to "${project.fieldLabel}"</span>` : ''}
          <input data-chg="fieldDraft" data-f="code" data-fk="fr-code" value="${shownCode(project)}" placeholder="e.g. MJO"></label>
        ${viaServer() ? '' : html`<label>Field Report web app URL
          <input data-chg="fieldDraft" data-f="url" data-fk="fr-url" value="${draft.url ?? cfg.url ?? ''}" placeholder="Paste the link ending in /exec"></label>
        <label>Your manager key
          <input type="password" data-chg="fieldDraft" data-f="key" data-fk="fr-key" value="${draft.key || ''}" placeholder="${cfg.key ? 'Saved in this browser. Type only to change it' : 'Paste your key'}" autocomplete="off"></label>`}
        ${held ? html`<p class="callout bad"><b>✗</b> <span>Code ${held.code} is still set on "${held.otherName}", so it was not saved. A Field Report project can feed only one Central Hub project.</span></p>
          <button class="btn" type="button" data-act="takeCode">Use ${held.code} for this project instead</button>` : ''}
        <div class="actions left">
          <button class="btn primary" type="button" data-act="saveField" ${connecting ? 'disabled' : ''}>${connecting ? 'Checking…' : changed ? 'Save and check' : 'Check the connection'}</button>
          ${changed ? html`<button class="btn ghost" type="button" data-act="discardField">Discard changes</button><span class="chip warn">Not saved yet</span>` : connected(project) ? html`<span class="chip ok">Saved and connected</span>` : ''}
        </div>
        ${connecting ? html`<p class="muted">Asking Field Report…</p>` : ''}
        ${conn ? html`${callout(conn)}${conn.lines ? checklist(conn.lines) : ''}` : ''}
        ${ready || conn ? '' : html`<p class="muted">${viaServer() ? 'Enter the code' : 'Fill in the three boxes'}, then press the button. It saves ${viaServer() ? 'it' : 'them'} and checks the whole link.</p>`}
        <p class="muted">${viaServer() ? 'The code belongs to this project. The Field Report web app link and manager key are kept on the Central Hub server (Google Secret Manager), never in a browser: nothing else to fill in here.' : 'The code belongs to this project. The URL and key are the same for every project and stay in this browser, not in the shared database.'}</p>
      </section>

      <div class="set-stack">
        <section class="card set-box">
          <h3>2. Send the lists <span class="muted">${project.fieldSetupAt ? `last sent ${project.fieldSetupAt}` : 'not sent yet'}</span></h3>
          <p class="muted">Sends this project's open tasks (with who each is given to), payment milestones, team, trades and the people linked to it. Send again after changing any of them.</p>
          <ul class="plain">
            <li>${plan.tasks} open task${plan.tasks === 1 ? '' : 's'}, ${plan.milestones} milestone${plan.milestones === 1 ? '' : 's'}, ${plan.people} ${plan.people === 1 ? 'person' : 'people'} on the team, <b>${plan.linked}</b> linked by email</li>
            ${plan.tasks ? '' : html`<li class="bad">No open task in the Schedule, so Field Report has nothing to report against. Add the tasks under Overview, Schedule first.</li>`}
            ${plan.linked ? '' : html`<li class="bad">Nobody's email is linked to this project (Settings, People and access: switch the person on), so Field Report will not show it to anyone.</li>`}
            ${project.status && project.status !== 'active' ? html`<li class="bad">The project is not Active, so Field Report hides it from site people.</li>` : ''}
          </ul>
          <div class="actions left">
            <button class="btn primary" type="button" data-act="sendSetup" ${sending ? 'disabled' : ''}>${sending ? 'Sending…' : 'Send lists to Field Report'}</button>
            <button class="btn" type="button" data-act="checkSetup" ${sending ? 'disabled' : ''} title="Asks Field Report what it holds for this project, without sending anything">Check what Field Report holds</button>
          </div>
          ${sent ? callout(sent) : ''}
          <h3>Who sees it in Field Report</h3>
          <p class="muted">A person sees the project in Field Report when their email is in its linked list, and Send lists puts the people linked here (the ${plan.linked} above) there. Nothing else gives access. After sending, ask Field Report why each person can or cannot see it.</p>
          <div class="actions left"><button class="btn" type="button" data-act="whyField" ${assigning ? 'disabled' : ''}>${assigning ? 'Asking…' : 'Check who can see it'}</button></div>
          ${assigned ? html`${callout(assigned)}${assigned.lines ? checklist(assigned.lines) : ''}` : ''}
        </section>

        <section class="card set-box">
          <h3>3. The script in Field Report <span class="muted">once, by you</span></h3>
          <ol class="steps-list">
            <li>Open <b>script.google.com</b> and open the Field Report project.</li>
            <li>Click <b>+</b> next to Files, choose <b>Script</b>, name it <b>export</b>. Delete what is in it, click <button class="btn small" type="button" data-act="copyExport">Copy the export file</button> here, paste into it, press Ctrl+S.</li>
            <li>Open the main file (<b>Code.gs</b>), press Ctrl+F and search <b>reviewReport_</b>. Find the line <code>if (body.action === 'review') return reviewReport_(…)</code> inside <b>doPost</b>. Click at its end, press Enter, click <button class="btn small" type="button" data-act="copyLine">Copy the lines for doPost</button> here and paste. Press Ctrl+S.</li>
            <li>Click <b>Deploy</b>, <b>Manage deployments</b>, the pencil, set <b>Version</b> to <b>New version</b>, then <b>Deploy</b>. The link stays the same.</li>
          </ol>
          ${script ? callout(script) : ''}
          <p class="muted">If searching <b>exportReports_</b> already finds three lines in doPost, only paste the export file. Never paste the lines twice. Then press "Check the connection" in step 1: it tells you whether the script is in place.</p>
        </section>
      </div>
    </div>
    <section class="card set-box">
      <h3>4. If Field Report does not have this project <span class="muted">the message "no project with the code …"</span></h3>
      <p class="muted">From Field Report 7.21.0 projects are created and changed from Central Hub only. Open the <b>All projects</b> tab above: give this project its code in step 1 (and its country there), then press <b>Sync all projects now</b>. It is created in Field Report with the name, client, site, activities, working week, non-working dates and who sees it that you set here. Switch on <b>Keep Field Report in step automatically</b> and every later change follows by itself.</p>
      <p class="muted">If the project exists in Field Report under another code, correct the code in step 1 instead. A script older than 7.21.0 still needs the project added in the Field Report app (<b>+ Add project</b>, then <b>Publish my projects to the team</b>, tapped twice).</p>
    </section>
    ${ws.reports.some(r => r.source === 'field') ? html`
      <div class="actions left"><button class="btn danger" type="button" data-act="clearField" title="For reports pulled into the wrong project">Remove all Field Report imports from this project</button></div>` : ''}`;
}

// The same three lines as Field Report's own main script: each checks who is asking before it answers.
const EXPORT_LINE = [
  "if (body.action === 'export') { guard_(props, who, body.proj); return exportReports_(props, folderId, who, body); }",
  "if (body.action === 'setup') { needAdmin_(props, who); return setupPut_(props, folderId, who, body); }",
  "if (body.action === 'getSetup') { guard_(props, who, body.proj); return setupGet_(props, folderId, who, body); }",
].join('\n');

/** The whole link, asked of Field Report, as a checklist and one verdict. */
async function runCheck(project, c, quiet = false) {
  const cfg = fieldConfig.get();
  const code = String(project.fieldCode || '').toUpperCase();
  if (!hasLink() || !code) {
    say('connect', project, false, `Not checked. Still missing: ${[!code && 'the project code', !viaServer() && !cfg.url && 'the web app URL', !viaServer() && !cfg.key && 'the manager key'].filter(Boolean).join(', ')}.`);
    return;
  }
  connecting = true;
  said.connect = null;
  store.notify();
  try {
    const probe = await probeConnection({ code, since: todayISO(), emails: linkedOf(project).map(u => u.email) });
    const lines = judgeConnection({ code, linked: linkedOf(project), plan: countsOf(buildSetup({ ...c, people: store.users }, c.today)) }, probe);
    if (probe.exported.value && store.project.id === project.id) store.updateProject(p => { p.fieldLabel = probe.exported.value.project; });
    const bad = lines.filter(l => l.ok === false), warn = lines.filter(l => l.ok === 'warn');
    connecting = false;
    say('connect', project, !bad.length, bad.length
      ? `${bad.length} problem${bad.length === 1 ? '' : 's'} found: ${bad.map(l => l.label).join('; ')}.`
      : `Field Report is connected and ready${warn.length ? `, with ${warn.length} thing${warn.length === 1 ? '' : 's'} to look at` : ''}.`, lines, quiet);
  } catch (err) {
    connecting = false;
    say('connect', project, false, err.message);
  }
}

/** What Field Report says it holds, read back after a send or on request. */
async function checked(project, sent) {
  const code = String(project.fieldCode || '').toUpperCase();
  const back = await fetchSetup(code);
  if (!back) return { ok: false, text: `Field Report holds nothing for ${code} yet. The lists were not stored: check the code, and that the three lines are in doPost.` };
  const now = countsOf(back), want = countsOf(sent);
  const same = ['tasks', 'milestones', 'people', 'linked'].every(k => now[k] === want[k]);
  const line = `Field Report holds ${now.tasks} tasks, ${now.milestones} milestones, ${now.people} people, ${now.linked} linked${back.updated ? `, sent ${back.updated}` : ''}.`;
  if (!now.tasks) return { ok: false, text: `${line} There are no tasks, so the site has nothing to report against.` };
  return same ? { ok: true, text: line } : { ok: false, text: `${line} Central Hub now has ${want.tasks} tasks, ${want.milestones} milestones, ${want.people} people, ${want.linked} linked: send again.` };
}

/**
 * Ask Field Report, person by person, why each linked person can or cannot see the project. The only thing that lets a person
 * see a project in Field Report is their email in its linked list, which Send lists puts there.
 */
async function runWhy(project, auto = false) {
  const code = String(project.fieldCode || '').toUpperCase();
  const why = needSettings(project);
  if (why) { say('assign', project, false, why); return; }
  const people = linkedOf(project);
  if (!people.length) { say('assign', project, false, 'Nobody is linked to this project in Central Hub (Settings, People and access: switch the person on), so nobody can see it in Field Report.', null, auto); return; }
  assigning = true;
  said.assign = null;
  store.notify();
  try {
    const answers = await Promise.all(people.map(async u => {
      try { return { u, row: (await linkCheck(u.email)).find(x => String(x.code || '').toUpperCase() === code) }; }
      catch (err) { return { u, error: err.message }; }
    }));
    assigning = false;
    const lines = answers.map(({ u, row, error }) => ({
      ok: error ? 'warn' : !!row?.visible,
      label: `${u.name || u.email} ${error ? 'could not be checked' : row?.visible ? `can see ${code}` : `cannot see ${code}`}`,
      detail: error || (row ? row.why || '' : `Field Report does not list ${code} for this email.`),
    }));
    const bad = lines.filter(l => l.ok === false).length;
    say('assign', project, !bad, bad ? `${bad} of ${lines.length} linked ${bad === 1 ? 'person cannot' : 'people cannot'} see ${code} in Field Report yet.` : `Everyone linked can see ${code} in Field Report.`, lines, auto && !bad);
  } catch (err) {
    assigning = false;
    say('assign', project, false, `Could not check: ${err.message}`);
  }
}

const needSettings = project => {
  const cfg = fieldConfig.get();
  const missing = [!project.fieldCode && 'the project code', !viaServer() && !cfg.url && 'the web app URL', !viaServer() && !cfg.key && 'the manager key'].filter(Boolean);
  return missing.length ? `Fill in step 1 first. Still missing: ${missing.join(', ')}.` : '';
};

export const actions = {
  async copyExport(el, c) {
    try {
      const res = await fetch('apps-script/field-report-export.gs', { cache: 'no-store' });
      if (!res.ok) throw new Error('the file could not be read');
      await navigator.clipboard.writeText(await res.text());
      say('script', c.project, true, 'Export file copied. Paste it into a script file named "export" in the Field Report project.');
    } catch (err) {
      say('script', c.project, false, `Not copied: ${err.message}.`);
    }
  },
  async copyLine(el, c) {
    try {
      await navigator.clipboard.writeText(EXPORT_LINE);
      say('script', c.project, true, 'Three lines copied. Paste them inside doPost, on new lines below the one that contains reviewReport_.');
    } catch {
      say('script', c.project, false, `Not copied. Copy it by hand: ${EXPORT_LINE}`);
    }
  },
  /** Apply what was typed (code, URL, key), then check the whole link. */
  async saveField(el, c) {
    if (connecting) return;
    const project = c.project;
    const cfg = fieldConfig.get();
    const code = shownCode(project).trim().toUpperCase();
    const url = (draft.url ?? cfg.url ?? '').trim();
    const key = draft.key ? draft.key.trim() : cfg.key || '';
    const other = code && store.projects.find(p => p.id !== project.id && p.fieldCode === code);
    if (other) {
      clash = { projectId: project.id, code, otherId: other.id, otherName: other.name };
      tell(`✗ Code ${code} is already used by "${other.name}".`);
      store.notify();
      return;
    }
    clash = null;
    if (!viaServer()) fieldConfig.set({ ...cfg, url, key });
    if (code !== (project.fieldCode || '')) store.updateProject(p => { p.fieldCode = code; p.fieldLabel = ''; });
    draft = {};
    await runCheck({ ...project, fieldCode: code }, c);
  },
  /** Ask Field Report why each linked person can or cannot see this project. */
  async whyField(el, c) { if (!assigning) await runWhy(c.project); },
  discardField() { draft = {}; clash = null; said.connect = null; },
  /** Give Field Report the lists of this project, so the site picks a task and a person and does not type them; then ask it what it now holds. */
  async sendSetup(el, c) {
    if (sending) return;
    const project = c.project;
    const why = needSettings(project);
    if (why) { say('send', project, false, why); return; }
    sending = true;
    said.send = null;
    store.notify();
    try {
      const setup = buildSetup({ ...c, people: store.users }, c.today);
      await sendSetup(setup);
      store.updateProject(p => { p.fieldSetupAt = c.today; });
      const back = await checked(project, setup);
      sending = false;
      say('send', project, back.ok, `Sent ${setup.tasks.length} tasks, ${setup.milestones.length} milestones, ${setup.crew.length} people, ${setup.linked.length} linked. ${back.text}`);
      await runWhy(project, true);
      await runCheck(project, c, true);   // step 1 shows the new state
    } catch (err) {
      sending = false;
      say('send', project, false, `Not sent: ${err.message}`);
    }
  },
  /** Ask Field Report what it holds for this project, and compare it with what Central Hub would send now. */
  async checkSetup(el, c) {
    if (sending) return;
    const project = c.project;
    const why = needSettings(project);
    if (why) { say('send', project, false, why); return; }
    sending = true;
    said.send = null;
    store.notify();
    try {
      const back = await checked(project, buildSetup({ ...c, people: store.users }, c.today));
      sending = false;
      say('send', project, back.ok, back.text);
    } catch (err) {
      sending = false;
      say('send', project, false, err.message);
    }
  },

  /** Move a Field Report code from the project that holds it to this one. */
  takeCode(el, c) {
    if (clash?.projectId !== c.project.id) return;
    const { code, otherId, otherName } = clash;
    store.patchProject(otherId, { fieldCode: '', fieldLabel: '' });
    store.updateProject(p => { p.fieldCode = code; p.fieldLabel = ''; });
    clash = null;
    say('connect', c.project, true, `Code ${code} now belongs to this project. Reports already pulled into "${otherName}" are still there: open that project and use "Remove all Field Report imports".`);
  },

  /** Undo an import into the wrong project: its field reports, the follow-ups they opened, and the link to the code. */
  clearField(el, c) {
    const n = c.ws.reports.filter(r => r.source === 'field').length;
    if (!confirm(`Remove the ${n} Field Report import(s) and the follow-ups they opened from "${c.project.name}"?\n\nNothing is deleted in Field Report or Drive, so they can be pulled again into the right project.`)) return;
    store.update(ws => {
      // into the recycle bin, not gone: they stay there 30 days
      const who = { by: store.user?.email || '', byName: store.profile.name || store.user?.name || 'Admin' };
      for (const r of ws.reports.filter(x => x.source === 'field')) ws.trash.push(toTrash(r, ws, who));
      ws.reports = ws.reports.filter(r => r.source !== 'field');
      ws.items = ws.items.filter(i => !i.id.startsWith('fr_'));
      // trades the import listed with no rate, as long as nothing else uses them
      const used = new Set(ws.reports.flatMap(r => (r.manpower || []).map(m => m.trade)));
      for (const [trade, rate] of Object.entries(ws.laborRates)) if (!rate && !used.has(trade) && !(trade in ws.billRates)) delete ws.laborRates[trade];
    });
    store.updateProject(p => { p.fieldCode = ''; p.fieldLabel = ''; });
    say('connect', c.project, true, 'Imports removed and the code cleared. Open the right project and enter the code there.');
  },
};

export const changes = {
  /** Typing only fills the form: nothing is applied until Save and test. */
  fieldDraft(el) {
    draft = { ...draft, pid: store.project.id, [el.dataset.f]: el.dataset.f === 'code' ? el.value.trim().toUpperCase() : el.value };
    clash = null;
  },
};
