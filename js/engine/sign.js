// Signing a document electronically: who was asked, who has signed, and
// whether the request is still open. Shared by Central Hub and by the page
// a signer opens from their link (sign.html), so it imports nothing.
//
// How it holds together:
//   signs/<id>      the request: title, text or file, the signers. Its id is long and random,
//                   and it can be read by anyone who has it (the link), signed in or not.
//   signed/<key>    one signature. The key is in that signer's link only; the request holds
//                   just its SHA-256, so one signer cannot sign for another.
//   signkeys/<id>   the keys, for the office to hand out the links again. Never public.

export const MAX_FILE_BYTES = 6 * 1024 * 1024;   // a PDF to sign, before it is cut into parts
export const CHUNK_CHARS = 900_000;              // one stored part: a database document holds 1 MB
export const MAX_IMAGE_CHARS = 250_000;          // a drawn signature as a PNG data URL

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

/** A long random string nobody can guess: ids of requests and keys of signers. */
export function randomKey(bytes = 24) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** SHA-256 of a string or of bytes, as hex. */
export async function sha256(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

/** Cut a long string into the parts it is stored as. */
export function toChunks(text, size = CHUNK_CHARS) {
  const parts = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

export const STATE_LABEL = { waiting: 'Waiting for signatures', completed: 'Signed by everyone', expired: 'Expired', cancelled: 'Cancelled' };

/**
 * Where a request stands. `signed` is the list of signature records (their id is the key);
 * `hashes` maps each key to its SHA-256, worked out once by the caller because hashing is async.
 */
export function requestState(req, signed, hashes, today) {
  const byHash = new Map();
  for (const s of signed) if (s.request === req.id && hashes.has(s.id)) byHash.set(hashes.get(s.id), s);
  const signers = (req.signers || []).map(p => ({ ...p, signature: byHash.get(p.keyHash) || null }));
  const done = signers.filter(p => p.signature).length;
  const state = req.status === 'cancelled' ? 'cancelled'
    : signers.length && done === signers.length ? 'completed'
    : req.validUntil && req.validUntil < today ? 'expired'
    : 'waiting';
  return { state, signers, done, total: signers.length };
}

/** The address a signer opens. `base` is the folder Central Hub is served from. */
export const signLink = (base, requestId, key, local = false) => `${base}sign.html?${local ? 'local&' : ''}r=${requestId}&k=${key}`;
