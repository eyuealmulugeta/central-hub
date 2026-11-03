// v0.53.0 (Phase C, 20a): the company stamp and the person's own signature on an outgoing document. A tick box
// beside Print adds both before printing or sharing; the person picks which sign-off box they sign. Only their
// own signature (sigpad.js, drawn once) can be used. The stamp is the Admin's (Settings, Company letterhead),
// kept in company/main/seals, read by the Admin and Office. Every tick is logged in company/main/sealLog (who,
// when, which document), read by the Admin. Nothing is kept ticked: a page opened again starts without them.

import { store } from '../core/store.js';
import { uid } from '../core/util.js';
import { html, options } from './dom.js';
import { mySignature } from './sigpad.js';
import { tell } from '../core/image.js';

const signed = new Map();   // document key -> the sign-off label the person signs
const about = new Map();    // document key -> { ref, type, projectId } for the log

export const stampPng = () => (store.company?.seals || []).find(s => s.id === 'stamp')?.png || '';
/** Who may add them: whoever prints outgoing documents (the Admin and Office). */
export const maySeal = () => store.isAdmin || store.role === 'office';
const myName = () => store.profile?.name || store.user?.name || '';
/** v0.81.0 (owner, 3 Nov): the Admin and the GM sign under General manager only, where a document has that box. */
const topSigner = () => store.isAdmin || (store.ranks || []).includes('general_manager');
export const signLabels = (labels, top = topSigner()) => { const gm = (labels || []).filter(l => /general manager/i.test(l)); return top && gm.length ? gm : labels || []; };

/** What signoff() adds to the document `key`, or null while it is not ticked. */
export function sealOf(key) {
  if (!signed.has(key)) return null;
  return { as: signed.get(key), stamp: stampPng(), sig: mySignature(), name: myName() };
}

/** The tick box and the box to sign, for the toolbar of the document `key`. `labels`: its sign-off labels. */
export function sealBar(key, labels, info = {}) {
  if (!maySeal() || store.readOnly) return '';
  labels = signLabels(labels);
  about.set(key, { ...info, labels });
  const stamp = stampPng(), sig = mySignature();
  const why = !stamp && !sig ? 'Add the company stamp (Settings, Company letterhead) or your signature (My settings) first'
    : !stamp ? 'No company stamp yet: only your signature is added' : !sig ? 'You have no saved signature yet: only the stamp is added' : 'Adds the company stamp and your signature, then print or share';
  const on = signed.has(key);
  return html`<label class="check seal-bar" title="${why}"><input type="checkbox" data-seal="${key}" ${on ? 'checked' : ''} ${!stamp && !sig ? 'disabled' : ''}> Stamp and my signature</label>
    ${on && sig && labels.length > 1 ? html`<select class="narrow" data-seal-as="${key}" aria-label="Sign as">${options(labels.map(l => [l, l]), signed.get(key))}</select>` : ''}`;
}

function log(key, as) {
  const info = about.get(key) || {};
  const rec = {
    id: uid('sl'), at: new Date().toISOString(), by: store.user?.email || '', name: myName(),
    key, ref: info.ref || '', type: info.type || '', projectId: info.projectId || '', as, stamp: !!stampPng(), sig: !!mySignature(),
  };
  const fail = err => tell(`The stamp was added, but its use was not logged: ${err?.message || err}`);
  if (store.cloud) { try { Promise.resolve(store.cloudPut(`company/main/sealLog/${rec.id}`, rec)).catch(fail); } catch (err) { fail(err); } }
  else store.updateCompany(co => (co.sealLog ||= []).push(rec));
}

globalThis.addEventListener?.('change', e => {
  const t = e.target;
  if (t?.dataset?.seal) {
    const key = t.dataset.seal;
    if (t.checked) {
      const first = (about.get(key)?.labels || [])[0] || '';
      signed.set(key, first);
      log(key, first);
    } else signed.delete(key);
    store.notify();
  } else if (t?.dataset?.sealAs) {
    signed.set(t.dataset.sealAs, t.value);
    log(t.dataset.sealAs, t.value);
    store.notify();
  }
});
