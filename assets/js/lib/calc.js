// Výpočty: částky, DPH, data, číslování, hodinovka, úrok z prodlení.

export const VAT_RATES = [21, 12, 0];

/** Text z formuláře ("1 250,50") -> číslo. Neplatný vstup = 0. */
export function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? '').replace(/\s| /g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Zaokrouhlení na haléře, odolné vůči chybám dvojkové aritmetiky. */
export function toCents(amount) {
  return Math.round((amount + Math.sign(amount) * 1e-9) * 100);
}

const fmtCache = new Map();
function formatter(currency) {
  if (!fmtCache.has(currency)) {
    fmtCache.set(
      currency,
      new Intl.NumberFormat('cs-CZ', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  }
  return fmtCache.get(currency);
}

/** Haléře -> "12 345,60 Kč" (s obyčejnými mezerami, aby šly do PDF). */
export function formatMoney(cents, currency = 'CZK') {
  return formatter(currency).format(cents / 100).replace(/[  ]/g, ' ');
}

/** Celé koruny bez haléřů, pro přehledy a kalkulačku. */
export function formatWhole(amount, currency = 'CZK') {
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency, maximumFractionDigits: 0 })
    .format(Math.round(amount))
    .replace(/[  ]/g, ' ');
}

export function formatQty(qty) {
  return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 3 }).format(qty).replace(/[  ]/g, ' ');
}

/**
 * Součty faktury. Ceny položek jsou u plátce bez DPH.
 * Vrací částky v haléřích.
 */
export function invoiceTotals(invoice) {
  const vatPayer = !!invoice.supplier?.vatPayer;
  const lines = (invoice.items || []).map((item) => {
    const base = toCents(num(item.qty) * num(item.price));
    const rate = vatPayer ? num(item.vat) : 0;
    return { base, rate };
  });
  const byRate = new Map();
  for (const line of lines) byRate.set(line.rate, (byRate.get(line.rate) || 0) + line.base);
  const vat = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, base]) => ({ rate, base, tax: Math.round((base * rate) / 100) }));
  const base = vat.reduce((s, v) => s + v.base, 0);
  const tax = vat.reduce((s, v) => s + v.tax, 0);
  return { lines, vat, base, tax, total: base + tax, vatPayer };
}

// ---- data -------------------------------------------------------------

export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseIso(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function isIsoDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return false;
  const d = parseIso(iso);
  return d.toISOString().slice(0, 10) === iso;
}

export function addDays(iso, days) {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

/** Počet dní od `from` do `to` (kladné, když je `to` později). */
export function daysBetween(from, to) {
  return Math.round((parseIso(to) - parseIso(from)) / 86400000);
}

/** "2026-11-25" -> "25. 11. 2026" */
export function formatDate(iso) {
  if (!isIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}. ${m}. ${y}`;
}

// ---- číslování --------------------------------------------------------

/**
 * Další číslo faktury. `existingNumbers` jsou už vystavená čísla, nejnovější první.
 * Výchozí řada je RRRRNNNN a s novým rokem začíná od 0001. Kdo si čísluje po svém
 * (FV-2026-012, 12/2026…), tomu se zvýší poslední skupina číslic naposledy vystavené faktury.
 */
export function nextInvoiceNumber(existingNumbers, year = new Date().getFullYear()) {
  const taken = new Set(existingNumbers.map((n) => String(n).trim()));
  const last = [...taken].find(Boolean);
  if (last && !/^\d{8}$/.test(last)) {
    // Pořadové číslo je poslední skupina číslic, která nevypadá jako letopočet (12/2026 -> 13/2026).
    const groups = [...last.matchAll(/\d+/g)];
    const serial = [...groups].reverse().find((g) => !/^(19|20)\d\d$/.test(g[0])) || groups[groups.length - 1];
    if (serial) {
      const head = last.slice(0, serial.index);
      const tail = last.slice(serial.index + serial[0].length);
      let n = BigInt(serial[0]);
      let candidate;
      do {
        n += 1n;
        candidate = head + String(n).padStart(serial[0].length, '0') + tail;
      } while (taken.has(candidate));
      return candidate;
    }
  }
  const prefix = String(year);
  let max = 0;
  for (const s of taken) {
    if (/^\d{8}$/.test(s) && s.startsWith(prefix)) max = Math.max(max, Number(s.slice(4)));
  }
  return prefix + String(max + 1).padStart(4, '0');
}

/** Variabilní symbol: jen číslice, nejvýš 10. */
export function toVs(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

/** Kontrolní součet IČO (8 číslic, modulo 11). */
export function isValidIco(value) {
  const s = String(value || '').replace(/\s+/g, '');
  if (!/^\d{8}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(s[i]) * (8 - i);
  return (11 - (sum % 11)) % 10 === Number(s[7]);
}

// ---- stav faktury -----------------------------------------------------

/** 'paid' | 'overdue' | 'open' */
export function invoiceStatus(invoice, today = todayIso()) {
  if (invoice.paidAt) return 'paid';
  if (invoice.due && invoice.due < today) return 'overdue';
  return 'open';
}

// ---- hodinovka --------------------------------------------------------

/**
 * Kolik si účtovat, aby po nákladech a odvodech zbyl požadovaný čistý příjem.
 * taxPct = odhad daní a pojištění jako podíl z tržeb.
 */
export function hourlyRate({ netMonthly, costsMonthly, taxPct, hoursPerWeek, billablePct, weeksOff }) {
  const tax = Math.min(Math.max(num(taxPct), 0), 90) / 100;
  const revenueYear = ((num(netMonthly) + num(costsMonthly)) * 12) / (1 - tax);
  const weeks = Math.max(52 - num(weeksOff), 0);
  const billableHours = weeks * num(hoursPerWeek) * (Math.min(Math.max(num(billablePct), 0), 100) / 100);
  const rate = billableHours > 0 ? revenueYear / billableHours : 0;
  return {
    revenueYear,
    revenueMonth: revenueYear / 12,
    billableHours,
    billableHoursPerWeek: weeks > 0 ? billableHours / weeks : 0,
    rate,
    dayRate: rate * 8,
  };
}

/** Čistý měsíční příjem při dané hodinové sazbě (opačný směr výpočtu). */
export function netFromRate({ rate, costsMonthly, taxPct, hoursPerWeek, billablePct, weeksOff }) {
  const tax = Math.min(Math.max(num(taxPct), 0), 90) / 100;
  const weeks = Math.max(52 - num(weeksOff), 0);
  const billableHours = weeks * num(hoursPerWeek) * (Math.min(Math.max(num(billablePct), 0), 100) / 100);
  const revenueYear = num(rate) * billableHours;
  return (revenueYear * (1 - tax)) / 12 - num(costsMonthly);
}

// ---- úrok z prodlení --------------------------------------------------

/** Úrok z prodlení v haléřích: jistina × roční sazba × dny / 365. */
export function lateInterest(principalCents, annualRatePct, days) {
  if (days <= 0 || num(annualRatePct) <= 0) return 0;
  return Math.round((principalCents * (num(annualRatePct) / 100) * days) / 365);
}
