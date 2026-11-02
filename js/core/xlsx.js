// v0.62.0: the first sheet of an Excel file (.xlsx) as rows of cells, with no library: an .xlsx is a zip of XML files,
// unpacked with the browser's own DecompressionStream. Old .xls files are not read (save them as .xlsx or CSV).

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** The files of a zip, by name: () => Promise<text>. */
function zipEntries(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let e = b.length - 22;
  while (e >= 0 && u32(b, e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('This is not an Excel (.xlsx) file. Save it as .xlsx or CSV and choose it again.');
  const count = u16(b, e + 10);
  let p = u32(b, e + 16);
  const files = {};
  for (let k = 0; k < count; k++) {
    const method = u16(b, p + 10), size = u32(b, p + 20), nameLen = u16(b, p + 28), extra = u16(b, p + 30), note = u16(b, p + 32), at = u32(b, p + 42);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    files[name] = async () => {
      const start = at + 30 + u16(b, at + 26) + u16(b, at + 28);
      const raw = b.subarray(start, start + size);
      if (method === 0) return new TextDecoder().decode(raw);
      const out = new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
      return out.text();
    };
    p += 46 + nameLen + extra + note;
  }
  return files;
}

const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const textOf = xml => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unxml(m[1])).join('');
const colNo = ref => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** The first sheet's rows: numbers stay numbers (a date is an Excel day number), text is text. */
export async function readXlsx(buf) {
  const files = zipEntries(buf);
  const shared = files['xl/sharedStrings.xml'] ? [...(await files['xl/sharedStrings.xml']()).matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1])) : [];
  const sheetName = Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, z) => parseInt(a.match(/\d+/)) - parseInt(z.match(/\d+/)))[0];
  if (!sheetName) throw new Error('No sheet found in this Excel file.');
  const xml = await files[sheetName]();
  const rows = [];
  for (const [, inner] of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const m of inner.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = m[1], body = m[2] || '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const type = (attrs.match(/t="(\w+)"/) || [])[1];
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (type === 's') val = shared[+v] ?? '';
      else if (type === 'inlineStr') val = textOf(body);
      else if (type === 'str' || type === 'b' || type === 'e') val = unxml(v ?? '');
      else if (v != null) val = Number(v);
      row[ref ? colNo(ref) : row.length] = val;
    }
    rows.push(Array.from(row, x => x ?? ''));
  }
  return rows.filter(r => r.some(x => x !== ''));
}
