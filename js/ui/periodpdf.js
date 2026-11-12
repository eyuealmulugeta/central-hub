// v1.58.0 (owner R8): a saved weekly, monthly or custom client report as a PDF in layout A (js/engine/periodpdf.js).
// The photos come from Drive through the server, like the daily report's PDF (js/ui/frpdf.js).

import { buildPeriodPdf, TITLES } from '../engine/periodpdf.js';
import { loadPdfLib } from '../fr/pdf.js';
import { fieldPhoto } from '../sync/fieldreport.js';
import { downloadFile } from '../sync/share.js';
import { reporterSig } from '../engine/sitesig.js';
import { tell } from '../core/image.js';

const asDataUrl = url => fetch(url).then(x => (x.ok ? x.blob() : null)).then(b => (b ? new Promise(ok => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = () => ok(''); f.readAsDataURL(b); }) : '')).catch(() => '');
const sizeOf = src => new Promise(ok => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth || 4, h: i.naturalHeight || 3 }); i.onerror = () => ok({ w: 4, h: 3 }); i.src = src; });

/** Everything buildPeriodPdf takes, from the saved report (pics read separately). */
export const periodInput = (c, d, pics = {}) => ({
  kind: d.kind, number: d.number, from: d.period?.from || '', to: d.period?.to || '', data: d.data || {}, remarks: d.remarks || '',
  project: { name: c.project.name || '', client: c.project.client?.name || '', location: c.project.location || '' },
  preparedBy: reporterSig(c.ws, d.period?.from, d.period?.to)?.name || '', approvedBy: d.status === 'issued' ? d.approvedBy || '' : '', approvedAt: d.status === 'issued' ? d.approvedAt || '' : '',
  logo: pics.logo || '', photos: pics.photos || [],
});
export const periodFileName = (c, d) => `${(TITLES[d.kind] || TITLES.custom).replace(/ /g, '-')}_${(c.project.name || '').replace(/[^A-Za-z0-9]+/g, '-')}_${d.period?.from || ''}_${d.period?.to || ''}.pdf`;

export async function periodPdf(c, d) {
  tell('Making the PDF…');
  try {
    const JsPDF = await loadPdfLib();
    const code = c.project.fieldCode || '';
    const photos = [];
    for (const ph of d.photos || []) {
      const b64 = code ? await fieldPhoto(code, ph.pdf, ph.id).catch(() => '') : '';
      if (!b64) continue;
      const data = `data:image/jpeg;base64,${b64}`;
      photos.push({ data, ...(await sizeOf(data)), cap: [ph.date ? `${+ph.date.slice(8, 10)}/${+ph.date.slice(5, 7)}` : '', ph.caption].filter(Boolean).join(' · ') });
    }
    const logo = await asDataUrl('assets/fr/icon-192.png');
    const doc = buildPeriodPdf(JsPDF, periodInput(c, d, { logo, photos }));
    downloadFile(new File([doc.output('blob')], periodFileName(c, d), { type: 'application/pdf' }));
    const missing = (d.photos || []).length - photos.length;
    tell(`✓ ${periodFileName(c, d)} downloaded.${missing > 0 ? ` ${missing} photo${missing > 1 ? 's' : ''} could not be read from Drive.` : ''}`);
  } catch (err) { tell(`The PDF could not be made: ${err?.message || err}`); }
}
