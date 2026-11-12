// v0.54.0 (Phase C, 20b part 1): a Field Report report's PDF drawn here by Field Report's own builder (js/fr/, copied
// by tools/sync-fr-pdf.mjs), from the whole report Field Report 2.23.0 keeps in projects/<id>/fieldReports/<date>.
// So Central Hub and Field Report give exactly the same PDF. The client copy is the same builder's client mode: no
// photo times and no time under the signatures. Photos come from Drive through the server, like the report page.

import { clientIds, CLIENT_PHOTOS } from '../fr/model/pdfplan.js';   // v1.59.0; v1.60.0 exactly 12
import { buildPdf, loadPdfLib, photoCaption, weatherFile } from '../fr/pdf.js';
import { weatherTerm } from '../fr/model/report.js';
import { fieldPhoto } from '../sync/fieldreport.js';
import { downloadFile } from '../sync/share.js';
import { store } from '../core/store.js';
// v1.55.0 (owner, 12 Nov, FR 2.93.0): a gallery photo says "From Gallery" on the office copy only; older captions carried it.
const GAL_CAP = /^From gallery: |\s*·\s*From gallery$/i;
export const plainCap = cap => String(cap || '').replace(GAL_CAP, '');
import { tell } from '../core/image.js';

/** The saved Field Report record of a report: { full: { r, project, profile, sig, signedAt }, pdf, version, ... } or null. */
export const savedReport = (c, r) => store.getDoc(`projects/${c.project.id}/fieldReports/${r.date}`).catch(() => null);

/** Everything buildPdf takes, from the saved record. `pics` = { logo, weather, photos } read separately. */
export const pdfInput = (rec, pics = {}, client = false) => ({
  r: rec.full.r, project: rec.full.project, profile: rec.full.profile, file: rec.pdf || '', sig: rec.full.sig || '', signedAt: rec.full.signedAt || '', progress: rec.full.progress || [],   // v1.57.0 (owner R7): the chart, as the phone saved it
 
  logo: pics.logo || '', weather: pics.weather || '', photos: pics.photos || [], ...(client ? { client: true } : {}),
});

/** The file name: Field Report's name. v1.54.0 (owner, 12 Nov: "dont label as client copy in the pdf"): the copy for the client has the same name, no "(client)". */
export const pdfFileName = rec => `${String(rec.pdf || `report-${rec.date}`).replace(/\.pdf$/i, '')}.pdf`;

const asDataUrl = url => fetch(url).then(x => (x.ok ? x.blob() : null)).then(b => (b ? new Promise(ok => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = () => ok(''); f.readAsDataURL(b); }) : '')).catch(() => '');
const sizeOf = src => new Promise(ok => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth || 4, h: i.naturalHeight || 3 }); i.onerror = () => ok({ w: 4, h: 3 }); i.src = src; });

/** Draws and downloads the PDF (or the client copy) of report `r`. */
export async function frPdf(c, r, client = false, v = 0) {
  // v0.55.0: an older version is read from where it is kept (projects/<id>/fieldVersions/<date>_v<n>)
  const rec = v ? await store.getDoc(`projects/${c.project.id}/fieldVersions/${r.date}_v${v}`).catch(() => null) : await savedReport(c, r);
  if (!rec?.full?.r) {
    tell('This report was sent before Field Report 2.23.0 (or not by the Both data route), so only its Drive PDF exists. Open it from the report.');
    return;
  }
  tell(client ? 'Making the client copy…' : 'Making the PDF…');
  try {
    const JsPDF = await loadPdfLib();
    const code = rec.full.project?.code || c.project.fieldCode || '';
    const photos = [];
    // v1.59.0 (owner, 12 Nov): the client copy has only the 12 photos for the client (the PE or GM may have changed them)
    const all = rec.full.r.photos || [], ids = client ? clientIds(all, Array.isArray(r.field?.clientPick) ? r.field.clientPick : null) : all.map(p => p.id);
    if (client && ids.length !== CLIENT_PHOTOS) { tell(`The client copy needs exactly ${CLIENT_PHOTOS} photos for the client (${ids.length} now). Choose them on the report page.`); return; }   // v1.60.0
    for (const ph of all.filter(p => ids.includes(p.id))) {
      const b64 = await fieldPhoto(code, rec.pdf, ph.id).catch(() => '');
      if (!b64) continue;
      const data = `data:image/jpeg;base64,${b64}`;
      photos.push({ data, ...(await sizeOf(data)), at: ph.at || '', cap: plainCap(photoCaption(ph, rec.full.r.items)), gal: !!ph.gallery || GAL_CAP.test(String(ph.caption || '')) });
    }
    const w = weatherFile(weatherTerm(rec.full.r.start?.cond));
    const [logo, weather] = await Promise.all([asDataUrl('assets/fr/icon-192.png'), w ? asDataUrl(`assets/fr/weather/${w}.png`) : '']);
    const doc = buildPdf(JsPDF, pdfInput(rec, { logo, weather, photos }, client));
    downloadFile(new File([doc.output('blob')], pdfFileName(rec, client), { type: 'application/pdf' }));
    const missing = ids.length - photos.length;
    tell(`✓ ${pdfFileName(rec, client)} downloaded.${missing > 0 ? ` ${missing} photo${missing > 1 ? 's' : ''} could not be read from Drive.` : ''}`);
  } catch (err) { tell(`The PDF could not be made: ${err?.message || err}`); }
}
