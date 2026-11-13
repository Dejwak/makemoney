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

/** Které údaje dodavatele jsou pořád ty ukázkové (účet, IČO, e-mail). */
export function exampleSupplierFields(supplier) {
  const example = exampleProfile();
  const labels = { account: 'číslo účtu', ico: 'IČO', email: 'e-mail' };
  return Object.keys(labels).filter((key) => supplier && String(supplier[key] || '').trim() === example[key]).map((key) => labels[key]);
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
      profile: { ...emptyProfile(), logo: null, color: '' },
      invoices: [], issuedNumbers: [], draft: exampleDraft(),
      pro: { unlocked: false, order: '' },
      rate: { ...RATE_DEFAULTS }, qr: { ...QR_DEFAULTS }, reminder: { interestRate: '' },
      lastBackupAt: '',
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
    if (!color && typeof source.color === 'string' && /^#[0-9a-f]{6}$/i.test(source.color)) color = source.color;
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
  // Starší data příznak rozepsanosti neměla: koncept s odběratelem nebo cenou ber jako rozepsaný.
  const edited = !draft.id && (draft.client.name.trim() !== '' || draft.items.some((item) => String(item.price).trim() !== ''));
  return {
    version: 1,
    demo: !!raw.demo && invoices.length === 0,
    dirty: raw.dirty === undefined ? edited && !raw.demo : !!raw.dirty,
    profile,
    invoices,
    issuedNumbers,
    draft,
    pro: { unlocked: !!(isObject(raw.pro) && raw.pro.unlocked), order: isObject(raw.pro) ? text(raw.pro.order, 10).replace(/\D/g, '') : '' },
    rate,
    qr: pick(raw.qr, Object.keys(QR_DEFAULTS), 80),
    reminder: { interestRate: isObject(raw.reminder) ? text(raw.reminder.interestRate, 12) : '' },
    lastBackupAt: Number.isNaN(Date.parse(raw.lastBackupAt)) ? '' : new Date(raw.lastBackupAt).toISOString(),
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

let lastRaw = null; // co je podle nás v úložišti; podle toho se pozná změna z jiné záložky

function parseStored(raw) {
  try {
    const data = raw ? JSON.parse(raw) : null;
    return isObject(data) && data.version === 1 ? data : null;
  } catch {
    return null;
  }
}

function read() {
  try {
    lastRaw = localStorage.getItem(KEY);
  } catch {
    lastRaw = null;
  }
  return parseStored(lastRaw);
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
    const raw = JSON.stringify(state);
    localStorage.setItem(KEY, raw);
    lastRaw = raw;
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

/**
 * Převezme data, která do úložiště zapsala jiná záložka (raw = nový obsah, null = smazáno).
 * Rozepsaná faktura téhle záložky má přednost; sama nic nezapisuje, aby se záložky nepřetahovaly.
 * @returns {boolean} true, když se něco změnilo
 */
export function syncFromStorage(raw) {
  if (raw === lastRaw) return false;
  const busy = state.dirty || timer !== null;
  if (raw === null) {
    // Jinde proběhlo „Začít s čistými daty“. Kdo tu má rozepsáno, o práci nepřijde.
    if (busy) return false;
    lastRaw = null;
    applyState(normalizeState(null));
  } else {
    const data = parseStored(raw);
    if (!data) return false;
    lastRaw = raw;
    const next = normalizeState(data);
    if (busy) {
      next.draft = state.draft;
      next.dirty = state.dirty;
      if (state.draft.id && !next.invoices.some((inv) => inv.id === state.draft.id)) state.draft.id = null;
    }
    applyState(next);
  }
  if (changeHandler) changeHandler();
  return true;
}

if (typeof addEventListener === 'function') {
  // Rozepsané změny zapiš i při zavření nebo přepnutí stránky.
  addEventListener('pagehide', () => {
    if (timer) write();
  });
  addEventListener('storage', (event) => {
    if (event.key === KEY) syncFromStorage(event.newValue);
  });
  // Záložka, která byla uspaná, mohla změny z jiných záložek zmeškat.
  const catchUp = () => {
    try {
      syncFromStorage(localStorage.getItem(KEY));
    } catch {
      /* úložiště není dostupné */
    }
  };
  addEventListener('pageshow', (event) => {
    if (event.persisted) catchUp();
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) catchUp();
    });
  }
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
  if (!copy) return { ok: false, invoice: draft, created: false }; // bez čísla není co uložit
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
  draft.paidAt = copy.paidAt;
  if (!state.issuedNumbers.includes(copy.number)) state.issuedNumbers = [copy.number, ...state.issuedNumbers].slice(0, 500);
  state.demo = false;
  state.dirty = false;
  const ok = persist(true);
  if (ok) requestPersistentStorage();
  return { ok, invoice: copy, created: !stored };
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
  if (state.draft.id === id) {
    state.draft.id = null;
    state.draft.paidAt = null;
  }
  return persist(true);
}

/** Zahodí ukázkovou fakturu. Kdo už má vlastní údaje, tomu zůstanou. */
export function clearExample() {
  if (!state.demo) {
    startNewDraft();
    return;
  }
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

/** Čísla, která má víc faktur najednou (bez ohledu na velikost písmen). */
export function duplicateNumbers(invoices) {
  const counts = new Map();
  for (const inv of invoices) {
    const key = String(inv.number).trim().toLowerCase();
    if (!counts.has(key)) counts.set(key, { number: String(inv.number).trim(), count: 0 });
    counts.get(key).count += 1;
  }
  return [...counts.values()].filter((entry) => entry.count > 1).map((entry) => entry.number);
}

/**
 * Přečte zálohu, aniž by cokoli změnil.
 * @returns {{ data: object, count: number, duplicates: string[] }} vyčištěný stav, počet faktur a čísla použitá vícekrát
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
  return { data, count: data.invoices.length, duplicates: duplicateNumbers(data.invoices) };
}

/** Nahradí data zálohou z inspectBackup(). Odemčení Pro zůstává, jak bylo. */
export function applyBackup(data) {
  const pro = { ...state.pro };
  // Co se právě načetlo ze zálohy, v záloze je.
  applyState({ ...data, pro, demo: false, lastBackupAt: new Date().toISOString() });
  refreshPristineDraft();
  return persist(true);
}

/** Poznačí, že si uživatel právě stáhl zálohu. */
export function markBackedUp() {
  state.lastBackupAt = new Date().toISOString();
  return persist(true);
}

/**
 * Faktury, které vznikly po poslední záloze.
 * @returns {{ count: number, oldest: string }} oldest = kdy vznikla nejstarší z nich (ISO), nebo ''
 */
export function unbackedInvoices() {
  const fresh = state.invoices.filter((inv) => inv.createdAt && (!state.lastBackupAt || inv.createdAt > state.lastBackupAt));
  return { count: fresh.length, oldest: fresh.map((inv) => inv.createdAt).sort()[0] || '' };
}

let persistAsked = false;
/** Požádá prohlížeč, aby data téhle stránky sám nemazal. Nic nezaručuje, jen snižuje riziko. */
function requestPersistentStorage() {
  if (persistAsked) return;
  persistAsked = true;
  try {
    const request = globalThis.navigator?.storage?.persist?.();
    if (request && typeof request.catch === 'function') request.catch(() => {});
  } catch {
    /* prohlížeč to neumí */
  }
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
