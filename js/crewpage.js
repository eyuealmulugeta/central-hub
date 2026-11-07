// v0.33.0: the crew form a person opens from their link (crew.html?l=<link>). Nobody signs in: knowing the link is
// what lets a person leave their form (one form for a one-person link, as many as come for a crew link, until it
// runs out). The Fayda ID or passport is read on the phone and fills the fields; the person checks and sends.
// See engine/crewform.js for the records and firestore.rules (crewlinks, crewforms) for what the link allows.

import { firebaseConfig } from './config.js';
import { readText } from './core/textread.js';
import { pictureFor } from './core/image.js';
import { linkState, readFayda, readPassport, fillForm, formMissing, formRecord, formIdOf, TRADES, NATIONALITIES, FORM_PHOTO, FORM_ID } from './engine/crewform.js';

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
const blank = () => ({ doc: 'fayda', nationality: 'Ethiopian' });

const field = (label, key, type = 'text', extra = '') => `<label>${esc(label)}<input type="${type}" data-k="${key}" value="${esc(form[key] || '')}" ${extra}></label>`;
const choose = (label, key, list) => `<label>${esc(label)}<select data-k="${key}"><option value="">Choose…</option>${list.map(([v, t]) => `<option value="${esc(v)}" ${form[key] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
const shot = (label, key, capture, cls = '') => `<div class="shot ${cls}">${esc(label)}${form[key] ? `<img src="${form[key]}" alt="${esc(label)}">` : '<div class="empty">No picture yet</div>'}
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
    <h2>1. Your Fayda ID *</h2>
    <p class="muted">Take a straight, well-lit picture of each side. The name, number, date of birth and the rest are read from the card.</p>
    <div class="shots">${shot('Front *', 'idFront', 'environment') + shot('Back *', 'idBack', 'environment')}</div>
    <h2>Passport (optional)</h2>
    <p class="muted">Only if you have one: the page with your photo, with the two lines of letters at the bottom showing.</p>
    <div class="shots">${shot('Photo page', 'passportImage', 'environment')}</div>
    ${said ? `<p class="note">${esc(said)}</p>` : ''}
  </div>
  <div class="card">
    <h2>2. Your photo *</h2>
    <div class="shots">${shot('Face, looking at the camera', 'photo', 'user', 'face')}</div>
  </div>
  <div class="card">
    <h2>3. Your details</h2>
    <p class="muted">Check what was read and fill in the rest. Everything marked * is needed to finish the registration.</p>
    <div class="grid">
      ${field('Full name *', 'name', 'text', 'autocomplete="name"')}
      ${choose('Trade *', 'trade', trades.map(t => [t, t]))}
      ${field('Phone *', 'phone', 'tel', 'autocomplete="tel"')}
      ${choose('Gender *', 'gender', [['male', 'Male'], ['female', 'Female']])}
      ${field('Date of birth *', 'birthday', 'date')}
      ${choose('Nationality *', 'nationality', NATIONALITIES.map(n => [n, n]))}
      ${field('Fayda number (FAN) *', 'idNumber', 'text', 'inputmode="numeric"') + field('FIN *', 'fin', 'text', 'inputmode="numeric"')}
      ${field('Passport number (optional)', 'passportNumber') + field('Passport expiry (optional)', 'passportExpiry', 'date')}
      ${field('Address *', 'address')}
      ${field('Highest certificate * (write None if none)', 'certificate')}
      ${field('Emergency contact name *', 'emergency')}
      ${field('Emergency contact phone *', 'emergencyPhone', 'tel')}
    </div>
    <label class="check"><input type="checkbox" id="agree" ${form.agree ? 'checked' : ''}><span>I agree that Amistad Prefab keeps these details and pictures for my employment records.</span></label>
    ${said && /^(Write|Take|Choose|Check|The )/.test(said) ? `<p class="bad">${esc(said)}</p>` : ''}
    <div class="row"><button type="button" class="primary" id="send" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : 'Send to the office'}</button></div>
  </div>`;
}

app.addEventListener('input', e => { const k = e.target.dataset.k; if (k) form[k] = e.target.value; if (e.target.id === 'agree') form.agree = e.target.checked; });
app.addEventListener('change', async e => {
  const k = e.target.dataset.k;
  if (k) { form[k] = e.target.value; return; }
  if (e.target.id === 'agree') { form.agree = e.target.checked; return; }
  const key = e.target.dataset.shot, file = e.target.files?.[0];
  if (!key || !file) return;
  busy = true; said = key === 'photo' ? '' : 'Reading the document. The first time can take a minute.'; draw();
  try {
    form[key] = (await pictureFor(file, key === 'photo' ? FORM_PHOTO : FORM_ID)).dataUrl;
    if (key !== 'photo') {
      draw();
      const text = await readText(file, { mrz: key === 'passportImage' });
      const facts = key === 'passportImage' ? readPassport(text) : readFayda(text);
      const { patch, filled } = fillForm(form, facts);
      Object.assign(form, patch);
      said = filled.length ? `Read from the ${key === 'passportImage' ? 'passport' : 'card'}: ${filled.join(', ')}. Please check them.` : `Nothing could be read from this picture. Take it again straight and in good light, or type the details below.`;
    }
  } catch (err) { said = err.message || 'The picture could not be used.'; }
  busy = false; draw();
});
app.addEventListener('click', async e => {
  const doc = e.target.closest('[data-doc]')?.dataset.doc;
  if (doc) { form.doc = doc; said = ''; return draw(); }
  if (e.target.id === 'again') { form = blank(); said = ''; return draw(); }
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
