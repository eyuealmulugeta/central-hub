// The signature pad of the pages opened from a link (sign.html, siteinst.html). v0.77.0: taken out of signpage.js.

export function pad(canvas, wrap) {
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
