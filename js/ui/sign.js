// Sign: ask people to sign an agreement electronically, from the contract it
// belongs to. Each signer gets their own link, opens the document, draws their
// signature and confirms. This file is the office side; the signer's side is
// sign.html. How the records fit together is described in engine/sign.js.

import { store } from '../core/store.js';
import { uid, fmtFull, fromDay, toDay } from '../core/util.js';
import { html, chip } from './dom.js';
import { pageHtml } from '../sync/mail.js';
import { openMail, emailIn } from './maildialog.js';
import { randomKey, sha256, toChunks, requestState, signLink, STATE_LABEL, MAX_FILE_BYTES } from '../engine/sign.js';

const PDF_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
const VALID_DAYS = 30;
const STATE_CLS = { waiting: 'warn', completed: 'ok', expired: 'high', cancelled: '' };

let adding = false;
let picked = null;          // { contract, file }: the PDF chosen for a request that is being filled in
let notice = '';
let bad = false;
const hashOf = new Map();   // a signer's key -> its SHA-256, to match signatures to signers
let hashing = false;

const say = (text, isBad = false) => { notice = text; bad = isBad; store.notify(); };
const base = () => location.origin + location.pathname.replace(/[^/]*$/, '');
const when = iso => `${fmtFull(iso.slice(0, 10))}, ${new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
const megabytes = n => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Signatures arrive holding only their key; the request holds the key's hash. Work the hashes out once. */
function ensureHashes(signed) {
  const missing = signed.filter(s => !hashOf.has(s.id));
  if (!missing.length || hashing) return;
  hashing = true;
  Promise.all(missing.map(async s => hashOf.set(s.id, await sha256(s.id))))
    .finally(() => { hashing = false; store.notify(); });
}

const requestsOf = (company, contractId) => (company.signs || []).filter(r => r.contractId === contractId);
const stateOf = (req, company, today) => requestState(req, company.signed || [], hashOf, today);
const keyOf = (company, req, signerId) => (company.signkeys || []).find(k => k.id === req.id)?.keys?.[signerId] || '';

/** Every request sent for signature, newest first, each with where it stands (for the Document sign page). */
export function overview(c) {
  ensureHashes(c.company.signed || []);
  return (c.company.signs || []).map(req => ({ req, st: stateOf(req, c.company, c.today) })).sort((a, b) => String(b.req.at).localeCompare(String(a.req.at)));
}

/** How many signature requests of a contract are still waiting, for the contract list. */
export function waiting(company, contractId, today) {
  return requestsOf(company, contractId).filter(r => stateOf(r, company, today).state === 'waiting').length;
}

/** The "Signatures" part of a contract's page. */
export function block(x, c) {
  const { company, today } = c;
  ensureHashes(company.signed || []);
  const list = requestsOf(company, x.id);
  const until = fromDay(toDay(today) + VALID_DAYS);
  const me = store.signature.split(',')[0];

  return html`
    <h3>Signatures</h3>
    ${notice ? html`<p class="${bad ? 'bad' : 'ok'}">${notice}</p>` : ''}
    ${list.length ? html`<ul class="list sign-list">${list.map(req => {
      const st = stateOf(req, company, today);
      return html`
        <li class="sign-req">
          <div class="split">
            <span><b>${req.title}</b> <span class="muted">${req.kind === 'pdf' ? `${req.fileName}, ${megabytes(req.bytes || 0)}` : 'Typed text'}, asked ${fmtFull(req.at.slice(0, 10))}${req.validUntil ? `, valid until ${fmtFull(req.validUntil)}` : ''}</span></span>
            <span>${chip(st.state === 'waiting' ? `${st.done} of ${st.total} signed` : STATE_LABEL[st.state], STATE_CLS[st.state])}</span>
          </div>
          <ul class="plain sign-people">${st.signers.map(p => html`
            <li>
              <span class="sign-who"><b>${p.name}</b> <span class="muted">${p.email || 'no email'}</span></span>
              ${p.signature ? html`
                <img class="sign-img" src="${p.signature.image}" alt="Signature of ${p.name}">
                <span class="muted">Signed ${when(p.signature.at)}${p.signature.name !== p.name ? ` as "${p.signature.name}"` : ''}</span>`
              : st.state === 'waiting' ? html`
                <span class="actions">
                  <button class="btn small primary" data-act="signNow" data-id="${req.id}" data-s="${p.id}" title="Opens the signing page here, for someone signing in person">Sign now</button>
                  <button class="btn small" data-act="signCopy" data-id="${req.id}" data-s="${p.id}">Copy link</button>
                  <button class="btn small" data-act="signEmail" data-id="${req.id}" data-s="${p.id}">Email link</button>
                </span>` : html`<span class="muted">Did not sign</span>`}
            </li>`)}</ul>
          <div class="actions left">
            ${st.done ? html`<button class="btn small" data-act="signPaper" data-id="${req.id}">${req.kind === 'pdf' ? 'Download signed PDF' : 'Open signed copy'}</button>` : ''}
            ${st.done && req.kind !== 'pdf' ? html`<button class="btn small" data-act="signSend" data-id="${req.id}">Email signed copy</button>` : ''}
            ${st.state === 'waiting' ? html`<button class="btn small" data-act="signCancel" data-id="${req.id}">Cancel request</button>` : ''}
            <button class="btn ghost small" data-act="removeSign" data-id="${req.id}">Delete</button>
          </div>
        </li>`;
    })}</ul>` : html`<p class="muted">Nothing has been sent for signature on this contract yet.</p>`}

    ${adding || !list.length ? html`
      <form data-form="signReq" data-contract="${x.id}" class="sign-new">
        <label>Document title <input name="title" value="${x.title || `Contract ${x.ref}`}" required></label>
        ${picked?.contract === x.id ? html`
          <div class="split sign-file"><span><b>PDF to sign:</b> ${picked.file.name} <span class="muted">${megabytes(picked.file.size)}</span></span><button type="button" class="btn ghost small" data-act="signUnpick">Choose another</button></div>`
          : html`<label>The PDF to sign <input type="file" accept="application/pdf,.pdf" data-chg="signFile" data-contract="${x.id}"></label>`}
        <label>Or type or paste the agreement text <textarea name="text" rows="5" placeholder="Leave empty when you chose a PDF above" ${picked?.contract === x.id ? 'disabled' : ''}></textarea></label>
        <span class="muted">Who signs. Each person gets their own link. Leave a row empty if it is not needed.</span>
        <div class="sign-rows">
          <input name="name1" value="${me}" placeholder="Name" aria-label="First signer, name"><input type="email" name="email1" value="${store.user?.email || ''}" placeholder="Email" aria-label="First signer, email">
          <input name="name2" value="${x.party || ''}" placeholder="Name" aria-label="Second signer, name"><input type="email" name="email2" value="${emailIn(x.contact)}" placeholder="Email" aria-label="Second signer, email">
          <input name="name3" placeholder="Name (witness, optional)" aria-label="Third signer, name"><input type="email" name="email3" placeholder="Email" aria-label="Third signer, email">
        </div>
        <label>Valid until <input type="date" name="validUntil" value="${until}"></label>
        <div class="actions left">
          <button class="btn primary">Create signature request</button>
          ${list.length ? html`<button type="button" class="btn ghost" data-act="signAdd" data-on="">Cancel</button>` : ''}
        </div>
        <p class="muted">A PDF can be up to ${megabytes(MAX_FILE_BYTES)}. Nothing is sent by creating the request: you then give each person their link.</p>
      </form>` : html`<button class="btn" data-act="signAdd" data-on="1">Request another signature</button>`}`;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
const fromBase64 = text => Uint8Array.from(atob(text), ch => ch.charCodeAt(0));

async function create(fd, x, c) {
  const file = picked?.contract === x.id ? picked.file : null;
  const text = String(fd.get('text') || '').trim();
  const hasFile = !!file && file.size > 0;
  if (!hasFile && !text) throw new Error('Choose the PDF to sign, or type the agreement text.');
  const people = [1, 2, 3].map(n => ({ name: String(fd.get(`name${n}`) || '').trim(), email: String(fd.get(`email${n}`) || '').trim().toLowerCase() })).filter(p => p.name);
  if (!people.length) throw new Error('Enter the name of at least one person who signs.');

  const id = `sg${randomKey()}`;
  const keys = {};
  const signers = [];
  for (const p of people) {
    const sid = uid('sn');
    keys[sid] = randomKey();
    signers.push({ id: sid, ...p, keyHash: await sha256(keys[sid]) });
  }
  const req = {
    id, contractId: x.id, ref: x.ref, title: String(fd.get('title') || '').trim() || `Contract ${x.ref}`,
    from: c.global.company?.name || 'Amistad Prefab', signers, validUntil: fd.get('validUntil') || '',
    status: 'sent', by: store.signature, at: new Date().toISOString(),
  };
  if (hasFile) {
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) throw new Error('Only a PDF file can be sent for signature.');
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is ${megabytes(file.size)}. The limit is ${megabytes(MAX_FILE_BYTES)}: save it as a smaller PDF, or scan at a lower quality.`);
    const buffer = await file.arrayBuffer();
    const parts = toChunks(toBase64(buffer));
    Object.assign(req, { kind: 'pdf', fileName: file.name, bytes: file.size, chunks: parts.length, hash: await sha256(buffer) });
    await store.putFile(id, parts);
  } else {
    Object.assign(req, { kind: 'text', text, hash: await sha256(text) });
  }
  store.updateCompany(co => { (co.signs ||= []).push(req); (co.signkeys ||= []).push({ id, keys }); });
  picked = null;
}

/** The typed agreement with the signatures under it, as a page to print or attach. */
function signedPage(req, st) {
  const inner = html`
    <div class="p-head">
      <div class="p-block"><span class="p-company">${req.from}</span></div>
      <div class="p-title"><h2>${req.title}</h2><span>${req.ref || ''}</span></div>
    </div>
    <div class="pre" style="white-space:pre-wrap">${req.text}</div>
    <h3>Signatures</h3>
    <table>${st.signers.map(p => html`
      <tr>
        <td style="width:34%"><b>${p.name}</b><br><span class="muted">${p.email || ''}</span></td>
        <td style="width:30%">${p.signature ? html`<img src="${p.signature.image}" alt="" style="max-height:60px;max-width:200px">` : ''}</td>
        <td>${p.signature ? `Signed electronically on ${when(p.signature.at)}` : 'Not signed'}</td>
      </tr>`)}</table>
    <p class="muted p-notes">Signed electronically through Amistad Prefab Central Hub. Request ${req.id.slice(0, 12)}. SHA-256 of the text: ${req.hash}.</p>`;
  return pageHtml(String(inner), req.title);
}

const loadScript = src => new Promise((resolve, reject) => {
  if (window.PDFLib) { resolve(); return; }
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error('The PDF tool could not be loaded. Check the internet connection and try again.'));
  document.head.append(s);
});
// the built-in PDF fonts only hold Latin letters
const latin = s => String(s || '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

/** The original PDF with a certificate page added at the end: who signed, when, and their signatures. */
async function signedPdf(req, st) {
  await loadScript(PDF_LIB);
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const pdf = await PDFDocument.load(fromBase64(await store.getFile(req.id, req.chunks)), { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  const grey = rgb(0.4, 0.4, 0.4);
  let y = 790;
  const line = (text, size = 10, f = font, color = rgb(0, 0, 0)) => { page.drawText(latin(text), { x: 50, y, size, font: f, color }); y -= size + 7; };
  line('Signature certificate', 20, bold);
  y -= 6;
  line(req.title, 13, bold);
  line(`${req.from}${req.ref ? `, contract ${req.ref}` : ''}`, 10, font, grey);
  line(`Document: ${req.fileName}`, 10, font, grey);
  line(`SHA-256 of the document as sent: ${req.hash}`, 8, font, grey);
  line(`Request ${req.id.slice(0, 12)}, sent ${when(req.at)} by ${req.by}`, 8, font, grey);
  y -= 14;
  for (const p of st.signers) {
    line(p.name, 12, bold);
    if (p.email) line(p.email, 10, font, grey);
    if (p.signature) {
      const png = await pdf.embedPng(p.signature.image);
      const h = 56, w = Math.min(220, png.width / png.height * h);
      page.drawImage(png, { x: 50, y: y - h, width: w, height: h });
      y -= h + 8;
      line(`Signed electronically on ${when(p.signature.at)}${p.signature.name !== p.name ? ` as "${p.signature.name}"` : ''}`, 9, font, grey);
    } else {
      line('Not signed', 10, font, grey);
    }
    y -= 12;
  }
  const url = URL.createObjectURL(new Blob([await pdf.save()], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${req.fileName.replace(/\.pdf$/i, '')} - signed.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const findReq = (c, el) => (c.company.signs || []).find(r => r.id === el.dataset.id);
const linkFor = (c, req, el) => {
  const key = keyOf(c.company, req, el.dataset.s);
  if (!key) throw new Error('The link of this signer is not available to you. Ask the Admin.');
  return signLink(base(), req.id, key, !store.cloud);
};

export const actions = {
  signAdd(el) { adding = !!el.dataset.on; notice = ''; if (!adding) picked = null; },
  signUnpick() { picked = null; },
  signNow(el, c) {
    const req = findReq(c, el);
    try { window.open(linkFor(c, req, el), '_blank', 'noopener'); } catch (err) { notice = err.message; bad = true; }
  },
  signCopy(el, c) {
    const req = findReq(c, el);
    try {
      const link = linkFor(c, req, el);
      navigator.clipboard.writeText(link).then(() => say('Link copied. Send it only to the person who signs: whoever has it can sign in their name.'), () => say(link));
    } catch (err) { notice = err.message; bad = true; }
  },
  signEmail(el, c) {
    const req = findReq(c, el);
    const p = req.signers.find(s => s.id === el.dataset.s);
    let link;
    try { link = linkFor(c, req, el); } catch (err) { notice = err.message; bad = true; return; }
    openMail({
      to: p.email,
      subject: `Please sign: ${req.title}`,
      message: `Dear ${p.name},\n\n${req.from} asks you to sign "${req.title}".\n\nOpen this link, read the document, draw your signature and press Sign:\n${link}\n\n${req.validUntil ? `The link is valid until ${fmtFull(req.validUntil)}. ` : ''}It is personal: please do not forward it.\n\nKind regards,\n${store.signature}\n${req.from}`,
      onSent({ to }) { say(`Signing link sent to ${to}.`); },
    });
  },
  signCancel(el, c) {
    const req = findReq(c, el);
    if (!req || !confirm(`Cancel the request to sign "${req.title}"? The links stop working. Signatures already given are kept.`)) return;
    store.updateCompany(co => { const r = co.signs.find(k => k.id === req.id); if (r) r.status = 'cancelled'; });
  },
  removeSign(el, c) {
    const req = findReq(c, el);
    if (!req || !confirm(`Delete "${req.title}" and its signatures? This cannot be undone. Download the signed copy first if you need it.`)) return;
    const keys = Object.values((c.company.signkeys || []).find(k => k.id === req.id)?.keys || {});
    store.updateCompany(co => {
      co.signs = co.signs.filter(r => r.id !== req.id);
      co.signkeys = (co.signkeys || []).filter(k => k.id !== req.id);
      co.signed = (co.signed || []).filter(s => !keys.includes(s.id));
    });
    if (req.kind === 'pdf') store.dropFile(req.id, req.chunks).catch(() => {});
  },
  signPaper(el, c) {
    const req = findReq(c, el);
    const st = stateOf(req, c.company, c.today);
    if (req.kind === 'pdf') {
      say('Preparing the signed PDF…');
      signedPdf(req, st).then(() => say('Signed PDF downloaded.'), err => say(err.message, true));
      return;
    }
    const url = URL.createObjectURL(new Blob([signedPage(req, st)], { type: 'text/html' }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  signSend(el, c) {
    const req = findReq(c, el);
    const st = stateOf(req, c.company, c.today);
    openMail({
      to: st.signers.map(p => p.email).filter(Boolean).join(', '),
      subject: `Signed: ${req.title}`,
      message: `Dear all,\n\nPlease find attached the signed copy of "${req.title}".\n\nKind regards,\n${store.signature}\n${req.from}`,
      filename: `${req.title} - signed`,
      getHtml: async () => signedPage(req, st),
      onSent({ to }) { say(`Signed copy sent to ${to}.`); },
    });
  },
};

export const changes = {
  /** Keep the chosen PDF: the page is redrawn whenever data arrives, and a file box cannot be refilled. */
  signFile(el) {
    const file = el.files[0];
    if (!file) return;
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { notice = 'Only a PDF file can be sent for signature.'; bad = true; return; }
    if (file.size > MAX_FILE_BYTES) { notice = `${file.name} is ${megabytes(file.size)}. The limit is ${megabytes(MAX_FILE_BYTES)}: save it as a smaller PDF, or scan at a lower quality.`; bad = true; return; }
    picked = { contract: el.dataset.contract, file };
    notice = '';
  },
};

export const submits = {
  signReq(fd, c, form) {
    const x = c.company.contracts.find(k => k.id === form.dataset.contract) || null;
    if (!x) return false;
    notice = 'Preparing the request…'; bad = false;
    create(fd, x, c).then(() => { adding = false; say('Signature request created. Give each person their link: Sign now, Copy link or Email link.'); },
      err => say(/quota/i.test(err.name + err.message) ? 'The demo keeps files in this browser, and this one is too large for it. It works in the signed-in version.' : err.message, true));
    return false;   // the form keeps what was typed until the request exists
  },
};
