// v0.70.0 (owner, 3 Nov, Phase G1): when the app is opened in a browser, offer to install it on the device. Android
// and computers get the browser's own Install; an iPhone or iPad gets the two taps (Share, Add to Home Screen).
// "Not now" waits 7 days. Nothing shows when the app is already installed. Same file in Field Report (js/core/install.js).

const KEY = 'installLater';
const WAIT_DAYS = 7;
let asked = null;   // the browser's install prompt, kept until used

const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isApple = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const later = () => { try { return Date.now() < +localStorage.getItem(KEY); } catch { return false; } };
const snooze = () => { try { localStorage.setItem(KEY, String(Date.now() + WAIT_DAYS * 864e5)); } catch { /* asks again next time */ } };

/** Should the box show now? Pure, for the tests. */
export const shouldOffer = ({ standalone, snoozed, canPrompt, apple }) => !standalone && !snoozed && (canPrompt || apple);

function box(name, apple) {
  if (document.getElementById('install-box')) return;
  const el = document.createElement('div');
  el.id = 'install-box';
  el.className = 'install-box';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Install ${name}`);
  el.innerHTML = apple
    ? `<b>Install ${name} on this device</b><span>Tap <b>Share</b> (the square with the arrow), then <b>Add to Home Screen</b>.</span><div><button type="button" data-i="later">Not now</button></div>`
    : `<b>Install ${name} on this device</b><span>It opens from the home screen like any app, full screen and faster.</span><div><button type="button" data-i="later">Not now</button><button type="button" data-i="go" class="primary">Install</button></div>`;
  el.addEventListener('click', async e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    if (b.dataset.i === 'go' && asked) { asked.prompt(); const r = await asked.userChoice.catch(() => null); asked = null; if (r?.outcome !== 'accepted') snooze(); }
    else snooze();
    el.remove();
  });
  document.body.appendChild(el);
}

/** Call once at start with the app's name. */
export function offerInstall(name) {
  if (installed()) return;
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    asked = e;
    if (shouldOffer({ standalone: installed(), snoozed: later(), canPrompt: true, apple: false })) box(name, false);
  });
  addEventListener('appinstalled', () => document.getElementById('install-box')?.remove());
  if (isApple() && shouldOffer({ standalone: installed(), snoozed: later(), canPrompt: false, apple: true })) setTimeout(() => box(name, true), 3000);
}
