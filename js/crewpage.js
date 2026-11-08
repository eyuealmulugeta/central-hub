// v0.33.0: the crew form a person opens from their link (crew.html?l=<link>). Nobody signs in: knowing the link is
// what lets a person leave their form (one form for a one-person link, as many as come for a crew link, until it
// runs out). The Fayda ID or passport is read on the phone and fills the fields; the person checks and sends.
// See engine/crewform.js for the records and firestore.rules (crewlinks, crewforms) for what the link allows.

import { firebaseConfig } from './config.js';
import { readText } from './core/textread.js';
import { pictureFor } from './core/image.js';
import { scanSource, scanOf, fileOf } from './core/docscan.js';
import { linkState, readFayda, readPassport, readId, readScore, fillForm, formMissing, formRecord, formIdOf, docOf, isEthiopian, TRADES, NATIONALITIES, FORM_PHOTO, FORM_ID } from './engine/crewform.js';

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
const blank = () => ({ doc: 'fayda', nationality: '' });   // v1.15.0: the country is chosen first

const field = (label, key, type = 'text', extra = '') => `<label>${esc(label)}<input type="${type}" data-k="${key}" value="${esc(form[key] || '')}" ${extra}></label>`;
const choose = (label, key, list) => `<label>${esc(label)}<select data-k="${key}"><option value="">Choose…</option>${list.map(([v, t]) => `<option value="${esc(v)}" ${form[key] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
const shot = (label, key, capture, cls = '') => `<div class="shot ${cls} ${key === 'photo' ? '' : 'doc'}">${esc(label)}${form[key] ? `<img src="${form[key]}" alt="${esc(label)}">` : '<div class="empty">No picture yet</div>'}
  ${scans[key] ? `<div class="pick"><button type="button" class="btn" data-fix="${key}">Fix corners</button><button type="button" class="btn" data-turn="${key}">Turn</button></div>` : ''}
  <div class="pick"><label class="btn">${form[key] ? 'Take again' : 'Camera'}<input type="file" accept="image/*" capture="${capture}" data-shot="${key}" hidden></label>` +
  // v0.83.0 (owner): a picture already on the phone (no capture: the phone's gallery or files)
  `<label class="btn">Gallery<input type="file" accept="image/*" data-shot="${key}" hidden></label></div></div>`;

function draw() {
  const list = Array.isArray(link.trades) && link.trades.length ? link.trades : TRADES;   // v0.57.0: the directory's list, carried by the link
  const trades = [...list, ...(form.trade && !list.includes(form.trade) ? [form.trade] : [])];
  app.innerHTML = `<div class="card">
    <h1>Crew form</h1>
    ${link.note ? `<p class="bad"><b>The office asks for changes:</b> ${esc(link.note)}</p>` : ''}
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
    ${said && /^(Write|Take|Choose|Check|The )/.test(said) ? `<p class="bad">${esc(said)}</p>` : ''}
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
  const pass = key === 'passportImage', d = docOf(form);
  const readAt = async turns => {
    const file = await fileOf(scanOf(s.source, { quad: s.quad, turns, kind: kindOf(key) }));
    const text = await readText(file, { mrz: pass || d === 'id' });
    return { file, text, turns, score: readScore(text) };
  };
  const shown = await fileOf(scanOf(s.source, { quad: s.quad, turns: s.turns, kind: kindOf(key) }));
  form[key] = (await pictureFor(shown, FORM_ID)).dataUrl;
  said = 'Reading the document. The first time can take a minute.'; draw();
  let best = await readAt(s.turns);
  if (upright && best.score < 3) {   // v1.15.0: upside down? the other way round is read too and the better kept
    const flip = await readAt((s.turns + 2) % 4);
    if (flip.score > best.score) { best = flip; s.turns = flip.turns; form[key] = (await pictureFor(flip.file, FORM_ID)).dataUrl; }
  }
  const text = best.text;
  const facts = pass ? (readPassport(text) || readId(text)) : d === 'fayda' ? readFayda(text) : readId(text);
  for (const [k, v] of Object.entries(s.filled || {})) if (form[k] === v) form[k] = '';   // what this picture filled before is read again
  const { patch, filled } = fillForm(form, facts);
  s.filled = patch;
  Object.assign(form, patch);
  said = filled.length ? `${s.source.auto ? 'Straightened and read' : 'Read'}: ${filled.join(', ')}. Please check them.`
    : `Nothing could be read from this picture. ${s.source.auto ? 'Try Turn if it is on its side, or' : 'Use Fix corners to mark the document\'s corners, or'} take it again straight and in good light, or type the details below.`;
}
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

app.addEventListener('input', e => { const k = e.target.dataset.k; if (k) form[k] = e.target.value; if (e.target.id === 'agree') form.agree = e.target.checked; });
app.addEventListener('change', async e => {
  const k = e.target.dataset.k;
  if (k) {
    form[k] = e.target.value;
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
  busy = true; said = key === 'photo' ? '' : 'Reading the document. The first time can take a minute.'; draw();
  try {
    if (key === 'photo') form[key] = (await pictureFor(file, FORM_PHOTO)).dataUrl;
    else {   // v1.15.0 (owner): straightened, cropped at the edges and evened out before it is kept and read
      said = 'Straightening the picture…'; draw();
      const source = await scanSource(file);
      scans[key] = { source, quad: source.quad, turns: 0 };
      await useScan(key, { upright: true });
    }
  } catch (err) { said = err.message || 'The picture could not be used.'; }
  busy = false; draw();
});
app.addEventListener('click', async e => {
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
  if (e.target.id === 'again') { form = { ...blank(), nationality: form.nationality, doc: form.doc }; scans = {}; said = ''; return draw(); }   // v1.15.0: the next person, same country
  if (e.target.id !== 'send' || busy) return;
  const missing = formMissing(form) || (form.agree ? '' : 'Tick that you agree, then send.');
  if (missing) { said = missing; draw(); document.getElementById('send')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  busy = true; draw();
  try {
    await data.send(formRecord(form, { id: formIdOf(link), link: link.id }));
    sent++;
    if (link.kind === 'one') return show('Thank you', 'Your form is with the office of Amistad Prefab. You can close this page.', 'ok');
    app.innerHTML = `<div class="card"><h1>Sent</h1><p class="ok">${esc(form.name)} is with the office (${sent} from this phone).</p><div class="row"><button type="button" class="primary" id="again">Fill in the next person</button></div></div>`;
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
    draw();
  } catch (err) { show('Crew form', `The form could not be opened: ${err.message}`, 'bad'); }
})();
