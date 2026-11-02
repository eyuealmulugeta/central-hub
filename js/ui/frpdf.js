// v0.54.0 (Phase C, 20b part 1): a Field Report report's PDF drawn here by Field Report's own builder (js/fr/, copied
// by tools/sync-fr-pdf.mjs), from the whole report Field Report 2.23.0 keeps in projects/<id>/fieldReports/<date>.
// So Central Hub and Field Report give exactly the same PDF. The client copy is the same builder's client mode: no
// photo times and no time under the signatures. Photos come from Drive through the server, like the report page.

import { buildPdf, loadPdfLib, photoCaption, weatherFile } from '../fr/pdf.js';
import { weatherTerm } from '../fr/model/report.js';
import { fieldPhoto } from '../sync/fieldreport.js';
import { downloadFile } from '../sync/share.js';
import { store } from '../core/store.js';
import { tell } from '../core/image.js';

/** The saved Field Report record of a report: { full: { r, project, profile, sig, signedAt }, pdf, version, ... } or null. */
export const savedReport = (c, r) => store.getDoc(`projects/${c.project.id}/fieldReports/${r.date}`).catch(() => null);

/** Everything buildPdf takes, from the saved record. `pics` = { logo, weather, photos } read separately. */
export const pdfInput = (rec, pics = {}, client = false) => ({
  r: rec.full.r, project: rec.full.project, profile: rec.full.profile, file: rec.pdf || '', sig: rec.full.sig || '', signedAt: rec.full.signedAt || '',
  logo: pics.logo || '', weather: pics.weather || '', photos: pics.photos || [], ...(client ? { client: true } : {}),
});

/** The file name: Field Report's name, " (client)" before .pdf for the client copy. */
export const pdfFileName = (rec, client) => {
  const base = String(rec.pdf || `report-${rec.date}`).replace(/\.pdf$/i, '');
  return `${base}${client ? ' (client)' : ''}.pdf`;
};

const asDataUrl = url => fetch(url).then(x => (x.ok ? x.blob() : null)).then(b => (b ? new Promise(ok => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = () => ok(''); f.readAsDataURL(b); }) : '')).catch(() => '');
const sizeOf = src => new Promise(ok => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth || 4, h: i.naturalHeight || 3 }); i.onerror = () => ok({ w: 4, h: 3 }); i.src = src; });

/** Draws and downloads the PDF (or the client copy) of report `r`. */
export async function frPdf(c, r, client = false) {
  const rec = await savedReport(c, r);
  if (!rec?.full?.r) {
    tell('This report was sent before Field Report 2.23.0 (or not by the Both data route), so only its Drive PDF exists. Open it from the report.');
    return;
  }
  tell(client ? 'Making the client copy…' : 'Making the PDF…');
  try {
    const JsPDF = await loadPdfLib();
    const code = rec.full.project?.code || c.project.fieldCode || '';
    const photos = [];
    for (const ph of rec.full.r.photos || []) {
      const b64 = await fieldPhoto(code, rec.pdf, ph.id).catch(() => '');
      if (!b64) continue;
      const data = `data:image/jpeg;base64,${b64}`;
      photos.push({ data, ...(await sizeOf(data)), at: ph.at || '', cap: photoCaption(ph, rec.full.r.items) });
    }
    const w = weatherFile(weatherTerm(rec.full.r.start?.cond));
    const [logo, weather] = await Promise.all([asDataUrl('assets/fr/icon-192.png'), w ? asDataUrl(`assets/fr/weather/${w}.png`) : '']);
    const doc = buildPdf(JsPDF, pdfInput(rec, { logo, weather, photos }, client));
    downloadFile(new File([doc.output('blob')], pdfFileName(rec, client), { type: 'application/pdf' }));
    const missing = (rec.full.r.photos || []).length - photos.length;
    tell(`✓ ${pdfFileName(rec, client)} downloaded.${missing > 0 ? ` ${missing} photo${missing > 1 ? 's' : ''} could not be read from Drive.` : ''}`);
  } catch (err) { tell(`The PDF could not be made: ${err?.message || err}`); }
}
