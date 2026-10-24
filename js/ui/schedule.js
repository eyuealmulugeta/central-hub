import { calendarOf } from '../engine/calendar.js';
import { store } from '../core/store.js';
import { wouldCycle } from '../engine/gantt.js';
import { copyTasks } from '../engine/taskcopy.js';
import { uid, toDay, fromDay, fmtDay, isWork, dow, num } from '../core/util.js';
import { html, field, options } from './dom.js';

const ROW = 34; // must match .g-row height in app.css
const DAY_W = { day: 24, week: 9 };

let selected = null;
let zoom = 'day';
let notice = '';
let todayX = 0;
// Import from another project: the panel is open while `imp` is set
let imp = null;          // { from: project id, start: date, replace: bool, tasks: null | [] (loaded), loading: bool }

/** Select a task from outside this screen (search, quick links). */
export const focusOn = id => { selected = id; };

const STATUS_LABEL = { done: 'Done', late: 'Overdue', active: 'In progress', pending: 'Not started' };

/** The Import panel, in place of the task editor: copy another project's task list into this one. */
function importPanel(c) {
  const others = store.projects.filter(p => p.id !== c.project.id);
  const n = imp.tasks?.length || 0;
  return html`<aside class="card editor" id="panel-import">
    <div class="toolbar"><h2>Import tasks</h2><span class="grow"></span><button class="btn ghost small" data-act="closeImport">Close</button></div>
    ${others.length ? html`<div class="form">
      <p class="muted">Copies the task list of another project: names, durations, quantities and the links between tasks. Who each task is given to and the progress stay with that project.</p>
      <label>From the project <select data-chg="impFrom" data-fk="imp-from">${options(others.map(p => [p.id, p.name]), imp.from)}</select></label>
      <label>The first task starts on <input type="date" data-chg="impStart" data-fk="imp-start" value="${imp.start}"></label>
      ${c.ws.tasks.length && store.isAdmin ? html`<label class="check"><input type="checkbox" data-chg="impReplace" ${imp.replace ? 'checked' : ''}> Replace the ${c.ws.tasks.length} tasks this project has (otherwise the copies are added to them)</label>` : ''}
      ${imp.tasks === null ? html`<button class="btn" data-act="loadImport" ${imp.loading ? 'disabled' : ''}>${imp.loading ? 'Reading…' : 'See what will be copied'}</button>`
        : n ? html`<p><b>${n} tasks</b> from ${store.projects.find(p => p.id === imp.from)?.name}: ${imp.tasks.slice(0, 6).map(t => t.name).join(', ')}${n > 6 ? ', …' : ''}</p>
          <button class="btn primary" data-act="runImport">${imp.replace && store.isAdmin ? 'Replace with' : 'Copy'} these ${n} tasks</button>`
        : html`<p class="muted">That project has no tasks to copy.</p>`}
    </div>` : html`<p class="empty">There is no other project to copy from.</p>`}
  </aside>`;
}

export function render(c) {
  const { sched: s, project, ws } = c;
  const wd = calendarOf(project, ws.reports);
  const T = toDay(c.today);
  const D = DAY_W[zoom];
  const from = Math.min(s.start, s.planStart, T) - 3;
  const to = Math.max(s.end, s.planEnd, T) + 10;
  const x = d => (d - from) * D;
  const W = (to - from + 1) * D;
  const days = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  todayX = x(T);

  const months = [];
  for (const d of days) {
    const key = fromDay(d).slice(0, 7);
    if (months.at(-1)?.key !== key) months.push({ key, from: d, n: 0 });
    months.at(-1).n++;
  }
  const monthLabel = key => new Date(key + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

  const index = new Map(s.rows.map((r, i) => [r.id, i]));
  const who = new Map(ws.team.map(m => [m.id, m.name]));
  const links = s.rows.flatMap(r => (r.deps || []).map(d => {
    const p = s.rows[index.get(d.id)];
    if (!p) return '';
    const x1 = x(p.ef + 1), y1 = index.get(p.id) * ROW + ROW / 2;
    const x2 = x(r.es), y2 = index.get(r.id) * ROW + ROW / 2;
    return html`<path d="M${x1} ${y1}h5V${y2}H${x2}"/>`;
  }));

  const cur = s.rows.find(r => r.id === selected);
  const canEdit = c.role !== 'site'; // Site users follow the schedule; the Office plans it
  const summary = !s.rows.length ? 'No tasks yet'
    : `Forecast finish ${fmtDay(s.end)}, ${s.slip > 0 ? `${s.slip} working days behind plan` : s.slip < 0 ? `${-s.slip} working days ahead of plan` : 'on plan'}`;

  return html`
    <div class="toolbar">
      <h2>${summary}</h2>
      <span class="legend">
        <i class="lg done"></i>Done <i class="lg active"></i>In progress <i class="lg late"></i>Overdue <i class="lg pending"></i>Not started <i class="lg plan"></i>Plan
      </span>
      <span class="grow"></span>
      <span class="muted">${notice}</span>
      <div class="seg">
        <button class="${zoom === 'day' ? 'on' : ''}" data-act="zoom" data-z="day">Days</button>
        <button class="${zoom === 'week' ? 'on' : ''}" data-act="zoom" data-z="week">Weeks</button>
      </div>
      ${canEdit ? html`<button class="btn" data-act="openImport" title="Copy the task list of another project into this one">Import</button><button class="btn primary" data-act="add">Add task</button>` : ''}
    </div>

    <section class="card flush gantt" data-scroll="gantt" style="--w:${W}px">
      <div class="g-head">
        <div class="g-corner">Task</div>
        <div class="g-time" style="width:${W}px">
          ${months.map(m => html`<span class="g-month" style="left:${x(m.from)}px;width:${m.n * D}px">${m.n * D > 60 ? monthLabel(m.key) : ''}</span>`)}
          ${days.map(d => (zoom === 'day' || dow(d) === 1) ? html`
            <span class="g-day ${isWork(d, wd) ? '' : 'off'}" style="left:${x(d)}px;width:${zoom === 'day' ? D : D * 7}px">${+fromDay(d).slice(8)}</span>` : '')}
        </div>
      </div>
      <div class="g-body">
        <div class="g-overlay" style="width:${W}px;height:${s.rows.length * ROW}px">
          ${days.filter(d => !isWork(d, wd)).map(d => html`<i class="g-off" style="left:${x(d)}px;width:${D}px"></i>`)}
          <svg width="${W}" height="${s.rows.length * ROW}">${links}</svg>
          <i class="g-today" style="left:${x(T) + D / 2}px"></i>
        </div>
        ${s.rows.map(r => html`
          <div class="g-row ${r.id === selected ? 'sel' : ''}" data-act="select" data-id="${r.id}">
            <div class="g-name">
              <i class="dot ${r.status}"></i>
              <span class="g-title ${r.critical ? 'crit' : ''}">${r.name}</span>
              ${who.has(r.assigneeId) ? html`<small class="who" title="Assigned to ${who.get(r.assigneeId)}">${who.get(r.assigneeId)}</small>` : ''}
              <span class="muted">${r.milestone ? '◆' : r.progress + '%'}</span>
            </div>
            <div class="g-track" style="width:${W}px">
              <i class="g-plan" style="left:${x(r.planEs)}px;width:${(r.planEf - r.planEs + 1) * D}px"></i>
              ${r.milestone
                ? html`<b class="g-ms ${r.status}" style="left:${x(r.es) + D / 2 - 8}px" title="${r.name}: ${fmtDay(r.es)}"></b>`
                : html`<b class="g-bar ${r.status}" style="left:${x(r.es)}px;width:${(r.ef - r.es + 1) * D}px"
                    title="${r.name}: ${fmtDay(r.es)} to ${fmtDay(r.ef)}, ${r.progress}%"><i style="width:${r.progress}%"></i></b>`}
              ${r.slip > 0 && r.progress < 100 ? html`<span class="g-slip" style="left:${x(r.ef + 1) + 6}px">+${r.slip} d</span>` : ''}
            </div>
          </div>`)}
        ${s.rows.length ? '' : !canEdit ? html`<div class="empty pad"><p>No tasks yet. The Office adds them.</p></div>` : html`<div class="empty pad">
          <p>No tasks yet. Add them one by one with "Add task", or use Import to copy the task list of another project and edit it.</p>
        </div>`}
      </div>
    </section>

    ${imp && canEdit ? importPanel(c) : cur ? html`
      <aside class="card editor">
        <div class="toolbar"><h2>Task</h2><span class="grow"></span><button class="btn ghost small" data-act="close">Close</button></div>
        <fieldset class="bare" ${canEdit ? '' : 'disabled'}><div class="form">
          <label>Name <input data-chg="task" data-f="name" data-fk="t-name" value="${cur.name}"></label>
          <div class="grid2">
            <label>Planned start <input type="date" data-chg="task" data-f="start" data-fk="t-start" value="${cur.start}"></label>
            <label>Duration (days) <input type="number" min="1" data-chg="task" data-f="duration" data-fk="t-dur" value="${cur.duration}" ${cur.milestone ? 'disabled' : ''}></label>
            <label>Total quantity <input type="number" min="0" step="any" data-chg="task" data-f="totalQty" data-fk="t-qty" value="${cur.totalQty || ''}" placeholder="e.g. 3000" ${cur.milestone ? 'disabled' : ''}></label>
            <label>Unit <input data-chg="task" data-f="unit" data-fk="t-unit" value="${cur.unit || ''}" placeholder="pcs, m², t" ${cur.milestone ? 'disabled' : ''}></label>
          </div>
          <label class="check"><input type="checkbox" data-chg="task" data-f="milestone" ${cur.milestone ? 'checked' : ''}> Milestone</label>
          <label>Assigned to
            <select data-chg="task" data-f="assigneeId" data-fk="t-who">
              <option value="">Unassigned</option>${options(ws.team.map(m => [m.id, m.role ? `${m.name}, ${m.role}` : m.name]), cur.assigneeId || null)}
            </select>
          </label>

          <h3>Starts after</h3>
          <div class="deps">${ws.tasks.filter(t => t.id !== cur.id).map(t => {
            const d = (cur.deps || []).find(d => d.id === t.id);
            return html`<div class="dep">
              <label class="check"><input type="checkbox" data-chg="dep" data-id="${t.id}" ${d ? 'checked' : ''}> ${t.name}</label>
              ${d ? html`<input class="narrow" type="number" min="0" data-chg="lag" data-id="${t.id}" data-fk="lag-${t.id}" value="${d.lag || 0}" title="Lag in working days" aria-label="Lag in working days">` : ''}
            </div>`;
          })}</div>

          <dl class="facts">
            <dt>Status</dt><dd>${STATUS_LABEL[cur.status]}${cur.critical ? ', critical' : ''}</dd>
            <dt>Plan</dt><dd>${fmtDay(cur.planEs)} to ${fmtDay(cur.planEf)}</dd>
            <dt>Forecast</dt><dd>${fmtDay(cur.es)} to ${fmtDay(cur.ef)}</dd>
            <dt>Float</dt><dd>${cur.float} working days</dd>
            ${cur.qtyTotal ? html`<dt>Installed</dt><dd>${num(cur.qtyDone)} of ${num(cur.qtyTotal)} ${cur.unit || ''}</dd>` : ''}
            <dt>Reported delay</dt><dd>${cur.delayDays} days</dd>
          </dl>
          ${cur.reasons.length ? html`<ul class="plain">${cur.reasons.map(r => html`<li class="muted">${fmtDay(toDay(r.date))}: +${r.days} d ${r.note}</li>`)}</ul>` : ''}
          <p class="muted">${cur.qtyTotal ? 'Progress is the quantity installed in daily reports divided by the total quantity.' : 'Progress is the percentage given in daily reports. Set a total quantity to have it worked out from installed quantities.'}</p>
          ${canEdit ? html`<button class="btn danger" data-act="remove">Delete task</button>` : ''}
        </div></fieldset>
      </aside>` : ''}`;
}

/** First time the view opens, bring today into view. */
export function onEnter(root) {
  const g = root.querySelector('.gantt');
  if (g) g.scrollLeft = Math.max(0, todayX - 160);
}

const task = ws => ws.tasks.find(t => t.id === selected);

export const actions = {
  select(el) { selected = el.dataset.id; notice = ''; imp = null; },
  close() { selected = null; },
  zoom(el) { zoom = el.dataset.z; },
  openImport(el, c) {
    const other = store.projects.find(p => p.id !== c.project.id);
    imp = { from: other?.id || '', start: c.project.start || c.today, replace: false, tasks: null, loading: false };
  },
  closeImport() { imp = null; },
  /** Read the chosen project's tasks to show what would be copied. */
  async loadImport() {
    if (!imp?.from) return;
    imp.loading = true;
    try { imp.tasks = await store.readTasks(imp.from); } catch (err) { imp.tasks = []; notice = `Could not read that project's tasks: ${err.message}`; }
    imp.loading = false;
    store.notify();
  },
  runImport(el, c) {
    if (!imp?.tasks?.length || c.role === 'site') return;
    const copied = copyTasks(imp.tasks, imp.start || c.today, () => uid('t'));
    const replace = imp.replace && store.isAdmin;   // replacing deletes the tasks there are: the Admin's
    const name = store.projects.find(p => p.id === imp.from)?.name || 'the other project';
    store.update(ws => { ws.tasks = replace ? copied : [...ws.tasks, ...copied]; });
    notice = `${copied.length} tasks copied from ${name}${replace ? ', replacing the ones there were' : ''}. Rename, move and delete what does not apply.`;
    imp = null;
  },
  add(el, c) {
    if (c.role === 'site') return;
    const t = { id: uid('t'), name: 'New task', start: c.today, duration: 5, milestone: false, deps: [] };
    store.update(ws => ws.tasks.push(t));
    selected = t.id;
  },
  remove(el, c) {
    const id = selected;
    const t = c.ws.tasks.find(x => x.id === id);
    if (!t || c.role === 'site') return;
    const used = c.ws.reports.filter(r => (r.entries || []).some(e => e.taskId === id)).length;
    if (!confirm(`Delete the task "${t.name}"?${used ? `\n\n${used} daily report(s) recorded progress on it. That progress no longer counts.` : ''}`)) return;
    store.update(ws => {
      ws.tasks = ws.tasks.filter(t => t.id !== id);
      for (const t of ws.tasks) t.deps = (t.deps || []).filter(d => d.id !== id);
      for (const a of ws.assemblies) if (a.taskId === id) a.taskId = '';
      for (const line of Object.values(ws.procurement)) if (line.taskId === id) line.taskId = '';
    });
    selected = null;
  },
};

export const changes = {
  impFrom(el) { if (imp) { imp.from = el.value; imp.tasks = null; } },
  impStart(el) { if (imp) imp.start = el.value; },
  impReplace(el) { if (imp) imp.replace = el.checked; },
  task(el, c) {
    const f = el.dataset.f;
    let value = field(el);
    if (c.role === 'site') return;
    if (f === 'start' && !value) return;
    if (f === 'name' && !(value = value.trim())) return;
    if (f === 'duration') value = Math.max(1, Math.round(value));
    if (f === 'totalQty') value = Math.max(0, value);
    if (f === 'unit') value = value.trim();
    store.update(ws => { task(ws)[f] = value; });
  },
  dep(el, c) {
    if (c.role === 'site') return;
    const depId = el.dataset.id;
    if (el.checked && wouldCycle(c.ws.tasks, selected, depId)) {
      notice = 'That link would make the tasks depend on each other in a loop.';
      return;
    }
    notice = '';
    store.update(ws => {
      const t = task(ws);
      t.deps = (t.deps || []).filter(d => d.id !== depId);
      if (el.checked) t.deps.push({ id: depId, lag: 0 });
    });
  },
  lag(el, c) {
    if (c.role === 'site') return;
    store.update(ws => { task(ws).deps.find(d => d.id === el.dataset.id).lag = Math.max(0, Math.round(field(el))); });
  },
};
