// Stav aplikace. Všechno zůstává v prohlížeči (localStorage); bez něj běží jen v paměti.

import { addDays, nextInvoiceNumber, todayIso, toVs } from './calc.js';

const KEY = 'cinkne:v1';

export const REGISTER_NOTE = 'Fyzická osoba zapsaná v živnostenském rejstříku.';

export function emptyProfile() {
  return {
    name: '', street: '', zip: '', city: '', ico: '', dic: '', vatPayer: false,
    account: '', email: '', phone: '', register: REGISTER_NOTE, logo: null, color: '',
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

export function newDraft(profile, invoices) {
  const today = todayIso();
  const number = nextInvoiceNumber(invoices.map((i) => i.number));
  return {
    id: null,
    number,
    vs: toVs(number),
    issued: today,
    duzp: today,
    due: addDays(today, 14),
    currency: 'CZK',
    supplier: { ...emptyProfile(), ...profile },
    client: emptyClient(),
    items: [emptyItem()],
    note: '',
    paidAt: null,
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
    { desc: 'Focení interiéru a nápojů', qty: 4, unit: 'hod', price: 950, vat: 21 },
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
    id: 'example-' + seq,
    example: true,
    number: year + String(seq).padStart(4, '0'),
    vs: year + String(seq).padStart(4, '0'),
    issued: addDays(today, -issuedAgo),
    duzp: addDays(today, -issuedAgo),
    due: addDays(today, dueIn),
    currency: 'CZK',
    supplier,
    client: { ...emptyClient(), name: clientName, email },
    items,
    note: '',
    paidAt: paidAgo == null ? null : addDays(today, -paidAgo),
  });
  return [
    make(3, 'Kavárna Pod Věží s.r.o.', 'ucetni@example.cz', 4, 10, [{ desc: 'Návrh jídelního lístku', qty: 1, unit: 'ks', price: 12300, vat: 21 }], null),
    make(2, 'Truhlářství Dvořák', 'dvorak@example.cz', 26, -12, [{ desc: 'Webová prezentace', qty: 1, unit: 'ks', price: 24000, vat: 21 }], null),
    make(1, 'Studio Lípa', 'studio@example.cz', 40, -26, [{ desc: 'Korektury textů', qty: 6, unit: 'hod', price: 700, vat: 21 }], 30),
  ];
}

// ---- úložiště -----------------------------------------------------------

function defaults() {
  return {
    version: 1,
    demo: true,
    profile: exampleProfile(),
    invoices: [],
    draft: exampleDraft(),
    pro: { unlocked: false },
    rate: { netMonthly: 60000, costsMonthly: 6000, taxPct: 20, hoursPerWeek: 40, billablePct: 60, weeksOff: 6, currentRate: '' },
    qr: { account: '', amount: '', vs: '', message: '', name: '' },
    reminder: { interestRate: '' },
  };
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.version === 1 ? data : null;
  } catch {
    return null;
  }
}

export const state = { ...defaults(), ...(read() || {}) };

let timer = null;
let failureHandler = null;
/** Zavolá se, když se stav nepodaří uložit (anonymní okno, plné úložiště). */
export function onStorageFailure(handler) {
  failureHandler = handler;
}
function write() {
  timer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    if (failureHandler) failureHandler();
    return false;
  }
}

/** Uloží stav (se zpožděním, aby psaní do formuláře nezapisovalo při každém úhozu). */
export function persist(now = false) {
  if (timer) clearTimeout(timer);
  if (now) return write();
  timer = setTimeout(write, 250);
  return true;
}

// Rozepsané změny zapiš i při zavření nebo přepnutí stránky.
if (typeof addEventListener === 'function') {
  addEventListener('pagehide', () => {
    if (timer) {
      clearTimeout(timer);
      write();
    }
  });
}

/** Faktury k zobrazení: vlastní, nebo ukázkové, dokud žádné vlastní nejsou. */
export function visibleInvoices() {
  if (state.invoices.length) return { list: state.invoices, example: false };
  return { list: exampleInvoices(), example: true };
}

/** Uloží koncept do přehledu (nová faktura, nebo přepis existující). */
export function saveDraftAsInvoice() {
  const draft = state.draft;
  const copy = JSON.parse(JSON.stringify(draft));
  if (draft.id) {
    const i = state.invoices.findIndex((inv) => inv.id === draft.id);
    if (i >= 0) state.invoices[i] = copy;
    else state.invoices.unshift(copy);
  } else {
    draft.id = copy.id = uid();
    copy.createdAt = new Date().toISOString();
    state.invoices.unshift(copy);
  }
  state.demo = false;
  state.profile = { ...draft.supplier };
  persist(true);
  return copy;
}

/** Nový koncept se stejným odběratelem a položkami jako daná faktura. */
export function duplicateAsDraft(invoice) {
  const draft = newDraft(state.profile, state.invoices);
  const copy = JSON.parse(JSON.stringify(invoice));
  draft.client = { ...emptyClient(), ...copy.client };
  draft.items = copy.items && copy.items.length ? copy.items : draft.items;
  draft.note = copy.note || '';
  draft.currency = copy.currency || 'CZK';
  state.draft = draft;
  persist();
  return draft;
}

export function startNewDraft() {
  state.draft = newDraft(state.profile, state.invoices);
  persist();
}

export function clearExample() {
  state.demo = false;
  state.profile = emptyProfile();
  state.draft = newDraft(state.profile, state.invoices);
  persist(true);
}

export function exportBackup() {
  return JSON.stringify({ app: 'cinkne', exportedAt: new Date().toISOString(), data: state }, null, 2);
}

/** Načte zálohu; vrací počet faktur, nebo vyhodí chybu se srozumitelnou zprávou. */
export function importBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Soubor není platná záloha (nejde přečíst jako JSON).');
  }
  const data = parsed && parsed.app === 'cinkne' ? parsed.data : null;
  if (!data || data.version !== 1 || !Array.isArray(data.invoices)) {
    throw new Error('Soubor nevypadá jako záloha z Cinkne.');
  }
  Object.assign(state, defaults(), data);
  persist(true);
  return state.invoices.length;
}
