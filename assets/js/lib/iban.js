// České číslo účtu <-> IBAN, validace.

const PREFIX_WEIGHTS = [10, 5, 8, 4, 2, 1];
const NUMBER_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];

function mod11ok(digits, weights) {
  const padded = digits.padStart(weights.length, '0');
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += Number(padded[i]) * weights[i];
  return sum % 11 === 0;
}

/** Zbytek po dělení 97 pro libovolně dlouhé číslo zapsané jako text. */
function mod97(numeric) {
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  return rem;
}

function lettersToDigits(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out += c >= 65 && c <= 90 ? String(c - 55) : ch;
  }
  return out;
}

/** "19-2000145399/0800" -> { prefix, number, bank } nebo null. */
export function parseCzAccount(input) {
  const s = String(input || '').replace(/\s+/g, '');
  const m = /^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const prefix = m[1] || '';
  const number = m[2];
  const bank = m[3];
  if (prefix && !mod11ok(prefix, PREFIX_WEIGHTS)) return null;
  if (!mod11ok(number, NUMBER_WEIGHTS)) return null;
  if (Number(number) === 0) return null;
  return { prefix, number, bank };
}

export function czAccountToIban({ prefix = '', number, bank }) {
  const bban = bank + prefix.padStart(6, '0') + number.padStart(10, '0');
  const check = 98 - mod97(lettersToDigits(bban + 'CZ00'));
  return 'CZ' + String(check).padStart(2, '0') + bban;
}

export function isValidIban(input) {
  const s = String(input || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  if (s.startsWith('CZ') && (s.length !== 24 || !/^\d+$/.test(s.slice(2)) || Number(s.slice(14)) === 0)) return false;
  if (s.startsWith('SK') && s.length !== 24) return false;
  return mod97(lettersToDigits(s.slice(4) + s.slice(0, 4))) === 1;
}

/** CZ IBAN -> "19-2000145399/0800"; pro jiné země null. */
export function ibanToCzAccount(input) {
  const s = String(input || '').replace(/\s+/g, '').toUpperCase();
  if (!s.startsWith('CZ') || !isValidIban(s)) return null;
  const bank = s.slice(4, 8);
  const prefix = s.slice(8, 14).replace(/^0+/, '');
  const number = s.slice(14).replace(/^0+/, '');
  return (prefix ? prefix + '-' : '') + number + '/' + bank;
}

export function formatIban(iban) {
  return String(iban || '').replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Přijme české číslo účtu i IBAN.
 * Vrací { ok: true, iban, account, czech } nebo { ok: false, error }.
 */
export function normalizeAccount(input) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, error: 'Doplň číslo účtu.' };
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  if (/^[A-Z]{2}/.test(compact)) {
    if (!isValidIban(compact)) return { ok: false, error: 'IBAN nesedí. Zkontroluj překlepy.' };
    return { ok: true, iban: compact, account: ibanToCzAccount(compact) || formatIban(compact), czech: compact.startsWith('CZ') };
  }
  const parsed = parseCzAccount(compact);
  if (!parsed) {
    return { ok: false, error: 'Číslo účtu nesedí. Správný tvar je například 2000145399/0800 nebo 19-2000145399/0800.' };
  }
  const iban = czAccountToIban(parsed);
  return { ok: true, iban, account: ibanToCzAccount(iban), czech: true };
}
