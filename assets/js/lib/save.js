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
    .replace(/[^\x00-\x7f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Srozumitelná zpráva k chybě ukládání. */
export function saveErrorMessage(err) {
  if (err && err.code === 'declined') return 'Uložení zrušeno.';
  if (err && err.code === 'busy') return 'Ukládání je teď zaneprázdněné. Zkus to za chvíli znovu.';
  return 'Stahování tady není dostupné. Otevři Cinkne v běžném prohlížeči.';
}

function anchorDownload(filename, data) {
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

/**
 * @param {string} filename
 * @param {string|Blob|Uint8Array|ArrayBuffer} data
 * @throws {SaveError} code 'declined' | 'busy' | 'unavailable'
 */
export async function saveFile(filename, data) {
  const host = globalThis.claude;
  if (host && typeof host.use === 'function') {
    const downloads = await host.use('downloads');
    if (downloads) {
      try {
        await downloads.save({ filename, data });
      } catch (err) {
        const code = err && err.code === 'declined' ? 'declined' : err && err.code === 'rate_limited' ? 'busy' : 'unavailable';
        throw new SaveError(code, saveErrorMessage({ code }));
      }
      return;
    }
    // Stránka otevřená samostatně (ne v rámu) může stahovat běžným způsobem.
    let framed = true;
    try {
      framed = window.top !== window.self;
    } catch {
      framed = true;
    }
    if (framed) throw new SaveError('unavailable', saveErrorMessage({}));
  }
  anchorDownload(filename, data);
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
