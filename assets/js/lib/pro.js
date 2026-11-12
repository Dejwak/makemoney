import config from '../../../config.js';
import { state, persist } from './store.js';

/** Dokud provozovatel placenou verzi nezapne, běží Pro funkce všem (beta). */
export function proIsFree() {
  return !config.pro.enabled;
}

export function isPro() {
  return proIsFree() || !!state.pro.unlocked;
}

/** Kód bez pomlček, mezer a rozdílu velikosti písmen: "cink-ab12–cd34" -> "CINKAB12CD34". */
export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Ověří kód proti otiskům v config.js a odemkne Pro.
 * @returns {Promise<'ok'|'wrong'|'unsupported'>}
 */
export async function unlockWithCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return 'wrong';
  let hash;
  try {
    hash = await sha256Hex(normalized);
  } catch {
    return 'unsupported'; // crypto.subtle chybí mimo https
  }
  if (!config.pro.licenseHashes.includes(hash)) return 'wrong';
  state.pro.unlocked = true;
  persist(true);
  return 'ok';
}
