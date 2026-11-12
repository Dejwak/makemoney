// Stav aplikace. Všechno zůstává v prohlížeči (localStorage); bez něj běží jen v paměti.
// Cokoli přichází zvenku (úložiště, záloha, jiná záložka) projde přes normalizeState().

import { VAT_RATES, addDays, isIsoDate, nextInvoiceNumber, todayIso, toVs } from './calc.js';

const KEY = 'cinkne:v1';

export const REGISTER_NOTE = 'Fyzická osoba zapsaná v živnostenském rejstříku.';

const PROFILE_KEYS = ['name', 'street', 'zip', 'city', 'ico', 'dic', 'account', 'swift', 'email', 'phone', 'register'];
const CLIENT_KEYS = ['name', 'street', 'zip', 'city', 'ico', 'dic', 'email'];
const RATE_DEFAULTS = { netMonthly: 60000, costsMonthly: 6000, taxPct: 15, hoursPerWeek: 40, billablePct: 60, weeksOff: 6, currentRate: '' };
const QR_DEFAULTS = { account: '', amount: '', vs: '', message: '', name: '' };

export function emptyProfile() {
  return {
    name: '', street: '', zip: '', city: '', ico: '', dic: '', vatPayer: false,
    account: '', swift: '', email: '', phone: '', register: REGISTER_NOTE,
  };
}

export function emptyClient() {
  return { name: '', street: '', zip: '', city: '', ico: '', dic: '', email: '' };
}

export function emptyItem(vat = 21) {
  return { desc: '', qty: 1, unit: '', price: '', vat };
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---- čištění dat --------------------------------------------------------

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function text(value, max = 200) {
  if (typeof value === 'string') return value.slice(0, max);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}
const isoOr = (value, fallback) => (isIsoDate(value) ? value : fallback);

function pick(source, keys, max) {
  const out = {};
  for (const key of keys) out[key] = text(isObject(source) ? source[key] : '', max);
  return out;
}

function cleanSupplier(raw) {
  const out = { ...emptyProfile(), ...pick(raw, PROFILE_KEYS, 300), vatPayer: !!(isObject(raw) && raw.vatPayer) };
  return out;
}

function cleanLogo(raw) {
  if (!isObject(raw) || typeof raw.data !== 'string') return null;
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(raw.data)) return null;
  const w = Number(raw.w);
  const h = Number(raw.h);
  return w > 0 && h > 0 && w <= 4000 && h <= 4000 ? { data: raw.data, w, h } : null;
}

function cleanItem(raw) {
  const src = isObject(raw) ? raw : {};
  const vat = Number(src.vat);
  return {
    desc: text(src.desc, 4000),
    qty: text(src.qty, 24),
    unit: text(src.unit, 12),
    price: text(src.price, 24),
    vat: VAT_RATES.includes(vat) ? vat : 21,
  };
}

/** Faktura nebo koncept v pevném tvaru; z nesmyslu vrátí null. */
function cleanInvoice(raw, { draft = false } = {}) {
  if (!isObject(raw)) return null;
  const number = text(raw.number, 32).trim();
  const id = text(raw.id, 40).replace(/[^A-Za-z0-9_-]/g, '');
  if (!draft && (!number || !id)) return null;
  const today = todayIso();
  const issued = isoOr(raw.issued, draft ? text(raw.issued, 10) : today);
  const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 500).map(cleanItem);
  return {
    id: id || null,
    number,
    vs: toVs(text(raw.vs, 20)),
    issued,
    duzp: isoOr(raw.duzp, draft ? text(raw.duzp, 10) : issued),
    due: isoOr(raw.due, draft ? text(raw.due, 10) : issued),
    currency: raw.currency === 'EUR' ? 'EUR' : 'CZK',
    lang: raw.lang === 'en' ? 'en' : 'cs',
    exchangeRate: text(raw.exchangeRate, 16),
    zeroVatNote: text(raw.zeroVatNote, 300),
    supplier: cleanSupplier(raw.supplier),
    client: pick(raw.client, CLIENT_KEYS, 300),
    items: items.length ? items : [emptyItem()],
    note: text(raw.note, 6000),
    paidAt: isIsoDate(raw.paidAt) ? raw.paidAt : null,
    createdAt: text(raw.createdAt, 40),
    reminders: (Array.isArray(raw.reminders) ? raw.reminders : [])
      .filter((r) => isObject(r) && isIsoDate(r.date))
      .slice(-50)
      .map((r) => ({ date: r.date, tone: text(r.tone, 20) })),
  };
}

export function newDraft(profile, invoices, issuedNumbers = []) {
  const today = todayIso();
  const number = nextInvoiceNumber([...invoices.map((i) => i.number), ...issuedNumbers]);
  return {
    ...cleanInvoice({}, { draft: true }),
    number,
    vs: toVs(number),
    issued: today,
    duzp: today,
    due: addDays(today, 14),
    supplier: cleanSupplier(profile),
  };
}

// ---- ukázková data ------------------------------------------------------

export function exampleProfile() {
  return {
    ...emptyProfile(),
    name: 'Jana Nováková',
    street: 'Lipová 12',
    zip: '602 00',
    city: 'Brno',
    ico: '12345679',
    account: '19-2000145399/0800',
    email: 'jana@example.cz',
    phone: '+420 600 000 000',
  };
}

export function exampleDraft() {
  const draft = newDraft(exampleProfile(), []);
  draft.client = {
    ...emptyClient(),
    name: 'Kavárna Pod Věží s.r.o.',
    street: 'Náměstí Svobody 8',
    zip: '602 00',
    city: 'Brno',
    ico: '87654326',
    email: 'ucetni@example.cz',
  };
  draft.items = [
    { desc: 'Návrh nového jídelního lístku', qty: 1, unit: 'ks', price: 8500, vat: 21 },
    { desc: 'Focení interiéru a nápojů', qty: 4, unit: 'h', price: 950, vat: 21 },
  ];
  draft.note = 'Děkuji za spolupráci.';
  return draft;
}

/** Tři ukázkové faktury do přehledu: po splatnosti, čekající a zaplacená. */
export function exampleInvoices() {
  const today = todayIso();
  const supplier = exampleProfile();
  const year = today.slice(0, 4);
  const make = (seq, clientName, email, issuedAgo, dueIn, items, paidAgo) => ({
    ...cleanInvoice({}, { draft: true }),
    id: 'example-' + seq,
    example: true,
    number: year + String(seq).padStart(4, '0'),
    vs: year + String(seq).padStart(4, '0'),
    issued: addDays(today, -issuedAgo),
    duzp: addDays(today, -issuedAgo),
    due: addDays(today, dueIn),
    supplier,
    client: { ...emptyClient(), name: clientName, email },
    items,
    paidAt: paidAgo == null ? null : addDays(today, -paidAgo),
  });
  return [
    make(3, 'Kavárna Pod Věží s.r.o.', 'ucetni@example.cz', 4, 10, [{ desc: 'Návrh jídelního lístku', qty: 1, unit: 'ks', price: 12300, vat: 21 }], null),
    make(2, 'Truhlářství Dvořák', 'dvorak@example.cz', 26, -12, [{ desc: 'Webová prezentace', qty: 1, unit: 'ks', price: 24000, vat: 21 }], null),
    make(1, 'Studio Lípa', 'studio@example.cz', 40, -26, [{ desc: 'Korektury textů', qty: 6, unit: 'h', price: 700, vat: 21 }], 30),
  ];
}

// ---- tvar stavu ---------------------------------------------------------

/** Z libovolného vstupu (uložená data, záloha) udělá úplný a bezpečný stav. Null = první spuštění. */
export function normalizeState(raw) {
  if (!isObject(raw)) {
    return {
      version: 1, demo: true, dirty: false,
      profile: { ...exampleProfile(), logo: null, color: '' },
      invoices: [], issuedNumbers: [], draft: exampleDraft(),
      pro: { unlocked: false, order: '' },
      rate: { ...RATE_DEFAULTS }, qr: { ...QR_DEFAULTS }, reminder: { interestRate: '' },
    };
  }
  const invoices = (Array.isArray(raw.invoices) ? raw.invoices : []).slice(0, 5000).map((inv) => cleanInvoice(inv)).filter(Boolean);
  const seen = new Set();
  for (const inv of invoices) {
    while (seen.has(inv.id)) inv.id = uid();
    seen.add(inv.id);
  }
  // Logo a barva patří k profilu, ne ke každé faktuře zvlášť (starší data je měla u dodavatele).
  const logoSources = [raw.profile, raw.draft && raw.draft.supplier, ...(Array.isArray(raw.invoices) ? raw.invoices.map((i) => i && i.supplier) : [])];
  let logo = null;
  let color = '';
  for (const source of logoSources) {
    if (!isObject(source)) continue;
    logo = logo || cleanLogo(source.logo);
    if (!color && /^#[0-9a-f]{6}$/i.test(source.color || '')) color = source.color;
  }
  const profile = { ...cleanSupplier(raw.profile), logo, color };
  const issuedNumbers = (Array.isArray(raw.issuedNumbers) ? raw.issuedNumbers : []).map((n) => text(n, 32)).filter(Boolean).slice(0, 500);
  // Koncept bez dodavatele není rozepsaná faktura, ale poškozená data: začni nový.
  const draft = isObject(raw.draft) && isObject(raw.draft.supplier)
    ? cleanInvoice(raw.draft, { draft: true })
    : newDraft(profile, invoices, issuedNumbers);
  const rate = { ...RATE_DEFAULTS };
  for (const key of Object.keys(RATE_DEFAULTS)) {
    if (isObject(raw.rate) && raw.rate[key] != null) rate[key] = text(raw.rate[key], 20);
  }
  return {
    version: 1,
    demo: !!raw.demo && invoices.length === 0,
    dirty: !!raw.dirty,
    profile,
    invoices,
    issuedNumbers,
    draft,
    pro: { unlocked: !!(isObject(raw.pro) && raw.pro.unlocked), order: isObject(raw.pro) ? text(raw.pro.order, 10).replace(/\D/g, '') : '' },
    rate,
    qr: pick(raw.qr, Object.keys(QR_DEFAULTS), 80),
    reminder: { interestRate: isObject(raw.reminder) ? text(raw.reminder.interestRate, 12) : '' },
  };
}

export const state = {};

/** Přepíše stav novým; vnořené objekty se mění na místě, aby odkazy na ně zůstaly platné. */
function applyState(next) {
  for (const [key, value] of Object.entries(next)) {
    if (isObject(value) && isObject(state[key]) && key !== 'draft') {
      for (const k of Object.keys(state[key])) delete state[key][k];
      Object.assign(state[key], value);
    } else {
      state[key] = value;
    }
  }
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return isObject(data) && data.version === 1 ? data : null;
  } catch {
    return null;
  }
}

/** Koncept, na který nikdo nesáhl, se má tvářit jako dnešní (datum i číslo). */
function refreshPristineDraft() {
  if (state.dirty || state.draft.id || state.draft.issued === todayIso()) return;
  state.draft = state.demo ? exampleDraft() : newDraft(state.profile, state.invoices, state.issuedNumbers);
}

applyState(normalizeState(read()));
refreshPristineDraft();

// ---- ukládání -----------------------------------------------------------

let timer = null;
let failureHandler = null;
let changeHandler = null;

/** Zavolá se, když se stav nepodaří uložit (anonymní okno, plné úložiště). */
export function onStorageFailure(handler) {
  failureHandler = handler;
}
/** Zavolá se, když data změní jiná záložka. */
export function onExternalChange(handler) {
  changeHandler = handler;
}

function write() {
  if (timer) clearTimeout(timer);
  timer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    if (failureHandler) failureHandler();
    return false;
  }
}

/** Uloží stav. Bez `now` se zpožděním, aby psaní do formuláře nezapisovalo při každém úhozu. */
export function persist(now = false) {
  if (now) return write();
  if (timer) clearTimeout(timer);
  timer = setTimeout(write, 250);
  return true;
}

/** Poznačí, že rozepsaná faktura má neuložené změny. */
export function touchDraft() {
  state.dirty = true;
  persist();
}

if (typeof addEventListener === 'function') {
  // Rozepsané změny zapiš i při zavření nebo přepnutí stránky.
  addEventListener('pagehide', () => {
    if (timer) write();
  });
  // Jiná záložka uložila data: převezmi je, ať si záložky navzájem nepřepisují faktury.
  addEventListener('storage', (event) => {
    if (event.key !== KEY || !event.newValue) return;
    try {
      const data = JSON.parse(event.newValue);
      if (!isObject(data) || data.version !== 1) return;
      if (timer) clearTimeout(timer);
      timer = null;
      applyState(normalizeState(data));
      if (changeHandler) changeHandler();
    } catch {
      /* cizí nebo poškozená data nech být */
    }
  });
}

// ---- operace ------------------------------------------------------------

/** Faktury k zobrazení: vlastní, nebo ukázkové, dokud se uživatel jen rozhlíží. */
export function visibleInvoices() {
  if (state.invoices.length || !state.demo) return { list: state.invoices, example: false };
  return { list: exampleInvoices(), example: true };
}

/** Uložená faktura, kterou má editor právě otevřenou (nebo null). */
export function storedDraftInvoice() {
  return state.draft.id ? state.invoices.find((inv) => inv.id === state.draft.id) || null : null;
}

/**
 * Uloží koncept do přehledu: nová faktura, nebo přepis té otevřené.
 * `asNew` uloží i otevřenou fakturu jako další (když v ní uživatel začal psát jinou).
 * @returns {{ ok: boolean, invoice: object, created: boolean }} ok = false, když se nepodařil zápis do úložiště
 */
export function saveDraftAsInvoice({ asNew = false } = {}) {
  const draft = state.draft;
  const stored = asNew ? null : storedDraftInvoice();
  const copy = cleanInvoice({ ...JSON.parse(JSON.stringify(draft)), id: stored ? stored.id : uid() });
  if (stored) {
    // Co se o faktuře stalo mimo editor (zaplacení, upomínky), se přepisem nesmí ztratit.
    copy.paidAt = stored.paidAt;
    copy.reminders = stored.reminders;
    copy.createdAt = stored.createdAt;
    state.invoices[state.invoices.indexOf(stored)] = copy;
  } else {
    copy.paidAt = null;
    copy.reminders = [];
    copy.createdAt = new Date().toISOString();
    state.invoices.unshift(copy);
    // Dodavatel z nové faktury je od teď výchozí; oprava staré faktury profil nemění.
    Object.assign(state.profile, cleanSupplier(draft.supplier));
  }
  draft.id = copy.id;
  if (!state.issuedNumbers.includes(copy.number)) state.issuedNumbers = [copy.number, ...state.issuedNumbers].slice(0, 500);
  state.demo = false;
  state.dirty = false;
  return { ok: persist(true), invoice: copy, created: !stored };
}

export function startNewDraft() {
  state.draft = newDraft(state.profile, state.invoices, state.issuedNumbers);
  state.dirty = false;
  persist();
}

/** Otevře uloženou fakturu v editoru. */
export function editInvoice(invoice) {
  state.draft = cleanInvoice(JSON.parse(JSON.stringify(invoice)), { draft: true });
  state.dirty = false;
  persist();
}

/** Nový koncept se stejným odběratelem a položkami jako daná faktura. */
export function duplicateAsDraft(invoice) {
  const copy = cleanInvoice(JSON.parse(JSON.stringify(invoice)), { draft: true });
  const draft = newDraft(state.profile, state.invoices, state.issuedNumbers);
  Object.assign(draft, { client: copy.client, items: copy.items, note: copy.note, currency: copy.currency, lang: copy.lang, zeroVatNote: copy.zeroVatNote });
  state.draft = draft;
  state.dirty = true;
  persist();
  return draft;
}

export function deleteInvoice(id) {
  state.invoices = state.invoices.filter((inv) => inv.id !== id);
  if (state.draft.id === id) state.draft.id = null;
  return persist(true);
}

export function clearExample() {
  state.demo = false;
  state.dirty = false;
  Object.assign(state.profile, emptyProfile());
  Object.assign(state.qr, QR_DEFAULTS);
  state.draft = newDraft(state.profile, state.invoices, state.issuedNumbers);
  persist(true);
}

export function exportBackup() {
  return JSON.stringify({ app: 'cinkne', exportedAt: new Date().toISOString(), data: state }, null, 2);
}

/**
 * Přečte zálohu, aniž by cokoli změnil.
 * @returns {{ data: object, count: number }} vyčištěný stav a počet faktur v něm
 * @throws {Error} se srozumitelnou zprávou
 */
export function inspectBackup(fileText) {
  let parsed;
  try {
    parsed = JSON.parse(fileText);
  } catch {
    throw new Error('Soubor není platná záloha (nejde přečíst jako JSON).');
  }
  const raw = isObject(parsed) && parsed.app === 'cinkne' ? parsed.data : null;
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.invoices)) {
    throw new Error('Soubor nevypadá jako záloha z Cinkne.');
  }
  const data = normalizeState(raw);
  return { data, count: data.invoices.length };
}

/** Nahradí data zálohou z inspectBackup(). Odemčení Pro zůstává, jak bylo. */
export function applyBackup(data) {
  const pro = { ...state.pro };
  applyState({ ...data, pro, demo: false });
  refreshPristineDraft();
  return persist(true);
}

/** Smaže všechna uložená data (záchrana při poškozeném stavu). */
export function resetAll() {
  if (timer) clearTimeout(timer);
  timer = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* není co mazat */
  }
}

/** Zkusí do úložiště zapsat; false znamená, že se data po zavření stránky ztratí. */
export function storageWorks() {
  try {
    localStorage.setItem(KEY + ':test', '1');
    localStorage.removeItem(KEY + ':test');
    return true;
  } catch {
    return false;
  }
}
