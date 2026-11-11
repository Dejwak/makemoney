// Uložení souboru k uživateli. Na běžném webu klasické stažení;
// uvnitř prohlížeče artefaktů Claude přes jeho schopnost „downloads“.

export class SaveError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  json: 'application/json',
  csv: 'text/csv;charset=utf-8',
};

/** Bezpečný název souboru bez diakritiky. */
export function safeFilename(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * @param {string} filename
 * @param {string|Blob|Uint8Array|ArrayBuffer} data
 * @throws {SaveError} code 'declined' | 'unavailable'
 */
export async function saveFile(filename, data) {
  const host = globalThis.claude;
  if (host && typeof host.use === 'function') {
    const downloads = await host.use('downloads');
    if (!downloads) throw new SaveError('unavailable', 'Stahování tady není dostupné.');
    try {
      await downloads.save({ filename, data });
    } catch (err) {
      const code = err && err.code === 'declined' ? 'declined' : 'unavailable';
      throw new SaveError(code, code === 'declined' ? 'Uložení zrušeno.' : 'Soubor se nepodařilo uložit.');
    }
    return;
  }
  const ext = filename.split('.').pop().toLowerCase();
  const blob = data instanceof Blob ? data : new Blob([data], { type: MIME[ext] || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Zkopíruje text do schránky; vrací false, když to prohlížeč nedovolí. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
