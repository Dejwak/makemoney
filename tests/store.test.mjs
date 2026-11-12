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
