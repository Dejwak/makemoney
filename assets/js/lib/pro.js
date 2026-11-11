import config from '../../../config.js';
import { state, persist } from './store.js';

/** Dokud provozovatel nenastaví platební odkaz, běží Pro funkce všem (beta). */
export function proIsFree() {
  return !config.pro.paymentUrl;
}

export function isPro() {
  return proIsFree() || !!state.pro.unlocked;
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Ověří kód proti otiskům v config.js a odemkne Pro. */
export async function unlockWithCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return false;
  const hash = await sha256Hex(normalized);
  if (!config.pro.licenseHashes.includes(hash)) return false;
  state.pro.unlocked = true;
  persist(true);
  return true;
}
