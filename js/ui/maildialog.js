// The "Email this" dialog, shared by every screen that can send a document.
// It sends through the Apps Script web app when that is set up (with the
// document attached as a PDF), and can always fall back to the person's own
// email app, which gets the text but no attachment.

import { sendMail, mailReady, mailtoLink, readPdf, MAX_FILES, MAX_FILE_BYTES } from '../sync/mail.js';
import { driveConfig } from '../sync/drive.js';
import { makePdf } from '../sync/share.js';
import { store } from '../core/store.js';
import { todayISO } from '../core/util.js';
import { resolveList, suggestions, remember, defaultsFor, splitList } from '../engine/contacts.js';
import { scopedCompany, currentDivision, divOf } from '../core/division.js';

const $ = id => document.getElementById(id);
let current = null;   // what the open dialog is about to send
let wired = false;
let picked = [];      // PDF files added by hand: { name, size, dataBase64 }

const megabytes = n => (n / 1024 / 1024 < 0.1 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function showFiles() {
  const list = $('mail-files');
  list.textContent = '';
  picked.forEach((f, i) => {
    const li = document.createElement('li');
    li.textContent = `${f.name}, ${megabytes(f.size)} `;
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'btn ghost small';
    drop.textContent = 'Remove';
    drop.addEventListener('click', () => { picked.splice(i, 1); showFiles(); status(''); });
    li.append(drop);
    list.append(li);
  });
}

function status(text, cls = 'muted') {
  const el = $('mail-status');
  el.textContent = text;
  el.className = cls;
}

const book = () => scopedCompany(store.company || {}, currentDivision()).contacts || [];   // the open division's contacts only

/** The addresses typed so far, written out: saved names become addresses, plain words get @gmail.com. */
function settle(id) {
  const box = $(id);
  const written = resolveList(box.value, book());
  if (written !== box.value.trim()) box.value = written;
}

/** While typing, offer the saved contacts that fit the last entry; choosing one keeps the entries before it. */
function offer(id, typed = $(id).value) {
  const value = typed;
  const before = value.includes(',') || value.includes(';') ? `${value.slice(0, Math.max(value.lastIndexOf(','), value.lastIndexOf(';')) + 1).trimEnd()} ` : '';
  $('mail-contacts').replaceChildren(...suggestions(value, book()).map(s => {
    const o = document.createElement('option');
    o.value = `${before}${s.email}`;
    o.label = s.label;
    return o;
  }));
}

/** Earlier recipients of this project that are not in the boxes: one button each to add them. */
function showQuick(before) {
  const box = $('mail-quick');
  box.replaceChildren();
  const mentioned = () => `${$('mail-to').value},${$('mail-cc').value}`.toLowerCase();
  for (const [list, field, label] of [[before.to, 'mail-to', ''], [before.cc, 'mail-cc', ' (copy)']]) {
    for (const email of list) {
      if (mentioned().includes(email)) continue;
      const name = book().find(c => String(c.email).toLowerCase() === email)?.name || email;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.textContent = `+ ${name}${label}`;
      b.title = email;
      b.addEventListener('click', () => { const el = $(field); el.value = [el.value.trim(), email].filter(Boolean).join(', '); b.remove(); });
      box.append(b);
    }
  }
}

/** Save the people this email went to, for the project that is open: next time they are filled in. */
function keepRecipients(v) {
  if (store.readOnly || !store.company) return;
  const entries = [...splitList(v.to).map(email => ({ email, as: 'to' })), ...splitList(v.cc).map(email => ({ email, as: 'cc' }))];
  if (!entries.length) return;
  // contacts are kept per division: the open division's list is updated, the other one is left as it is
  store.updateCompany(co => {
    const d = currentDivision(), all = co.contacts || [];
    const mine = all.filter(k => divOf(k) === d), rest = all.filter(k => divOf(k) !== d);
    co.contacts = [...rest, ...remember(mine, entries, { projectId: store.project?.id || '', today: todayISO() }).map(k => (k.division ? k : { ...k, division: d }))];
  });
}

function values() {
  return { to: $('mail-to').value.trim(), cc: $('mail-cc').value.trim(), subject: $('mail-subject').value.trim(), message: $('mail-message').value };
}

function wire() {
  if (wired) return;
  wired = true;
  for (const id of ['mail-to', 'mail-cc']) {
    $(id).addEventListener('input', () => offer(id));
    $(id).addEventListener('change', () => settle(id));
    $(id).addEventListener('blur', () => settle(id));
  }
  $('mail-send').addEventListener('click', async () => {
    settle('mail-to'); settle('mail-cc');
    const v = values();
    if (!v.to) { status('Enter who the email is for.', 'bad'); return; }
    if (!v.subject) { status('The email needs a subject.', 'bad'); return; }
    const job = current;
    $('mail-send').disabled = true;
    const own = !!job.getHtml && $('mail-own').checked;
    status(own ? 'Preparing the PDF and sending…' : 'Sending…');
    try {
      // the document on screen is made into the same PDF as the one sent by WhatsApp and Telegram (with the watermark); a document that is not a
      // sheet on screen, or a PDF that cannot be made here, goes through the script's own converter as before
      let html = '';
      let ownPdf = null;
      if (own) {
        const sheet = job.sheet?.();
        if (sheet) { try { ownPdf = await readPdf(await makePdf(sheet, job.filename)); } catch { /* the script makes it instead */ } }
        if (!ownPdf) html = await job.getHtml();
      }
      // replies come back to the person who pressed Send: the address set under Backup, else the one they signed in with
      const replyTo = driveConfig.get().replyTo || (store.cloud ? store.user?.email : '') || '';
      const fromName = store.profile?.name || (store.cloud ? store.user?.name : '') || '';
      const out = await sendMail({ ...v, replyTo, fromName, html, filename: job.filename, files: [...(ownPdf ? [ownPdf] : []), ...picked].map(({ name, dataBase64 }) => ({ name, dataBase64 })) });
      $('dlg-mail').close();
      keepRecipients(v);
      job.onSent?.({ to: v.to, cc: v.cc, attached: out.attached || '' });
    } catch (err) {
      status(err.message, 'bad');
    }
    $('mail-send').disabled = false;
  });
  $('mail-pick').addEventListener('change', async e => {
    const chosen = [...e.target.files];
    e.target.value = '';
    status('');
    for (const file of chosen) {
      try {
        if (picked.length >= MAX_FILES) throw new Error(`No more than ${MAX_FILES} files can be added to one email.`);
        if (picked.reduce((n, f) => n + f.size, 0) + file.size > MAX_FILE_BYTES) throw new Error(`${file.name} would take the added files over the 15 MB limit.`);
        if (picked.some(f => f.name === file.name && f.size === file.size)) continue;
        picked.push(await readPdf(file));
      } catch (err) {
        status(err.message, 'bad');
      }
    }
    showFiles();
  });
  $('mail-app').addEventListener('click', () => {
    settle('mail-to'); settle('mail-cc');
    const v = values();
    keepRecipients(v);
    location.href = mailtoLink(v);
    $('dlg-mail').close();
  });
}

/**
 * @param job.to, job.subject, job.message  starting values, all editable
 * @param job.getHtml   async () => the document as an HTML page, turned into the PDF attachment (optional)
 * @param job.sheet     () => the printable sheet on screen (.paper), made into the PDF in the browser, with the watermark (optional)
 * @param job.filename  attachment name without ".pdf"
 * @param job.onSent    called with { to, cc, attached } once the script confirms it was sent
 */
export function openMail(job) {
  wire();
  current = job;
  // the people this project's documents went to before: filled in when the screen does not already know who the email is for,
  // otherwise offered as buttons to add, so nobody is added to a document they should not get without being asked
  const before = defaultsFor(book(), store.project?.id);
  const to = job.to || before.to.join(', ');
  $('mail-to').value = to;
  $('mail-cc').value = before.cc.filter(e => !to.toLowerCase().includes(e)).join(', ');
  showQuick(before);
  $('mail-hint').textContent = before.to.length || before.cc.length ? `People are remembered per project (${store.project?.name || 'this project'}). Change them if needed.` : 'Type a saved name to find the address. A plain word gets @gmail.com. People you send to are saved.';
  offer('mail-to', '');
  $('mail-subject').value = job.subject || '';
  $('mail-message').value = job.message || '';
  const ready = mailReady();
  picked = [];
  showFiles();
  $('mail-send').hidden = !ready;
  // attachments only travel through the script; the person's own email app cannot be handed files
  $('mail-attachments').hidden = !ready;
  $('mail-own-row').hidden = !job.getHtml;
  $('mail-own').checked = !!job.getHtml;
  $('mail-own-label').textContent = `Attach this document as a PDF (${job.filename}.pdf)`;
  $('mail-attach').textContent = ready
    ? 'You can also add PDF files from this computer, for example a signed contract or a drawing. Up to 5 files, 15 MB together.'
    : 'Sending from Central Hub is not set up in this browser yet (Backup, Google Drive: web app URL and shared secret). You can still open the text in your own email app, without attachments.';
  status('');
  $('dlg-mail').showModal();
  ($('mail-to').value ? $('mail-message') : $('mail-to')).focus();
}

/** The first email address in a free-text contact such as "Nathan, nathan@example.com". */
export const emailIn = text => String(text || '').match(/[^\s,;<>()]+@[^\s,;<>()]+\.[^\s,;<>()]+/)?.[0] || '';
