// Testy stavu aplikace nad napodobeninou localStorage.

import { test } from 'node:test';
import assert from 'node:assert/strict';

function fakeStorage({ quota = Infinity } = {}) {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem(k, v) {
      const value = String(v);
      if (value.length > quota) throw new Error('QuotaExceededError');
      data.set(k, value);
    },
    removeItem: (k) => data.delete(k),
  };
}

let counter = 0;
/** Čerstvá instance modulu store.js nad daným úložištěm. */
async function freshStore(storage = fakeStorage()) {
  globalThis.localStorage = storage;
  const store = await import(`../assets/js/lib/store.js?instance=${++counter}`);
  return { store, state: store.state, storage };
}

function fillDraft(state, over = {}) {
  Object.assign(state.draft.supplier, { name: 'Petr Svoboda', street: 'Dlouhá 1', city: 'Praha', account: '2000145399/0800' });
  state.draft.client.name = 'Klient A';
  state.draft.items = [{ desc: 'Práce', qty: 1, unit: 'h', price: 1000, vat: 21 }];
  Object.assign(state.draft, over);
}

test('první spuštění ukáže ukázku a nic neukládá', async () => {
  const { state, store, storage } = await freshStore();
  assert.equal(state.demo, true);
  assert.equal(store.visibleInvoices().example, true);
  assert.equal(storage.data.size, 0);
  assert.equal(state.rate.taxPct, 15);
});

test('opakované uložení nesmaže zaplacení ani upomínky a fakturu nezdvojí', async () => {
  const { state, store } = await freshStore();
  fillDraft(state);
  const first = store.saveDraftAsInvoice();
  assert.ok(first.ok && first.created);
  state.invoices[0].paidAt = '2026-11-12';
  state.invoices[0].reminders.push({ date: '2026-11-10', tone: 'friendly' });
  const createdAt = state.invoices[0].createdAt;
  state.draft.note = 'opravená poznámka';
  const second = store.saveDraftAsInvoice();
  assert.equal(second.created, false);
  assert.equal(state.invoices.length, 1);
  assert.equal(state.invoices[0].note, 'opravená poznámka');
  assert.equal(state.invoices[0].paidAt, '2026-11-12');
  assert.equal(state.invoices[0].reminders.length, 1);
  assert.equal(state.invoices[0].createdAt, createdAt);
});

test('uložit jako novou nechá původní fakturu být', async () => {
  const { state, store } = await freshStore();
  fillDraft(state);
  store.saveDraftAsInvoice();
  state.draft.number = '20260002';
  state.draft.client.name = 'Klient B';
  store.saveDraftAsInvoice({ asNew: true });
  assert.deepEqual(state.invoices.map((i) => `${i.number} ${i.client.name}`), ['20260002 Klient B', '20260001 Klient A']);
  assert.notEqual(state.invoices[0].id, state.invoices[1].id);
});

test('oprava staré faktury nezmění výchozí účet, nová faktura ano', async () => {
  const { state, store } = await freshStore();
  fillDraft(state);
  store.saveDraftAsInvoice();
  const old = state.invoices[0];
  store.startNewDraft();
  fillDraft(state);
  state.draft.supplier.account = '19-2000145399/0800';
  state.draft.number = '20260002';
  store.saveDraftAsInvoice();
  assert.equal(state.profile.account, '19-2000145399/0800');
  store.editInvoice(old);
  state.draft.note = 'překlep';
  store.saveDraftAsInvoice();
  assert.equal(state.profile.account, '19-2000145399/0800', 'profil zůstal u novějšího účtu');
});

test('smazaná faktura neuvolní své číslo a ukázky se nevrátí', async () => {
  const { state, store } = await freshStore();
  fillDraft(state);
  store.saveDraftAsInvoice();
  store.deleteInvoice(state.invoices[0].id);
  store.startNewDraft();
  assert.equal(state.draft.number.slice(4), '0002');
  assert.deepEqual(store.visibleInvoices(), { list: [], example: false });
});

test('plné úložiště: uložení ohlásí neúspěch', async () => {
  const { state, store } = await freshStore(fakeStorage({ quota: 50 }));
  let failures = 0;
  store.onStorageFailure(() => { failures += 1; });
  fillDraft(state);
  const result = store.saveDraftAsInvoice();
  assert.equal(result.ok, false);
  assert.equal(failures, 1);
  assert.equal(state.invoices.length, 1, 'v paměti faktura zůstává, aby šla stáhnout');
  assert.equal(store.storageWorks(), true);
});

test('logo se ukládá jednou u profilu, ne v každé faktuře', async () => {
  const { state, store, storage } = await freshStore();
  const logo = { data: 'data:image/png;base64,' + 'A'.repeat(40000), w: 300, h: 100 };
  state.profile.logo = logo;
  const sizes = [];
  for (let i = 1; i <= 3; i++) {
    store.startNewDraft();
    fillDraft(state, { number: '2026000' + i });
    store.saveDraftAsInvoice();
    sizes.push(storage.data.get('cinkne:v1').length);
  }
  assert.ok(sizes[2] - sizes[1] < 5000, `přírůstek na fakturu: ${sizes[2] - sizes[1]}`);
  assert.equal(JSON.stringify(state.invoices).includes('AAAAAAAA'), false);
});

test('starší data s logem u dodavatele se převedou do profilu', async () => {
  const { store } = await freshStore();
  const logo = { data: 'data:image/png;base64,QUJD', w: 10, h: 5 };
  const clean = store.normalizeState({ version: 1, profile: { name: 'X' }, invoices: [{ id: 'a', number: '1', supplier: { name: 'X', logo, color: '#112233' } }] });
  assert.deepEqual(clean.profile.logo, logo);
  assert.equal(clean.profile.color, '#112233');
  assert.equal('logo' in clean.invoices[0].supplier, false);
});

test('normalizeState z nesmyslu udělá použitelný stav', async () => {
  const { store } = await freshStore();
  const hostile = JSON.parse('{"version":1,"demo":true,"invoices":[null,7,{"id":"a\\"b<","number":" 7 ","currency":"KČ","items":[null],"due":"","paidAt":"zítra","reminders":"x"},{"id":"a\\"b<","number":"8"},{"number":""}],"draft":{},"rate":null,"qr":"x","reminder":null,"pro":{"unlocked":"ano"},"profile":{"logo":{"data":"javascript:alert(1)","w":1,"h":1}},"__proto__":{"evil":1}}');
  const s = store.normalizeState(hostile);
  assert.equal(s.invoices.length, 2);
  assert.equal(s.invoices[0].id, 'ab');
  assert.notEqual(s.invoices[1].id, 'ab', 'duplicitní id dostane nové');
  assert.equal(s.invoices[0].number, '7');
  assert.equal(s.invoices[0].currency, 'CZK');
  assert.equal(s.invoices[0].paidAt, null);
  assert.deepEqual(s.invoices[0].reminders, []);
  assert.equal(s.invoices[0].items.length, 1);
  assert.ok(s.draft.number && s.draft.supplier && s.draft.items.length === 1);
  assert.equal(s.rate.netMonthly, 60000);
  assert.deepEqual(s.qr, { account: '', amount: '', vs: '', message: '', name: '' });
  assert.equal(s.profile.logo, null);
  assert.equal(s.demo, false, 'ukázka jen bez vlastních faktur');
  assert.equal(s.evil, undefined);
  assert.equal({}.evil, undefined);
});

test('záloha: export, kontrola, obnova; odemčené Pro a odkazy na stav zůstávají', async () => {
  const { state, store } = await freshStore();
  fillDraft(state);
  store.saveDraftAsInvoice();
  state.rate.netMonthly = '80000';
  const backup = store.exportBackup();
  const rate = state.rate;
  const qr = state.qr;
  state.pro.unlocked = true;
  store.deleteInvoice(state.invoices[0].id);
  state.rate.netMonthly = '12345';
  const inspected = store.inspectBackup(backup);
  assert.equal(inspected.count, 1);
  assert.equal(state.invoices.length, 0, 'prohlédnutí zálohy nic nemění');
  assert.equal(store.applyBackup(inspected.data), true);
  assert.equal(state.invoices.length, 1);
  assert.equal(state.rate, rate);
  assert.equal(state.qr, qr);
  assert.equal(state.rate.netMonthly, '80000');
  assert.equal(state.pro.unlocked, true);
  for (const bad of ['garbage', '[]', 'null', '{"app":"jina"}', '{"app":"cinkne","data":{"version":2,"invoices":[]}}', '{"app":"cinkne","data":{"version":1}}']) {
    assert.throws(() => store.inspectBackup(bad), /záloha/i, bad);
  }
});

test('uložený stav se po novém načtení vrátí celý', async () => {
  const storage = fakeStorage();
  const a = await freshStore(storage);
  fillDraft(a.state);
  a.store.saveDraftAsInvoice();
  a.state.qr.amount = '450';
  a.store.persist(true);
  const b = await freshStore(storage);
  assert.equal(b.state.invoices.length, 1);
  assert.equal(b.state.invoices[0].client.name, 'Klient A');
  assert.equal(b.state.qr.amount, '450');
  assert.equal(b.state.demo, false);
});

test('rozepsaná faktura z minula si drží data, nedotčený koncept se obnoví na dnešek', async () => {
  const storage = fakeStorage();
  const a = await freshStore(storage);
  a.store.clearExample();
  a.state.draft.issued = '2026-01-05';
  a.state.draft.due = '2026-01-19';
  a.store.persist(true);
  const pristine = await freshStore(storage);
  assert.notEqual(pristine.state.draft.issued, '2026-01-05');
  pristine.state.draft.issued = '2026-01-05';
  pristine.state.draft.client.name = 'Rozepsaný';
  pristine.store.touchDraft();
  pristine.store.persist(true);
  const dirty = await freshStore(storage);
  assert.equal(dirty.state.draft.issued, '2026-01-05');
  assert.equal(dirty.state.draft.client.name, 'Rozepsaný');
});

test('kopie faktury dostane nové číslo a dnešní data', async () => {
  const { state, store } = await freshStore();
  fillDraft(state, { issued: '2026-01-05', due: '2026-01-19' });
  store.saveDraftAsInvoice();
  store.duplicateAsDraft(state.invoices[0]);
  assert.equal(state.draft.id, null);
  assert.equal(state.draft.client.name, 'Klient A');
  assert.notEqual(state.draft.number, state.invoices[0].number);
  assert.notEqual(state.draft.issued, '2026-01-05');
  assert.equal(state.draft.paidAt, null);
});

test('ukázkový dodavatel se do profilu nedostane a ukázkové hodnoty se poznají', async () => {
  const { state, store, storage } = await freshStore();
  assert.equal(state.profile.account, '');
  assert.equal(state.draft.supplier.account, '19-2000145399/0800');
  assert.deepEqual(store.exampleSupplierFields(state.draft.supplier), ['číslo účtu', 'IČO', 'e-mail']);
  assert.deepEqual(store.exampleSupplierFields({ account: '2000145399/0800', ico: '12345679' }), ['IČO']);
  state.demo = false; // „Skrýt“
  store.persist(true);
  assert.equal(JSON.parse(storage.data.get('cinkne:v1')).profile.account, '');
});

test('po prvním uložení už „začít s prázdnou“ nemaže vlastní údaje', async () => {
  const { state, store } = await freshStore();
  fillDraft(state);
  store.saveDraftAsInvoice();
  assert.equal(state.profile.name, 'Petr Svoboda');
  store.clearExample();
  assert.equal(state.profile.name, 'Petr Svoboda');
  assert.equal(state.profile.account, '2000145399/0800');
  assert.equal(state.draft.supplier.name, 'Petr Svoboda');
  assert.equal(state.draft.id, null);
});

test('uložení jako nová a smazání nenechá v konceptu cizí stav zaplacení', async () => {
  const { state, store } = await freshStore();
  fillDraft(state);
  store.saveDraftAsInvoice();
  state.invoices[0].paidAt = '2026-11-12';
  store.editInvoice(state.invoices[0]);
  assert.equal(state.draft.paidAt, '2026-11-12');
  state.draft.number = '20260002';
  store.saveDraftAsInvoice({ asNew: true });
  assert.equal(state.draft.paidAt, null);
  assert.equal(state.invoices[0].paidAt, null);
  store.editInvoice(state.invoices[1]);
  store.deleteInvoice(state.invoices[1].id);
  assert.equal(state.draft.paidAt, null);
  assert.equal(state.draft.id, null);
});

test('starší data bez příznaku rozepsanosti o rozepsanou fakturu nepřijdou', async () => {
  const { store } = await freshStore();
  const legacy = { version: 1, demo: false, invoices: [], profile: { name: 'X' }, draft: { number: '20260001', issued: '2026-01-05', due: '2026-01-19', supplier: { name: 'X' }, client: { name: 'Rozepsaný klient' }, items: [{ desc: 'a', qty: 1, price: '500' }] } };
  assert.equal(store.normalizeState(legacy).dirty, true);
  assert.equal(store.normalizeState({ ...legacy, draft: { ...legacy.draft, client: {}, items: [{}] } }).dirty, false);
  assert.equal(store.normalizeState({ ...legacy, profile: { color: ['#aabbcc'] } }).profile.color, '');
});

test('změna z jiné záložky: rozepsaná faktura zůstane, ostatní se převezme', async () => {
  const storage = fakeStorage();
  const a = await freshStore(storage);
  fillDraft(a.state);
  a.store.saveDraftAsInvoice();
  const b = await freshStore(storage);
  let notified = 0;
  b.store.onExternalChange(() => { notified += 1; });
  // B má rozepsáno, A mezitím uloží další fakturu
  b.store.startNewDraft();
  b.state.draft.client.name = 'Rozepsáno v B';
  b.store.touchDraft();
  const draftB = b.state.draft;
  a.store.startNewDraft();
  fillDraft(a.state, { number: '20260002' });
  a.state.draft.client.name = 'Klient z A';
  a.store.saveDraftAsInvoice();
  assert.equal(b.store.syncFromStorage(storage.data.get('cinkne:v1')), true);
  assert.equal(notified, 1);
  assert.equal(b.state.invoices.length, 2, 'B vidí fakturu z A');
  assert.equal(b.state.draft, draftB, 'editor v B dál píše do stejného konceptu');
  assert.equal(b.state.draft.client.name, 'Rozepsáno v B');
  assert.equal(b.state.dirty, true);
  b.store.persist(true);
  assert.equal(JSON.parse(storage.data.get('cinkne:v1')).invoices.length, 2, 'zápis z B fakturu z A nesmaže');
  // stejný obsah podruhé nic nedělá, takže se záložky nepřetahují
  assert.equal(b.store.syncFromStorage(storage.data.get('cinkne:v1')), false);
  assert.equal(notified, 1);
});

test('změna z jiné záložky: kdo nic rozepsaného nemá, převezme vše; smazání dat práci nezahodí', async () => {
  const storage = fakeStorage();
  const a = await freshStore(storage);
  fillDraft(a.state);
  a.store.saveDraftAsInvoice();
  const b = await freshStore(storage);
  a.state.draft.note = 'změna v A';
  a.store.touchDraft();
  a.store.persist(true);
  b.store.syncFromStorage(storage.data.get('cinkne:v1'));
  assert.equal(b.state.draft.note, 'změna v A');
  // „Začít s čistými daty“ v A: B bez rozepsané práce se vrátí na začátek
  b.state.dirty = false;
  assert.equal(b.store.syncFromStorage(null), true);
  assert.equal(b.state.invoices.length, 0);
  assert.equal(b.state.demo, true);
  // ale záložka s rozepsanou fakturou si data nechá
  const c = await freshStore(fakeStorage());
  fillDraft(c.state);
  c.store.touchDraft();
  c.store.persist(true);
  assert.equal(c.store.syncFromStorage(null), false);
  assert.equal(c.state.draft.client.name, 'Klient A');
});

test('kontrola faktury: co brání uložení a na co jen upozorní', async () => {
  const { state } = await freshStore();
  const { validateInvoice } = await import('../assets/js/views/invoice.js');
  assert.match(validateInvoice(state.draft).problems.join(' '), /ukázkové hodnoty \(číslo účtu, IČO, e-mail\)/);
  fillDraft(state);
  Object.assign(state.draft.supplier, { ico: '', email: '' });
  let result = validateInvoice(state.draft);
  assert.deepEqual(result.problems, []);
  assert.match(result.warnings.join(' '), /chybí IČO.*příležitostnou činnost/);
  assert.match(result.warnings.join(' '), /Bez IČO nejsi v živnostenském rejstříku/, 'výchozí zápis v rejstříku bez IČO nesedí');
  state.draft.supplier.register = '';
  assert.ok(!/rejstříku/.test(validateInvoice(state.draft).warnings.join(' ')));
  state.draft.supplier.ico = '27074358';
  assert.deepEqual(validateInvoice(state.draft).warnings, []);
  Object.assign(state.draft.supplier, { ico: '', email: '' });
  const check = (change) => {
    const draft = JSON.parse(JSON.stringify(state.draft));
    change(draft);
    return validateInvoice(draft, [{ id: 'jina', number: '77' }]).problems.join(' | ');
  };
  assert.match(check((d) => { d.number = '77'; }), /už má jiná faktura/);
  assert.match(check((d) => { d.supplier.street = ''; }), /adresu/);
  assert.match(check((d) => { d.due = '3850-11-27'; }), /Zkontroluj datum/);
  assert.match(check((d) => { d.issued = '0202-11-12'; }), /Zkontroluj datum/);
  assert.match(check((d) => { d.due = '2029-11-27'; }), /dva roky/);
  assert.match(check((d) => { d.items[0].price = '1.250'; }), /ceně nerozumím/);
  assert.match(check((d) => { d.supplier.vatPayer = true; }), /DIČ/);
  assert.match(check((d) => { d.supplier.vatPayer = true; d.supplier.dic = 'CZ1'; d.currency = 'EUR'; }), /kurz/);
  assert.match(check((d) => { d.supplier.vatPayer = true; d.supplier.dic = 'CZ1'; d.items[0].vat = 0; }), /0 % DPH/);
  assert.match(check((d) => { d.items = Array.from({ length: 201 }, () => ({ desc: 'a', qty: 1, price: 1 })); }), /nejvýš 200 položek/);
});

test('CSV: text od uživatele se zneškodní, záporné částky zůstanou čísly', async () => {
  await freshStore();
  const { invoicesCsv } = await import('../assets/js/views/overview.js');
  const csv = invoicesCsv([{
    number: '-2026/1', vs: '1', issued: '2026-11-12', due: '2026-11-26', currency: 'CZK',
    supplier: { vatPayer: true }, client: { name: '=HYPERLINK("http://x";"klik")', ico: '@SUM(1)', dic: '' },
    items: [{ qty: 1, price: -100, vat: 21 }],
  }]);
  const row = csv.split('\r\n')[1];
  assert.ok(row.startsWith("'-2026/1;\"'=HYPERLINK(\"\"http://x\"\";\"\"klik\"\")\";'@SUM(1);"), row);
  assert.ok(row.includes(';-100,00;-21,00;-121,00;CZK;'), row);
});

test('odkaz se žádostí o platbu: zakódování a zpět', async () => {
  await freshStore();
  const { encodeRequest, decodeRequest } = await import('../assets/js/views/qr.js');
  const q = { account: '19-2000145399/0800', amount: '450,50', vs: '123', message: 'Půlka za chatu 🏡', name: 'Žaneta' };
  const encoded = encodeRequest(q);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeRequest(encoded), q);
  assert.equal(decodeRequest('%%%'), null);
  assert.equal(decodeRequest(Buffer.from('[1,2]').toString('base64')).account, '');
  assert.equal(decodeRequest(Buffer.from('{"v":"12AB34567890123"}').toString('base64')).vs, '4567890123');
});

test('záloha se stejným číslem u více faktur na to upozorní', async () => {
  const { store } = await freshStore();
  const invoices = [{ id: 'a', number: '20260001' }, { id: 'b', number: 'x-2' }, { id: 'c', number: '20260001' }, { id: 'd', number: 'X-2' }, { id: 'e', number: '7' }];
  assert.deepEqual(store.duplicateNumbers(invoices), ['20260001', 'x-2']);
  const inspected = store.inspectBackup(JSON.stringify({ app: 'cinkne', data: { version: 1, invoices } }));
  assert.equal(inspected.count, 5);
  assert.deepEqual(inspected.duplicates, ['20260001', 'x-2']);
  assert.deepEqual(store.inspectBackup(JSON.stringify({ app: 'cinkne', data: { version: 1, invoices: invoices.slice(0, 2) } })).duplicates, []);
});
