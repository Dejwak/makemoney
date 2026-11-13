// Výpočty: částky, DPH, data, číslování, hodinovka, úrok z prodlení.

export const VAT_RATES = [21, 12, 0];

/**
 * Text z formuláře -> číslo. Rozumí českému zápisu ("1 250,50", "1.250,50", "500,-", "12,50 Kč").
 * Prázdný vstup je 0, nesrozumitelný vstup NaN.
 */
export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  let s = String(value ?? '').replace(/[\s\u00a0\u202f]/g, '');
  if (!s) return 0;
  const bare = s.replace(/(kč|czk|eur|€|%)$/i, '').replace(/[.,][-–—]$/, '').replace(/−/g, '-');
  const decorated = bare !== s; // "1.250,-" nebo "2.500 Kč": tady tečka odděluje tisíce
  s = bare;
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    // Poslední oddělovač je desetinný, ten druhý odděluje tisíce.
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (comma >= 0) {
    s = s.replace(',', '.');
  } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    // "1.250" může být 1250 i 1,25. S korunami za číslem je to jasné, jinak se radši zeptáme.
    if (!decorated) return NaN;
    s = s.replace(/\./g, '');
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/** Jako parseAmount, ale nesrozumitelný vstup počítá jako 0. */
export function num(value) {
  const n = parseAmount(value);
  return Number.isFinite(n) ? n : 0;
}

export function isAmount(value) {
  return Number.isFinite(parseAmount(value));
}

/** Zaokrouhlení od nuly, aby záporné částky byly zrcadlem kladných. */
function roundAway(x) {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** Zaokrouhlení na haléře, odolné vůči chybám dvojkové aritmetiky. */
export function toCents(amount) {
  if (!Number.isFinite(amount)) return 0;
  return Math.sign(amount) * Math.round((Math.abs(amount) + 1e-9) * 100) || 0;
}

const fmtCache = new Map();
function formatter(currency, lang) {
  const key = currency + lang;
  if (!fmtCache.has(key)) {
    fmtCache.set(key, new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'cs-CZ', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }));
  }
  return fmtCache.get(key);
}
const plainSpaces = (s) => s.replace(/[\u00a0\u202f]/g, ' ');

/** Haléře -> "12 345,60 Kč" (s obyčejnými mezerami, aby šly do PDF). */
export function formatMoney(cents, currency = 'CZK', lang = 'cs') {
  return plainSpaces(formatter(currency, lang).format(cents / 100));
}

/** Jednotková cena: dvě desetinná místa, u jemnějších cen až čtyři. */
export function formatUnitPrice(value, currency = 'CZK', lang = 'cs') {
  const fine = Math.abs(value * 100 - Math.round(value * 100)) > 1e-7;
  if (!fine) return formatMoney(toCents(value), currency, lang);
  return plainSpaces(new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'cs-CZ', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4,
  }).format(value));
}

/** Celé koruny bez haléřů, pro přehledy a kalkulačku. */
export function formatWhole(amount, currency = 'CZK') {
  const rounded = Math.round(amount) || 0; // bez záporné nuly
  return plainSpaces(new Intl.NumberFormat('cs-CZ', { style: 'currency', currency, maximumFractionDigits: 0 }).format(rounded));
}

export function formatQty(qty, lang = 'cs') {
  return plainSpaces(new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'cs-CZ', { maximumFractionDigits: 4 }).format(qty));
}

/**
 * Součty faktury. Ceny položek jsou u plátce bez DPH.
 * Vrací částky v haléřích.
 */
export function invoiceTotals(invoice) {
  const vatPayer = !!invoice.supplier?.vatPayer;
  const lines = (invoice.items || []).map((item) => {
    const base = toCents(num(item?.qty) * num(item?.price));
    const rate = vatPayer ? num(item?.vat) : 0;
    return { base, rate };
  });
  const byRate = new Map();
  for (const line of lines) {
    if (line.base !== 0) byRate.set(line.rate, (byRate.get(line.rate) || 0) + line.base);
  }
  // Sazba, jejíž položky se navzájem vyruší (sleva a práce), do rekapitulace nepatří.
  const vat = [...byRate.entries()]
    .filter(([, sum], _i, all) => sum !== 0 || all.length === 1)
    .sort((a, b) => b[0] - a[0])
    .map(([rate, base]) => ({ rate, base, tax: roundAway((base * rate) / 100) }));
  const base = vat.reduce((s, v) => s + v.base, 0);
  const tax = vat.reduce((s, v) => s + v.tax, 0);
  return { lines, vat, base, tax, total: base + tax, vatPayer, zeroRated: vatPayer && vat.some((v) => v.rate === 0) };
}

/** Obrat za kalendářní rok: plnění v Kč podle data plnění, bez DPH. */
export function yearTurnover(invoices, year) {
  let cents = 0;
  let foreign = 0;
  for (const inv of invoices) {
    const date = isIsoDate(inv.duzp) ? inv.duzp : inv.issued;
    if (!String(date).startsWith(String(year))) continue;
    if ((inv.currency || 'CZK') !== 'CZK') {
      foreign += 1;
      continue;
    }
    cents += invoiceTotals(inv).base;
  }
  return { cents, foreign };
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
  return new Date(Date.UTC(y, m - 1, d));
}

export function isIsoDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return false;
  const d = parseIso(iso);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** Datum, které dává na faktuře smysl. Odfiltruje i rozepsaný rok (0202-11-12) z ručního psaní. */
export function isBusinessDate(iso) {
  return isIsoDate(iso) && iso >= '2000-01-01' && iso <= '2100-12-31';
}

/** Posune datum o daný počet dní; pro neplatné datum vrací ''. */
export function addDays(iso, days) {
  if (!isIsoDate(iso)) return '';
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

/** Počet dní od `from` do `to` (kladné, když je `to` později); pro neplatná data NaN. */
export function daysBetween(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to)) return NaN;
  return Math.round((parseIso(to) - parseIso(from)) / 86400000);
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-25" -> "25. 11. 2026", anglicky "25 Nov 2026" */
export function formatDate(iso, lang = 'cs') {
  if (!isIsoDate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return lang === 'en' ? `${d} ${EN_MONTHS[m - 1]} ${y}` : `${d}. ${m}. ${y}`;
}

// ---- číslování --------------------------------------------------------

/**
 * Další číslo faktury. `existingNumbers` jsou už vystavená čísla, nejnovější první.
 * Výchozí řada je RRRRNNNN a s novým rokem začíná od 0001. Kdo si čísluje po svém
 * (FV-2026-012, 12/2026…), tomu se zvýší pořadové číslo naposledy vystavené faktury;
 * obsahuje-li číslo loňský letopočet, přepíše se na letošní a řada začne od jedničky.
 */
export function nextInvoiceNumber(existingNumbers, year = new Date().getFullYear()) {
  const taken = new Set(existingNumbers.map((n) => String(n).trim()));
  const last = [...taken].find(Boolean);
  const isDefault = (s) => /^(19|20)\d{6}$/.test(s);
  if (last && !isDefault(last)) {
    // Pořadové číslo je poslední skupina číslic, která nevypadá jako letopočet (12/2026 -> 13/2026).
    const groups = [...last.matchAll(/\d+/g)];
    const isYear = (g) => /^(19|20)\d\d$/.test(g[0]);
    const serial = [...groups].reverse().find((g) => !isYear(g)) || groups[groups.length - 1];
    if (serial) {
      // Řada s letopočtem (FA-2026-012, 12/2026) začíná v novém roce znovu od jedničky.
      const years = groups.filter((g) => g !== serial && isYear(g));
      const rollover = years.length === 1 && Number(years[0][0]) < year;
      const build = (n) => {
        let out = '';
        let pos = 0;
        for (const g of groups) {
          out += last.slice(pos, g.index);
          if (g === serial) out += n;
          else out += rollover && g === years[0] ? String(year) : g[0];
          pos = g.index + g[0].length;
        }
        return out + last.slice(pos);
      };
      // Šířku s nulami drží jen řada, která nuly opravdu používá (012 ano, 12 ne).
      const width = serial[0].startsWith('0') || !rollover ? serial[0].length : 1;
      let n = rollover ? 0n : BigInt(serial[0]);
      let candidate;
      do {
        n += 1n;
        candidate = build(String(n).padStart(width, '0'));
      } while (taken.has(candidate));
      return candidate;
    }
  }
  const prefix = String(year);
  let max = 0;
  for (const s of taken) {
    if (isDefault(s) && s.startsWith(prefix)) max = Math.max(max, Number(s.slice(4)));
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
  if (isIsoDate(invoice.due) && invoice.due < today) return 'overdue';
  return 'open';
}

// ---- hodinovka --------------------------------------------------------

const clamp = (value, min, max) => Math.min(Math.max(num(value), min), max);

function billableHoursPerYear({ hoursPerWeek, billablePct, weeksOff }) {
  const weeks = 52 - clamp(weeksOff, 0, 52);
  return { weeks, hours: weeks * clamp(hoursPerWeek, 0, 168) * (clamp(billablePct, 0, 100) / 100) };
}

/**
 * Kolik si účtovat, aby po nákladech a odvodech zbyl požadovaný čistý příjem.
 * taxPct = odhad daní a pojištění jako podíl z tržeb.
 */
export function hourlyRate(input) {
  const tax = clamp(input.taxPct, 0, 90) / 100;
  const revenueYear = ((Math.max(num(input.netMonthly), 0) + Math.max(num(input.costsMonthly), 0)) * 12) / (1 - tax);
  const { weeks, hours } = billableHoursPerYear(input);
  const rate = hours > 0 ? revenueYear / hours : 0;
  return {
    revenueYear,
    revenueMonth: revenueYear / 12,
    billableHours: hours,
    billableHoursPerWeek: weeks > 0 ? hours / weeks : 0,
    rate,
    dayRate: rate * 8,
  };
}

/** Čistý měsíční příjem při dané hodinové sazbě (opačný směr výpočtu). */
export function netFromRate(input) {
  const tax = clamp(input.taxPct, 0, 90) / 100;
  const { hours } = billableHoursPerYear(input);
  return (num(input.rate) * hours * (1 - tax)) / 12 - Math.max(num(input.costsMonthly), 0);
}

// ---- úrok z prodlení --------------------------------------------------

/** Úrok z prodlení v haléřích: jistina × roční sazba × dny / 365. */
export function lateInterest(principalCents, annualRatePct, days) {
  const rate = num(annualRatePct);
  if (!(days > 0) || rate <= 0 || rate > 1000) return 0;
  return Math.round((principalCents * (rate / 100) * days) / 365);
}

// Zákonný úrok z prodlení (nařízení vlády č. 351/2013 Sb.): repo sazba ČNB platná první den
// pololetí, ve kterém prodlení začalo, plus 8 procentních bodů. Tabulku je potřeba jednou
// za půl roku doplnit podle cnb.cz.
const STATUTORY_RATES = {
  '2025-1': 12.0,
  '2025-2': 11.5,
  '2026-1': 11.5,
  '2026-2': 11.75,
};

/** Zákonná roční sazba pro prodlení, které začalo den po splatnosti; null, když ji tabulka nezná. */
export function statutoryInterestRate(dueIso) {
  const start = addDays(dueIso, 1);
  if (!start) return null;
  const [year, month] = start.split('-').map(Number);
  return STATUTORY_RATES[`${year}-${month <= 6 ? 1 : 2}`] ?? null;
}
