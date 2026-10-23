/**
 * Addition to the Amistad Field Report receiver (drive-upload.gs v7.2) so that
 * Central Hub can read the report data the receiver already stores.
 *
 * Install:
 *   1. In the Field Report Apps Script project, add a new script file named "export"
 *      and paste this whole file into it.
 *   2. In drive-upload.gs, inside doPost, find the line
 *        if (body.action === 'review') return reviewReport_(props, folderId, who, body);
 *      and add this line directly below it:
 *        if (body.action === 'export') return exportReports_(props, folderId, who, body);
 *      and, for the project lists Central Hub sends (tasks, milestones, crew), these two as well:
 *        if (body.action === 'setup') return setupPut_(props, folderId, who, body);
 *        if (body.action === 'getSetup') return setupGet_(props, folderId, who, body);
 *   3. Deploy > Manage deployments > Edit > Version: New version > Deploy.
 *      (Editing the existing deployment keeps the same web app URL.)
 *
 * It is read-only: it creates, changes and deletes nothing.
 */

const EXPORT_MAX_REPORTS = 120;

/**
 * Managers only (same rule as 'list' and 'review').
 * Body:  { action: 'export', token: '<manager key>', proj: 'MJO', since: 'YYYY-MM-DD' }
 * Reply: { ok, proj, project, reports: [<full report data>], nowork: [<no-work notices>], more }
 *        `more` is true when older reports were left out; ask again with a later `since`.
 */
function exportReports_(props, folderId, who, body) {
  if (!isMgr_(props, who)) throw err_('FORBIDDEN', 'Only a manager can export reports.');
  const code = String(body.proj || '').toUpperCase(), pj = PROJECTS[code];
  if (!pj) throw err_('BAD_REQUEST', 'Unknown project code ' + code + '.');
  const since = /^\d{4}-\d{2}-\d{2}$/.test(String(body.since || '')) ? String(body.since) : '0000-00-00';

  const folders = DriveApp.getFolderById(folderId).getFoldersByName(pj.folder);
  const reportFiles = [], nowork = [];
  if (folders.hasNext()) {
    const all = allJson_(folders.next());
    for (let i = 0; i < all.length; i++) {
      const name = all[i].getName(), date = name.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}_/.test(name) || date < since) continue;
      if (/_NW\.json$/.test(name)) {
        try { nowork.push(JSON.parse(all[i].getBlob().getDataAsString())); } catch (x) {}
      } else {
        reportFiles.push({ date: date, file: all[i] });
      }
    }
  }

  // newest first, so a long history is cut at the old end
  reportFiles.sort(function (a, b) { return b.date.localeCompare(a.date); });
  const reports = [];
  reportFiles.slice(0, EXPORT_MAX_REPORTS).forEach(function (r) {
    try {
      const o = JSON.parse(r.file.getBlob().getDataAsString());
      o.date = r.date; // the date in the file name is the one the receiver validated
      reports.push(o);
    } catch (x) {}
  });

  log_('INFO', 'export', { who: who, proj: code, since: since, reports: reports.length, nowork: nowork.length });
  return json_({ ok: true, proj: code, project: pj.label, reports: reports, nowork: nowork, more: reportFiles.length > EXPORT_MAX_REPORTS });
}

// ---- project lists from Central Hub ----
// Central Hub stores one small file per project, "_setup.json", holding the open tasks, the payment
// milestones, the crew and the trades. The Field Report app reads it so the site picks from lists.

var SETUP_FILE = '_setup.json';
var SETUP_MAX_BYTES = 400 * 1024;

function projectFolder_(folderId, code, create) {
  const pj = PROJECTS[code];
  if (!pj) throw err_('BAD_REQUEST', 'Unknown project code ' + code + '.');
  const root = DriveApp.getFolderById(folderId);
  const found = root.getFoldersByName(pj.folder);
  if (found.hasNext()) return found.next();
  return create ? root.createFolder(pj.folder) : null;
}

/** Managers only. Body: { action: 'setup', token, proj: 'MJO', setup: { ... } } */
function setupPut_(props, folderId, who, body) {
  if (!isMgr_(props, who)) throw err_('FORBIDDEN', 'Only a manager can send the project lists.');
  const code = String(body.proj || '').toUpperCase();
  const text = JSON.stringify(body.setup || {});
  if (text.length > SETUP_MAX_BYTES) throw err_('BAD_REQUEST', 'The project lists are too large.');
  const folder = projectFolder_(folderId, code, true);
  const old = folder.getFilesByName(SETUP_FILE);
  if (old.hasNext()) old.next().setContent(text); else folder.createFile(SETUP_FILE, text, 'application/json');
  log_('INFO', 'setup', { who: who, proj: code, bytes: text.length });
  return json_({ ok: true, proj: code, bytes: text.length });
}

/** Any signed-in user of the app. Body: { action: 'getSetup', token, proj: 'MJO' }. Reply: { ok, proj, setup } (setup is null until Central Hub sends one). */
function setupGet_(props, folderId, who, body) {
  const code = String(body.proj || '').toUpperCase();
  const folder = projectFolder_(folderId, code, false);
  let setup = null;
  if (folder) {
    const f = folder.getFilesByName(SETUP_FILE);
    if (f.hasNext()) { try { setup = JSON.parse(f.next().getBlob().getDataAsString()); } catch (x) { setup = null; } }
  }
  return json_({ ok: true, proj: code, setup: setup });
}
