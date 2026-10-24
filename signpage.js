// The page a signer opens from their link (sign.html?r=<request>&k=<key>).
// Nobody signs in here: knowing the link is what lets a person read the one
// document and leave the one signature. See engine/sign.js for the records.

import { firebaseConfig } from './config.js';
import { sha256, MAX_IMAGE_CHARS } from './engine/sign.js';

const FIREBASE = '10.12.2';
const PDF_JS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const BASE = 'company/main';

const params = new URLSearchParams(location.search);
const requestId = params.get('r') || '';
const key = params.get('k') || '';
const local = !firebaseConfig || params.has('local');
const app = document.getElementById('app');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = iso => new Date(iso).toLocaleString([], { dateStyle: 'long', timeStyle: 'short' });
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const show = (title, text, cls = '') => { app.innerHTML = `<div class="card"><h1>${esc(title)}</h1><p class="${cls}">${esc(text)}</p></div>`; };

// ---- where the records are: the shared database, or this browser in the demo ----

async function openData() {
  if (local) {
    const read = () => { try { return JSON.parse(localStorage.getItem('sf:company')) || {}; } catch { return {}; } };
    return {
      request: async id => (read().signs || []).find(r => r.id === id) || null,
      signature: async k => (read().signed || []).find(s => s.id === k) || null,
      part: async (id, i) => localStorage.getItem(`sf:signfile:${id}_${i}`) || '',
      sign: async rec => { const co = read(); (co.signed ||= []).push(rec); localStorage.setItem('sf:company', JSON.stringify(co)); },
    };
  }
  const sdk = name => import(`https://www.gstatic.com/firebasejs/${FIREBASE}/firebase-${name}.js`);
  const [{ initializeApp }, F] = await Promise.all([sdk('app'), sdk('firestore-lite')]);
  const db = F.getFirestore(initializeApp(firebaseConfig));
  const get = async path => { const snap = await F.getDoc(F.doc(db, path)); return snap.exists() ? snap.data() : null; };
  return {
    request: id => get(`${BASE}/signs/${id}`),
    signature: k => get(`${BASE}/signed/${k}`),
    part: async (id, i) => (await get(`${BASE}/signfiles/${id}_${i}`))?.data || '',
    sign: rec => F.setDoc(F.doc(db, `${BASE}/signed/${rec.id}`), rec),
  };
}

// ---- the document ----

const loadScript = src => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('load'));
  document.head.append(s);
});

async function showPdf(data, req, holder) {
  let base64 = '';
  for (let i = 0; i < req.chunks; i++) base64 += await data.part(req.id, i);
  if (!base64) throw new Error('The document could not be read. Ask the sender for a new link.');
  const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
  // what is shown must be what was sent: compare with the fingerprint taken when the request was made
  if (req.hash && await sha256(bytes) !== req.hash) throw new Error('The document does not match the one that was sent. Do not sign; tell the sender.');
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  holder.innerHTML = `<p class="no-print"><a href="${url}" target="_blank" rel="noopener" download="${esc(req.fileName)}">Open or download ${esc(req.fileName)}</a></p><div class="pages" id="pages"><p class="muted">Loading the pages…</p></div>`;
  const pages = holder.querySelector('#pages');
  // the pages are drawn in the background: signing does not wait for a long document to finish
  drawPages(bytes, pages);
}

async function drawPages(bytes, pages) {
  try {
    await loadScript(PDF_JS);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
    const pdf = await window.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    pages.textContent = '';
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      pages.append(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
  } catch {
    pages.innerHTML = '<p class="muted">The pages could not be shown here. Use the link above to open the document, read it, then come back to sign.</p>';
  }
}

// ---- the signature pad ----

function pad(canvas, wrap) {
  const ctx = canvas.getContext('2d');
  let drawing = false, drawn = false;
  const fit = () => {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#10243a';
    drawn = false; wrap.classList.remove('drawn');
  };
  const at = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => { drawing = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...at(e)); e.preventDefault(); });
  canvas.addEventListener('pointermove', e => { if (!drawing) return; ctx.lineTo(...at(e)); ctx.stroke(); drawn = true; wrap.classList.add('drawn'); });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  fit();
  return {
    clear: fit,
    get drawn() { return drawn; },
    /** A PNG no wider than 600 px, so it stays small enough to store. */
    image() {
      const out = document.createElement('canvas');
      const scale = Math.min(1, 600 / canvas.width);
      out.width = canvas.width * scale; out.height = canvas.height * scale;
      out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    },
  };
}

// ---- the page ----

function signedCard(rec) {
  return `<div class="card"><h2>Signed</h2><p class="ok">${esc(rec.name)} signed this document on ${esc(when(rec.at))}.</p>
    <img class="sig" src="${esc(rec.image)}" alt="Signature">
    <p class="muted" style="margin-top:10px">You can close this page. The sender has your signature and will send you the signed copy.</p>
    <div class="row no-print"><button type="button" onclick="print()">Print this page</button></div></div>`;
}

async function start() {
  if (!requestId || !key) { show('This link is not complete', 'Open the link exactly as it was sent to you.', 'bad'); return; }
  let data, req;
  try {
    data = await openData();
    req = await data.request(requestId);
  } catch {
    show('The document could not be opened', 'Check the internet connection and open the link again.', 'bad');
    return;
  }
  if (!req) { show('This link no longer works', 'The request was withdrawn, or the link is not the one that was sent. Ask the sender for a new one.', 'bad'); return; }
  // the request holds only the SHA-256 of each signer's key
  const hash = await sha256(key);
  const me = (req.signers || []).find(p => p.keyHash === hash);
  if (!me) { show('This link no longer works', 'It does not belong to anyone who was asked to sign. Ask the sender for a new one.', 'bad'); return; }

  document.getElementById('from').textContent = req.from || 'Amistad Prefab';
  document.title = `Sign: ${req.title}`;
  app.innerHTML = `
    <div class="card"><h1>${esc(req.title)}</h1>
      <p class="muted">${esc(req.from || 'Amistad Prefab')} asks ${esc(me.name)} to sign this document${req.ref ? ` (contract ${esc(req.ref)})` : ''}.</p></div>
    <div class="card" id="doc"><p class="muted">Loading the document…</p></div>
    <div id="act"></div>`;
  const doc = document.getElementById('doc');
  const act = document.getElementById('act');
  let readable = true;
  try {
    if (req.kind === 'pdf') await showPdf(data, req, doc);
    else doc.innerHTML = `<div class="doc-text">${esc(req.text)}</div>`;
  } catch (err) {
    readable = false;
    doc.innerHTML = `<p class="bad">${esc(err.message)}</p>`;
  }

  const existing = await data.signature(key).catch(() => null);
  if (existing) { act.innerHTML = signedCard(existing); return; }
  if (!readable) return;
  if (req.status === 'cancelled') { act.innerHTML = '<div class="card"><p class="bad">This request was cancelled by the sender. It can no longer be signed.</p></div>'; return; }
  if (req.validUntil && req.validUntil < today()) { act.innerHTML = `<div class="card"><p class="bad">This request expired on ${esc(req.validUntil)}. Ask the sender for a new one.</p></div>`; return; }

  act.innerHTML = `
    <form class="card" id="form">
      <h2>Sign as ${esc(me.name)}</h2>
      <label>Your full name <input type="text" id="name" value="${esc(me.name)}" required maxlength="120" autocomplete="name"></label>
      <div class="pad-wrap" id="wrap"><canvas id="pad"></canvas></div>
      <div class="row"><button type="button" id="clear">Clear</button><span class="muted">Use a finger, a pen or the mouse.</span></div>
      <label class="check"><input type="checkbox" id="agree" required> <span>I have read the document above and I agree to sign it electronically. I understand this signature has the same purpose as my handwritten one.</span></label>
      <div class="row"><button class="primary" id="go">Sign the document</button><span id="msg" class="bad"></span></div>
    </form>`;
  const sig = pad(document.getElementById('pad'), document.getElementById('wrap'));
  document.getElementById('clear').addEventListener('click', () => sig.clear());
  document.getElementById('form').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = document.getElementById('msg');
    const name = document.getElementById('name').value.trim();
    if (!name) { msg.textContent = 'Type your full name.'; return; }
    if (!sig.drawn) { msg.textContent = 'Draw your signature in the box first.'; return; }
    const image = sig.image();
    if (image.length > MAX_IMAGE_CHARS) { msg.textContent = 'The signature is too detailed to store. Press Clear and draw it again, more simply.'; return; }
    const rec = { id: key, request: req.id, name, image, at: new Date().toISOString(), agent: navigator.userAgent.slice(0, 200) };
    document.getElementById('go').disabled = true;
    msg.textContent = '';
    try {
      await data.sign(rec);
      act.innerHTML = signedCard(rec);
      act.scrollIntoView({ behavior: 'smooth' });
    } catch {
      document.getElementById('go').disabled = false;
      msg.textContent = 'The signature could not be saved. Check the internet connection and press Sign again.';
    }
  });
}

start();
