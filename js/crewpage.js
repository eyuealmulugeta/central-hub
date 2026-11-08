// v0.33.0: the crew form a person opens from their link (crew.html?l=<link>). Nobody signs in: knowing the link is
// what lets a person leave their form (one form for a one-person link, as many as come for a crew link, until it
// runs out). The Fayda ID or passport is read on the phone and fills the fields; the person checks and sends.
// See engine/crewform.js for the records and firestore.rules (crewlinks, crewforms) for what the link allows.

import { firebaseConfig } from './config.js';
import { readDoc } from './core/textread.js';
import { liveScan } from './core/camscan.js';
import { pictureFor } from './core/image.js';
import { scanSource, scanOf, fileOf, readCopies } from './core/docscan.js';
import { linkState, readScore, parseDoc, scoreFacts, mergeReads, readDone, formKeyOf, SURE, fillForm, formMissing, formRecord, formIdOf, docOf, isEthiopian, TRADES, NATIONALITIES, FORM_PHOTO, FORM_ID } from './engine/crewform.js';

const FIREBASE = '10.12.2';
const BASE = 'company/main';
const params = new URLSearchParams(location.search);
const linkId = params.get('l') || '';
const local = !firebaseConfig || params.has('local');
const app = document.getElementById('app');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const show = (title, text, cls = '') => { app.innerHTML = `<div class="card"><h1>${esc(title)}</h1><p class="${cls}">${esc(text)}</p></div>`; };

// ---- where the records are: the shared database, or this browser in the demo ----

async function openData() {
  if (local) {
    const read = () => { try { return JSON.parse(localStorage.getItem('sf:company')) || {}; } catch { return {}; } };
    return {
      link: async id => (read().crewlinks || []).find(r => r.id === id) || null,
      send: async rec => {
        const co = read();
        if ((co.crewforms || []).some(f => f.id === rec.id)) throw new Error('This link was already used.');
        (co.crewforms ||= []).push(rec); localStorage.setItem('sf:company', JSON.stringify(co));
      },
    };
  }
  const sdk = name => import(`https://www.gstatic.com/firebasejs/${FIREBASE}/firebase-${name}.js`);
  const [{ initializeApp }, F] = await Promise.all([sdk('app'), sdk('firestore-lite')]);
  const db = F.getFirestore(initializeApp(firebaseConfig));
  return {
    link: async id => { const snap = await F.getDoc(F.doc(db, `${BASE}/crewlinks/${id}`)); return snap.exists() ? snap.data() : null; },
    send: rec => F.setDoc(F.doc(db, `${BASE}/crewforms/${rec.id}`), rec),
  };
}

// ---- the form ----

let data, link, form, busy = false, said = '', sent = 0;
/** v1.15.0: each document picture's source and how it was straightened, for Fix corners and Turn. */
let scans = {}, fixing = null;
/** v1.16.0: how sure each read field is (0-100), and the fields the person has confirmed. Kept in the draft. */
let conf = {}, okd = {}, dupOk = '', checkOk = false, restored = '';
const blank = () => ({ doc: 'fayda', nationality: '' });   // v1.15.0: the country is chosen first

/** v1.16.0: a read field shows how sure it is: Read (green), or Check (amber) with a Correct button until confirmed. */
const low = key => conf[key] != null && conf[key] < SURE && !okd[key] && !!String(form[key] || '').trim();
const mark = key => (conf[key] == null || !String(form[key] || '').trim() ? '' : low(key)
  ? ` <span class="rd low">Check</span> <button type="button" class="okbtn" data-ok="${key}">Correct</button>` : ' <span class="rd ok">✓ Read</span>');
const field = (label, key, type = 'text', extra = '') => `<label class="${low(key) ? 'lowf' : ''}">${esc(label)}${mark(key)}<input type="${type}" data-k="${key}" value="${esc(form[key] || '')}" ${extra}></label>`;
const choose = (label, key, list) => `<label class="${low(key) ? 'lowf' : ''}">${esc(label)}${mark(key)}<select data-k="${key}"><option value="">Choose…</option>${list.map(([v, t]) => `<option value="${esc(v)}" ${form[key] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
const shot = (label, key, capture, cls = '') => `<div class="shot ${cls} ${key === 'photo' ? '' : 'doc'}">${esc(label)}${form[key] ? `<img src="${form[key]}" alt="${esc(label)}">` : '<div class="empty">No picture yet</div>'}
  ${scans[key] ? `<div class="pick"><button type="button" class="btn" data-fix="${key}">Fix corners</button><button type="button" class="btn" data-turn="${key}">Turn</button></div>` : ''}
  <div class="pick">${key === 'photo' ? '' : `<button type="button" class="btn" data-live="${key}">${form[key] ? 'Scan again' : 'Scan'}</button>`}<label class="btn" ${key === 'photo' ? '' : 'hidden'}>${form[key] ? 'Take again' : 'Camera'}<input type="file" accept="image/*" capture="${capture}" data-shot="${key}" id="cap-${key}" hidden></label>` +
  // v0.83.0 (owner): a picture already on the phone (no capture: the phone's gallery or files)
  `<label class="btn">Gallery<input type="file" accept="image/*" data-shot="${key}" hidden></label></div></div>`;

function draw() {
  const list = Array.isArray(link.trades) && link.trades.length ? link.trades : TRADES;   // v0.57.0: the directory's list, carried by the link
  const trades = [...list, ...(form.trade && !list.includes(form.trade) ? [form.trade] : [])];
  app.innerHTML = `<div class="card">
    <h1>Crew form</h1>
    ${link.note ? `<p class="bad"><b>The office asks for changes:</b> ${esc(link.note)}</p>` : ''}
    ${restored ? `<p class="note">Your form not yet sent (${esc(restored)}) was brought back. <button type="button" id="fresh">Start again</button></p>` : ''}
    <p class="muted">For ${esc(link.projectName || 'Amistad Prefab')}${link.byName ? `, from ${esc(link.byName)}` : ''}. ${link.kind !== 'one' ? 'Fill in one form per person; after sending, the form is empty for the next one.' : 'One form, for you.'}${sent ? ` <b class="ok">${sent} sent from this phone.</b>` : ''}</p>
  </div>
  <div class="card">
    <h2>1. Your nationality *</h2>
    <label><select data-k="nationality" data-redraw="1"><option value="">Choose your country…</option>${NATIONALITIES.map(([v, t]) => `<option value="${esc(v)}" ${form.nationality === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
  </div>
  ${form.nationality ? idCard() : ''}
  <div class="card">
    <h2>3. Your photo *</h2>
    <div class="shots">${shot('Face, looking at the camera', 'photo', 'user', 'face')}</div>
  </div>
  <div class="card">
    <h2>4. Your details</h2>
    <p class="muted">Check what was read and fill in the rest. Everything marked * is needed to finish the registration.</p>
    <div class="grid">
      ${field('Full name *', 'name', 'text', 'autocomplete="name"')}
      ${choose('Trade *', 'trade', trades.map(t => [t, t]))}
      ${field('Phone *', 'phone', 'tel', 'autocomplete="tel"')}
      ${choose('Gender *', 'gender', [['male', 'Male'], ['female', 'Female']])}
      ${field('Date of birth *', 'birthday', 'date')}
      ${numbers()}
      ${field('Address *', 'address')}
      ${field('Highest certificate * (write None if none)', 'certificate')}
      ${field('Emergency contact name *', 'emergency')}
      ${field('Emergency contact phone *', 'emergencyPhone', 'tel')}
    </div>
    <label class="check"><input type="checkbox" id="agree" ${form.agree ? 'checked' : ''}><span>I agree that Amistad Prefab keeps these details and pictures for my employment records.</span></label>
    ${said && /^(Write|Take|Choose|Check|The |Tick)/.test(said) ? `<p class="bad">${esc(said)}</p>` : ''}
    <div class="row"><button type="button" class="primary" id="send" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : 'Send to the office'}</button></div>
  </div>${fixing ? fixer() : ''}`;
  if (fixing) placeHandles();
}

/** v1.15.0 (owner, 8 Nov): step 2, the ID of the chosen country: the Fayda ID for Ethiopians, else that country's ID card or passport. */
function idCard() {
  const d = docOf(form), tip = 'Hold it flat on a plain, darker surface in good light. The picture is straightened, cropped at the edges and evened out by itself, and the numbers are read into the fields below.';
  return `<div class="card">
    <h2>2. Your ID *</h2>
    ${d === 'fayda' ? `<p class="muted">Fayda ID, both sides. ${tip}</p>
      <div class="shots">${shot('Front *', 'idFront', 'environment') + shot('Back *', 'idBack', 'environment')}</div>
      <h2>Passport (optional)</h2>
      <p class="muted">Only if you have one: the page with your photo, with the two lines of letters at the bottom showing.</p>
      <div class="shots">${shot('Photo page', 'passportImage', 'environment')}</div>`
    : `<div class="seg"><button type="button" data-doc="id" class="${d === 'id' ? 'on' : ''}">National ID card</button><button type="button" data-doc="passport" class="${d === 'passport' ? 'on' : ''}">Passport</button></div>
      <p class="muted">${d === 'id' ? 'Your country\'s ID card: the front, and the back if it has writing or the lines of letters.' : 'The page with your photo, with the two lines of letters at the bottom showing.'} ${tip}</p>
      <div class="shots">${d === 'id' ? shot('Front *', 'idFront', 'environment') + shot('Back', 'idBack', 'environment') : shot('Photo page *', 'passportImage', 'environment')}</div>`}
    ${said ? `<p class="note">${esc(said)}</p>` : ''}
  </div>`;
}
/** The numbers of the chosen document. */
function numbers() {
  const d = docOf(form);
  if (d === 'fayda') return field('Fayda number (FAN) *', 'idNumber', 'text', 'inputmode="numeric"') + field('FIN *', 'fin', 'text', 'inputmode="numeric"')
    + field('Passport number (optional)', 'passportNumber') + field('Passport expiry (optional)', 'passportExpiry', 'date');
  if (d === 'id') return field('ID number *', 'idNumber') + field('ID expiry', 'idExpiry', 'date');
  return field('Passport number *', 'passportNumber') + field('Passport expiry', 'passportExpiry', 'date');
}

// ---- v1.15.0: straightening a document picture: automatic, with Fix corners (drag the four corners) and Turn

const kindOf = key => (key === 'passportImage' ? 'passport' : docOf(form) === 'fayda' ? 'fayda' : 'id');
/** Make the scan of a picture, keep it on the form, and read it. */
async function useScan(key, { upright = false } = {}) {
  const s = scans[key];
  const pass = key === 'passportImage', which = pass ? 'passport' : docOf(form);
  // v1.16.0: each scan is read from a grey copy, and again from a black-on-white copy when something is missing or unsure
  const once = async img => {
    const r = await readDoc([img], { mrz: pass || which === 'id', sparse: !pass });
    const facts = parseDoc(r.text, which);
    return { facts, conf: scoreFacts(facts, r.words, which), score: readScore(r.text) };
  };
  const at = turns => { const scan = scanOf(s.source, { quad: s.quad, turns, kind: kindOf(key) }); return { scan, turns, copies: readCopies(scan) }; };
  let pick = at(s.turns);
  form[key] = (await pictureFor(await fileOf(pick.scan), FORM_ID)).dataUrl;
  said = 'Reading the document. The first time can take a minute.'; draw();
  let r = await once(pick.copies.grey);
  if (upright && r.score < 3) {   // v1.15.0: upside down? the other way round is read too and the better kept
    const flip = at((s.turns + 2) % 4), rf = await once(flip.copies.grey);
    if (rf.score > r.score) { r = rf; pick = flip; s.turns = flip.turns; form[key] = (await pictureFor(await fileOf(flip.scan), FORM_ID)).dataUrl; }
  }
  if (!readDone(r, which)) { said = 'Reading again, more closely…'; draw(); r = mergeReads(r, await once(pick.copies.bw)); }
  for (const [k, v] of Object.entries(s.filled || {})) if (form[k] === v) { form[k] = ''; delete conf[k]; delete okd[k]; }   // what this picture filled before is read again
  const { patch, filled } = fillForm(form, r.facts);
  s.filled = patch;
  Object.assign(form, patch);
  for (const [fk, c] of Object.entries(r.conf)) { const k = formKeyOf(fk, which); if (k in patch) conf[k] = c; }
  const unsure = Object.keys(patch).filter(k => conf[k] < SURE).length;
  const blur = pick.copies.sharp < 15 ? ' The picture looks blurred: if a number is wrong, scan it again holding still.' : '';
  said = filled.length ? `${s.source.auto ? 'Straightened and read' : 'Read'}: ${filled.join(', ')}.${unsure ? ` ${unsure} marked Check: compare ${unsure > 1 ? 'them' : 'it'} with the card.` : ' Please check them.'}${blur}`
    : `Nothing could be read from this picture. ${s.source.auto ? 'Try Turn if it is on its side, or' : 'Use Fix corners to mark the document\'s corners, or'} scan it again flat and in good light, or type the details below.${blur}`;
  saveDraft();
}

/** v1.16.0: a document picture (live camera, camera or gallery): straightened, kept, read. */
async function takeDoc(key, file, quad = null) {
  busy = true; said = 'Straightening the picture…'; draw();
  try {
    const source = await scanSource(file, { quad });
    scans[key] = { source, quad: source.quad, turns: 0 };
    await useScan(key, { upright: true });
  } catch (err) { said = err.message || 'The picture could not be used.'; }
  busy = false; draw();
}

// ---- v1.16.0 (owner, 8 Nov): drafts on this phone: a form not yet sent is kept and comes back when the link is opened again

const DB = () => new Promise((res, rej) => { const r = indexedDB.open('crewform', 1); r.onupgradeneeded = () => r.result.createObjectStore('drafts'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function draftOp(mode, fn) {
  try {
    const db = await DB();
    return await new Promise((res, rej) => { const t = db.transaction('drafts', mode), q = fn(t.objectStore('drafts')); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); });
  } catch { return null; }
}
const hasInput = f => !!f && Object.entries(f).some(([k, v]) => k !== 'doc' && k !== 'nationality' && v && String(v).trim());
let draftTimer = 0;
function saveDraft(now = false) {
  clearTimeout(draftTimer);
  const put = () => (hasInput(form) ? draftOp('readwrite', s => s.put({ form, conf, okd, at: Date.now() }, linkId)) : null);
  if (now) put(); else draftTimer = setTimeout(put, 700);
}
const dropDraft = () => draftOp('readwrite', s => s.delete(linkId));
addEventListener('pagehide', () => saveDraft(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveDraft(true); });
function fixer() {
  return `<div class="fixer" role="dialog" aria-label="Fix corners"><div class="fixbox"><p><b>Drag the four dots onto the corners of the document.</b></p>
    <div class="fixarea"><img id="fiximg" src="${fixing.url}" alt="">${[0, 1, 2, 3].map(i => `<span class="dot" data-dot="${i}"></span>`).join('')}</div>
    <div class="row"><button type="button" class="primary" id="fixok">Use these corners</button><button type="button" id="fixno">Cancel</button></div></div></div>`;
}
function placeHandles() {
  const img = document.getElementById('fiximg');
  if (!img) return;
  const put = () => {
    const r = img.getBoundingClientRect(), a = img.parentElement.getBoundingClientRect(), k = r.width / fixing.w;
    if (!r.width) return requestAnimationFrame(put);
    document.querySelectorAll('[data-dot]').forEach(el => { const [x, y] = fixing.quad[+el.dataset.dot]; el.style.left = `${r.left - a.left + x * k}px`; el.style.top = `${r.top - a.top + y * k}px`; });
  };
  if (img.complete && img.naturalWidth) put(); else img.onload = put;
}
app.addEventListener('pointerdown', e => {
  const dot = e.target.closest('[data-dot]');
  if (!dot || !fixing) return;
  e.preventDefault();
  const img = document.getElementById('fiximg'), i = +dot.dataset.dot;
  dot.setPointerCapture(e.pointerId);
  const move = ev => {
    const r = img.getBoundingClientRect(), k = fixing.w / r.width;
    fixing.quad[i] = [Math.min(fixing.w - 1, Math.max(0, (ev.clientX - r.left) * k)), Math.min(fixing.h - 1, Math.max(0, (ev.clientY - r.top) * k))];
    placeHandles();
  };
  const up = () => { dot.removeEventListener('pointermove', move); dot.removeEventListener('pointerup', up); };
  dot.addEventListener('pointermove', move); dot.addEventListener('pointerup', up);
});

app.addEventListener('input', e => { const k = e.target.dataset.k; if (k) { form[k] = e.target.value; if (conf[k] != null) okd[k] = true; } if (e.target.id === 'agree') form.agree = e.target.checked; saveDraft(); });   // v1.16.0: typed = checked
app.addEventListener('change', async e => {
  const k = e.target.dataset.k;
  if (k) {
    form[k] = e.target.value;
    if (conf[k] != null) { okd[k] = true; draw(); }
    saveDraft();
    if (e.target.dataset.redraw) {   // v1.15.0: the country decides the document
      if (!isEthiopian(form) && form.doc === 'fayda') { form.doc = 'id'; form.fin = ''; }
      if (isEthiopian(form)) form.doc = 'fayda';
      said = ''; draw();
    }
    return;
  }
  if (e.target.id === 'agree') { form.agree = e.target.checked; return; }
  const key = e.target.dataset.shot, file = e.target.files?.[0];
  if (!key || !file) return;
  e.target.value = '';
  if (key !== 'photo') return takeDoc(key, file);   // v1.15.0 (owner): straightened, cropped at the edges and evened out before it is kept and read
  busy = true; said = ''; draw();
  try { form[key] = (await pictureFor(file, FORM_PHOTO)).dataUrl; saveDraft(); } catch (err) { said = err.message || 'The picture could not be used.'; }
  busy = false; draw();
});
app.addEventListener('click', async e => {
  const live = e.target.closest('[data-live]')?.dataset.live;
  if (live && !busy) {   // v1.16.0: the live camera with the guide frame; the phone's own camera where it cannot open
    try {
      const got = await liveScan({ kind: kindOf(live), title: live === 'passportImage' ? 'Passport photo page' : live === 'idBack' ? 'Back of the ID' : 'Front of the ID' });
      if (got) await takeDoc(live, got.file, got.quad);
    } catch { document.getElementById(`cap-${live}`)?.click(); }
    return;
  }
  const ok = e.target.closest('[data-ok]')?.dataset.ok;
  if (ok) { okd[ok] = true; saveDraft(); return draw(); }
  if (e.target.id === 'fresh') { form = blank(); conf = {}; okd = {}; scans = {}; restored = ''; said = ''; dropDraft(); return draw(); }
  const fix = e.target.closest('[data-fix]')?.dataset.fix, turn = e.target.closest('[data-turn]')?.dataset.turn;
  if ((fix || turn) && busy) return;
  if (fix) {   // v1.15.0: the corners on the original picture
    const s = scans[fix];
    fixing = { key: fix, url: s.source.canvas.toDataURL('image/jpeg', 0.8), w: s.source.w, h: s.source.h, quad: s.quad.map(p => [...p]) };
    return draw();
  }
  if (e.target.id === 'fixno') { fixing = null; return draw(); }
  if (e.target.id === 'fixok' || turn) {
    const key = turn || fixing.key, s = scans[key];
    if (turn) s.turns = (s.turns + 1) % 4; else { s.quad = fixing.quad; s.source.auto = false; fixing = null; }
    busy = true; draw();
    try { await useScan(key); } catch (err) { said = err.message || 'The picture could not be used.'; }
    busy = false; return draw();
  }
  const doc = e.target.closest('[data-doc]')?.dataset.doc;
  if (doc) { form.doc = doc; said = ''; return draw(); }
  if (e.target.id === 'again') { dupOk = ''; said = ''; return draw(); }   // v1.16.0: already emptied when sent   // v1.15.0: the next person, same country
  if (e.target.id !== 'send' || busy) return;
  const missing = formMissing(form) || (form.agree ? '' : 'Tick that you agree, then send.');
  if (missing) { said = missing; draw(); document.getElementById('send')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  // v1.16.0: every field that was hard to read is checked by the person before the form goes; never sent by itself
  const unsure = Object.keys(conf).filter(low);
  if (unsure.length) { said = 'Check the fields marked Check (they were hard to read): correct them, or press Correct if they are right.'; draw(); document.querySelector('.lowf')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  // v1.16.0: the same ID already sent from this phone
  const num = String(form.idNumber || form.passportNumber || '').trim(), mine = (() => { try { return JSON.parse(localStorage.getItem(`crew-sent-${linkId}`)) || []; } catch { return []; } })();
  const twin = num && mine.find(x => x.n === num);
  if (twin && dupOk !== num) { dupOk = num; said = `The ID number ${num} was already sent from this phone (${twin.name}). Press Send again to send it anyway.`; draw(); return; }
  busy = true; draw();
  try {
    await data.send(formRecord(form, { id: formIdOf(link), link: link.id }));
    sent++;
    // v1.16.0: sent: the draft goes, and the form is emptied so closing the page keeps nothing (the country stays for the next person)
    const who = form.name;
    clearTimeout(draftTimer); dropDraft();
    form = { ...blank(), nationality: form.nationality, doc: form.doc }; conf = {}; okd = {}; scans = {}; restored = '';
    try { localStorage.setItem(`crew-sent-${linkId}`, JSON.stringify([...mine, { n: num, name: who }].slice(-200))); } catch { /* private window */ }
    if (link.kind === 'one') return show('Thank you', 'Your form is with the office of Amistad Prefab. You can close this page.', 'ok');
    app.innerHTML = `<div class="card"><h1>Sent</h1><p class="ok">${esc(who)} is with the office (${sent} from this phone).</p><div class="row"><button type="button" class="primary" id="again">Fill in the next person</button></div></div>`;
  } catch (err) {
    said = /permission|insufficient/i.test(err.message) ? 'The form could not be sent: this link was used already or has run out. Ask for a new one.' : `Not sent: ${err.message}. Check the connection and press Send again.`;
    busy = false; draw();
  }
  busy = false;
});

(async () => {
  if (!linkId) return show('No link', 'Open the link you were sent, all of it.', 'bad');
  try {
    data = await openData();
    link = await data.link(linkId);
    const why = linkState(link);
    if (why) return show('Crew form', why, 'bad');
    form = blank();
    const d = await draftOp('readonly', s => s.get(linkId));   // v1.16.0: the form not yet sent comes back
    if (d && hasInput(d.form)) { form = { ...blank(), ...d.form }; conf = d.conf || {}; okd = d.okd || {}; restored = `${new Date(d.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${form.name ? `, ${form.name}` : ''}`; }
    draw();
  } catch (err) { show('Crew form', `The form could not be opened: ${err.message}`, 'bad'); }
})();
