// v0.77.0: the page a consultant opens from a site instruction link (siteinst.html?k=<link>). Nobody signs in:
// knowing the link lets a person read that one instruction and answer it once (sign it, or comment).
// See engine/siteinstr.js for the records.

import { firebaseConfig } from './config.js';
import { MAX_IMAGE_CHARS } from './engine/sign.js';
import { pad } from './signpad.js';

const FIREBASE = '10.12.2';
const BASE = 'company/main';
const params = new URLSearchParams(location.search);
const key = params.get('k') || '';
const local = !firebaseConfig || params.has('local');
const app = document.getElementById('app');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = iso => new Date(iso).toLocaleString([], { dateStyle: 'long', timeStyle: 'short' });
const show = (title, text, cls = '') => { app.innerHTML = `<div class="card"><h1>${esc(title)}</h1><p class="${cls}">${esc(text)}</p></div>`; };

async function openData() {
  if (local) {
    const get = p => { try { return JSON.parse(localStorage.getItem(`sf:doc:${p}`)); } catch { return null; } };
    return {
      link: async k => get(`${BASE}/silinks/${k}`),
      answer: async k => get(`${BASE}/sisigned/${k}`),
      send: async rec => localStorage.setItem(`sf:doc:${BASE}/sisigned/${rec.id}`, JSON.stringify(rec)),
    };
  }
  const sdk = name => import(`https://www.gstatic.com/firebasejs/${FIREBASE}/firebase-${name}.js`);
  const [{ initializeApp }, F] = await Promise.all([sdk('app'), sdk('firestore-lite')]);
  const db = F.getFirestore(initializeApp(firebaseConfig));
  const get = async path => { const snap = await F.getDoc(F.doc(db, path)); return snap.exists() ? snap.data() : null; };
  return { link: k => get(`${BASE}/silinks/${k}`), answer: k => get(`${BASE}/sisigned/${k}`), send: rec => F.setDoc(F.doc(db, `${BASE}/sisigned/${rec.id}`), rec) };
}

const answered = rec => `<div class="card"><h2>${rec.decision === 'comment' ? 'Comment sent' : 'Signed'}</h2>
  <p class="ok">${esc(rec.name)} ${rec.decision === 'comment' ? 'commented on' : 'signed'} this instruction on ${esc(when(rec.at))}.</p>
  ${rec.comment ? `<p>${esc(rec.comment)}</p>` : ''}<img class="sig" src="${esc(rec.image)}" alt="Signature">
  <p class="muted" style="margin-top:10px">You can close this page. Amistad Prefab has your answer.</p>
  <div class="row no-print"><button type="button" onclick="print()">Print this page</button></div></div>`;

async function start() {
  if (key.length < 40) { show('This link is not complete', 'Open the link exactly as it was sent to you.', 'bad'); return; }
  let data, x;
  try { data = await openData(); x = await data.link(key); }
  catch { show('The instruction could not be opened', 'Check the internet connection and open the link again.', 'bad'); return; }
  if (!x) { show('This link no longer works', 'Ask Amistad Prefab for a new one.', 'bad'); return; }
  document.title = `${x.no} · ${x.subject}`;
  const facts = [['Project', x.project], ['Date', x.date], ['From', x.from], ['To', x.to], ['Location', x.zone], ['Reply by', x.dueBy], ['Changes cost or time', x.costTime ? 'Yes' : 'No']].filter(([, v]) => v);
  app.innerHTML = `
    <div class="card"><h1>Site instruction ${esc(x.no)}</h1><p class="muted">${esc(x.subject)}</p>
      <dl>${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="doc-text">${esc(x.text)}</div>
      ${(x.photos || []).length ? `<div class="photos" style="margin-top:12px">${x.photos.map(p => `<img src="${esc(p)}" alt="">`).join('')}</div>` : ''}</div>
    <div id="act"></div>`;
  const act = document.getElementById('act');
  const done = await data.answer(key).catch(() => null);
  if (done) { act.innerHTML = answered(done); return; }
  if (x.status !== 'sent') { act.innerHTML = '<div class="card"><p class="bad">This instruction is closed. It can no longer be answered here.</p></div>'; return; }
  act.innerHTML = `
    <form class="card" id="form">
      <h2>Your answer</h2>
      <label>Your full name <input type="text" id="name" value="${esc(x.from)}" required maxlength="120" autocomplete="name"></label>
      <label>Comment (optional) <textarea id="comment" maxlength="2000" placeholder="Only if something should be corrected"></textarea></label>
      <div class="pad-wrap" id="wrap"><canvas id="pad"></canvas></div>
      <div class="row"><button type="button" id="clear">Clear</button><span class="muted">Use a finger, a pen or the mouse.</span></div>
      <label class="check"><input type="checkbox" id="agree"> <span>This is the instruction I gave. I sign it electronically; this signature has the same purpose as my handwritten one.</span></label>
      <div class="row"><button class="primary" id="go">Sign the instruction</button><button type="button" id="note">Send only the comment</button><span id="msg" class="bad"></span></div>
    </form>`;
  const sig = pad(document.getElementById('pad'), document.getElementById('wrap'));
  document.getElementById('clear').addEventListener('click', () => sig.clear());
  const send = async decision => {
    const msg = document.getElementById('msg');
    const name = document.getElementById('name').value.trim(), comment = document.getElementById('comment').value.trim();
    if (!name) { msg.textContent = 'Type your full name.'; return; }
    if (decision === 'comment' && !comment) { msg.textContent = 'Write the comment first.'; return; }
    if (!sig.drawn) { msg.textContent = 'Draw your signature in the box first.'; return; }
    if (decision === 'signed' && !document.getElementById('agree').checked) { msg.textContent = 'Tick the box to agree.'; return; }
    const image = sig.image();
    if (image.length > MAX_IMAGE_CHARS) { msg.textContent = 'The signature is too detailed to store. Press Clear and draw it again, more simply.'; return; }
    const rec = { id: key, name, image, comment, decision, at: new Date().toISOString(), agent: navigator.userAgent.slice(0, 200) };
    document.getElementById('go').disabled = true; msg.textContent = '';
    try { await data.send(rec); act.innerHTML = answered(rec); act.scrollIntoView({ behavior: 'smooth' }); }
    catch { document.getElementById('go').disabled = false; msg.textContent = 'The answer could not be saved. Check the internet connection and try again.'; }
  };
  document.getElementById('form').addEventListener('submit', e => { e.preventDefault(); send('signed'); });
  document.getElementById('note').addEventListener('click', () => send('comment'));
}

start();
