// QR Platba (Short Payment Descriptor, SPAYD 1.0) – standard České bankovní asociace –
// a SEPA QR (EPC069-12) pro platby v eurech.

/** Text bez diakritiky, velkými písmeny, bez znaků, které mají ve SPAYD zvláštní význam (* % +). */
export function spaydText(value, maxLength) {
  const s = String(value || '')
    .replace(/[łŁ]/g, 'L').replace(/[øØ]/g, 'O').replace(/[đĐ]/g, 'D').replace(/ß/g, 'SS').replace(/[æÆ]/g, 'AE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^0-9A-Z $\-./:,()@_!?#&=;']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.slice(0, maxLength).trim();
}

const digits = (v, max) => String(v || '').replace(/\D/g, '').slice(0, max);
const cleanIban = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const SPAYD_MAX_AMOUNT = 9999999.99;

/**
 * @param {object} p
 * @param {string} p.iban        IBAN příjemce
 * @param {number} [p.amount]    částka v jednotkách měny (např. 1250.5)
 * @param {string} [p.currency]  CZK | EUR
 * @param {string} [p.vs] [p.ks] [p.ss]
 * @param {string} [p.message]   zpráva pro příjemce (max 60 znaků)
 * @param {string} [p.recipient] jméno příjemce (max 35 znaků)
 * @param {string} [p.dueDate]   YYYY-MM-DD
 */
export function buildSpayd(p) {
  const iban = cleanIban(p.iban);
  if (!iban) throw new Error('Chybí IBAN.');
  const parts = ['SPD', '1.0', 'ACC:' + iban];
  const amount = Number(p.amount);
  if (Number.isFinite(amount) && amount > 0) {
    if (amount > SPAYD_MAX_AMOUNT) throw new Error('Částka je pro QR Platbu příliš vysoká.');
    parts.push('AM:' + amount.toFixed(2));
  }
  parts.push('CC:' + (p.currency === 'EUR' ? 'EUR' : 'CZK'));
  if (p.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(p.dueDate)) parts.push('DT:' + p.dueDate.replace(/-/g, ''));
  const msg = spaydText(p.message, 60);
  if (msg) parts.push('MSG:' + msg);
  const rn = spaydText(p.recipient, 35);
  if (rn) parts.push('RN:' + rn);
  const vs = digits(p.vs, 10);
  if (vs) parts.push('X-VS:' + vs);
  const ks = digits(p.ks, 10);
  if (ks) parts.push('X-KS:' + ks);
  const ss = digits(p.ss, 10);
  if (ss) parts.push('X-SS:' + ss);
  return parts.join('*');
}

/** Rozebere SPAYD řetězec na objekt klíč -> hodnota. */
export function parseSpayd(str) {
  const parts = String(str).split('*');
  if (parts[0] !== 'SPD') return null;
  const out = { version: parts[1] };
  for (const part of parts.slice(2)) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

const epcLine = (v, max) => String(v || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

/**
 * SEPA QR (EPC069-12, verze 002) pro převod v eurech. Čtou ho bankovní aplikace v eurozóně.
 * @param {{ iban: string, name: string, amount: number, bic?: string, remittance?: string }} p
 */
export function buildEpc(p) {
  const iban = cleanIban(p.iban);
  const name = epcLine(p.name, 70);
  const amount = Number(p.amount);
  if (!iban) throw new Error('Chybí IBAN.');
  if (!name) throw new Error('Chybí jméno příjemce.');
  if (!(amount > 0) || amount > 999999999.99) throw new Error('Částka je mimo rozsah SEPA QR.');
  return [
    'BCD', '002', '1', 'SCT',
    cleanIban(p.bic).slice(0, 11),
    name,
    iban,
    'EUR' + amount.toFixed(2),
    '',
    '',
    epcLine(p.remittance, 140),
  ].join('\n').replace(/\n+$/, '');
}
