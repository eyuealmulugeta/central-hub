// v1.16.0 (owner, 8 Nov): the live document camera of the crew form. A full-screen camera with a card-shaped guide:
// the document's outline is looked for several times a second and drawn in green; when it holds still and the picture
// is sharp, it is taken by itself (or with the round button). Answers { file, quad } (the corners in the picture), or
// null when closed. Nothing leaves the phone. Falls back (throws) where the browser has no camera access.

import { findQuad, channels, toGray, sharpness, SHAPE } from './docscan.js';

const WORK = 360;
const css = `
.cam{position:fixed;inset:0;z-index:50;background:#000;display:flex;flex-direction:column;color:#fff;font:15px system-ui,sans-serif}
.cam .view{position:relative;flex:1;overflow:hidden}
.cam video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.cam canvas{position:absolute;pointer-events:none}
.cam .tip{position:absolute;left:0;right:0;top:12px;text-align:center;padding:0 16px;text-shadow:0 1px 3px #000}
.cam .bar{display:flex;align-items:center;justify-content:space-around;padding:14px 10px calc(14px + env(safe-area-inset-bottom))}
.cam .bar button{background:none;border:1px solid #fff6;color:#fff;border-radius:999px;padding:10px 16px;font:inherit}
.cam .bar .shut{width:68px;height:68px;padding:0;border:4px solid #fff;background:#fff3}
.cam .bar .shut:active{background:#fff8}`;

/** Open the camera for one document side. `kind`: 'fayda' | 'id' | 'passport'; `title` is shown on top. */
export async function liveScan({ kind = 'id', title = '' } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
  if (!document.getElementById('cam-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'cam-css', textContent: css }));
  const box = document.createElement('div');
  box.className = 'cam';
  box.innerHTML = `<div class="view"><video playsinline muted autoplay></video><canvas></canvas><div class="tip"><b></b><br><span>Fit the document in the frame. It is taken by itself when it holds still.</span></div></div>
    <div class="bar"><button type="button" data-a="no">Cancel</button><button type="button" class="shut" data-a="shot" aria-label="Take the picture"></button><button type="button" data-a="torch" hidden>Light</button></div>`;
  box.querySelector('.tip b').textContent = title;
  document.body.append(box);
  const video = box.querySelector('video'), over = box.querySelector('canvas'), ox = over.getContext('2d'), tip = box.querySelector('.tip span');
  video.srcObject = stream;
  await video.play().catch(() => {});
  await new Promise(r => (video.videoWidth ? r() : video.addEventListener('loadedmetadata', r, { once: true })));
  const track = stream.getVideoTracks()[0];
  let torch = false;
  try { if (track.getCapabilities?.().torch) box.querySelector('[data-a=torch]').hidden = false; } catch { /* no light */ }

  const small = document.createElement('canvas'), sx = small.getContext('2d', { willReadFrequently: true });
  const shape = SHAPE[kind] || SHAPE.id;
  let shown = null, last = null, still = 0, best = 0, timer = 0, done;
  const result = new Promise(r => { done = r; });

  /** Where the video shows on screen, and the guide frame in video pixels. */
  const layout = () => {
    const v = box.querySelector('.view').getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight;
    const k = Math.min(v.width / vw, v.height / vh), w = vw * k, h = vh * k;
    shown = { k, left: (v.width - w) / 2, top: (v.height - h) / 2, w, h };
    Object.assign(over.style, { left: `${shown.left}px`, top: `${shown.top}px`, width: `${w}px`, height: `${h}px` });
    over.width = Math.round(w); over.height = Math.round(h);
    const fw = Math.min(vw * 0.9, vh * 0.9 * shape), fh = fw / shape;
    shown.frame = [(vw - fw) / 2, (vh - fh) / 2, (vw + fw) / 2, (vh + fh) / 2];
  };
  layout();
  addEventListener('resize', layout);

  const close = value => {
    clearTimeout(timer); removeEventListener('resize', layout);
    stream.getTracks().forEach(t => t.stop());
    box.remove(); done(value);
  };
  const take = quad => {
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    const f = shown.frame;
    const q = quad || [[f[0], f[1]], [f[2], f[1]], [f[2], f[3]], [f[0], f[3]]];   // no outline found: the guide frame
    c.toBlob(b => close(b ? { file: new File([b], 'scan.jpg', { type: 'image/jpeg' }), quad: q } : null), 'image/jpeg', 0.95);
  };
  const draw = q => {
    ox.clearRect(0, 0, over.width, over.height);
    const f = shown.frame.map(v => v * shown.k);
    ox.strokeStyle = q ? '#ffffff55' : '#ffffffcc'; ox.lineWidth = 3; ox.setLineDash([12, 8]);
    ox.strokeRect(f[0], f[1], f[2] - f[0], f[3] - f[1]); ox.setLineDash([]);
    if (!q) return;
    ox.strokeStyle = still >= 2 ? '#2ee07a' : '#e6ad45'; ox.lineWidth = 5; ox.beginPath();
    q.forEach(([x, y], i) => ox[i ? 'lineTo' : 'moveTo'](x * shown.k, y * shown.k)); ox.closePath(); ox.stroke();
  };
  const look = () => {
    if (!box.isConnected) return;
    const vw = video.videoWidth, vh = video.videoHeight, s = WORK / Math.max(vw, vh);
    small.width = Math.round(vw * s); small.height = Math.round(vh * s);
    sx.drawImage(video, 0, 0, small.width, small.height);
    const px = sx.getImageData(0, 0, small.width, small.height).data;
    const f = shown.frame.map(v => v * s);
    const q = findQuad(channels(px, small.width, small.height), small.width, small.height, { within: f });
    const sharp = sharpness(toGray(px, small.width, small.height), small.width, small.height);
    best = Math.max(best * 0.97, sharp);
    const full = q ? q.map(([x, y]) => [x / s, y / s]) : null;
    if (full && last && full.every((p, i) => Math.hypot(p[0] - last[i][0], p[1] - last[i][1]) < vw * 0.02)) still++; else still = 0;
    last = full;
    draw(full);
    tip.textContent = !full ? 'Fit the document in the frame, on a plain darker surface.' : still < 2 ? 'Hold still…' : sharp < best * 0.75 ? 'Hold still, focusing…' : 'Got it';
    if (full && still >= 3 && sharp >= best * 0.75) return take(full);
    timer = setTimeout(look, 220);
  };
  box.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'no') close(null);
    if (a === 'shot') take(last);
    if (a === 'torch') { torch = !torch; try { await track.applyConstraints({ advanced: [{ torch }] }); } catch { /* no light */ } }
  });
  timer = setTimeout(look, 400);
  return result;
}
