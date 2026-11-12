import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCzAccount, czAccountToIban, isValidIban, ibanToCzAccount, normalizeAccount, formatIban } from '../assets/js/lib/iban.js';
import { buildSpayd, buildEpc, parseSpayd, spaydText } from '../assets/js/lib/spayd.js';
import { qrMatrix, qrRuns, qrSvg } from '../assets/js/lib/qr.js';
import {
  parseAmount, num, isAmount, toCents, formatMoney, formatUnitPrice, formatWhole, invoiceTotals, yearTurnover,
  addDays, daysBetween, formatDate, isIsoDate, isBusinessDate, nextInvoiceNumber, toVs, isValidIco, invoiceStatus,
  hourlyRate, netFromRate, lateInterest, statutoryInterestRate,
} from '../assets/js/lib/calc.js';
import { buildReminder, suggestTone, dayWord } from '../assets/js/lib/reminders.js';
import { invoicePayment } from '../assets/js/lib/payment.js';
import { layoutInvoice, wrapText, fitLine, PAGE } from '../assets/js/lib/layout.js';
import { pageToSvg } from '../assets/js/lib/render-svg.js';
import { safeFilename } from '../assets/js/lib/save.js';

const measure = (text, font, size) => text.length * size * 0.55;

const invoice = (over = {}) => ({
  number: '20260001',
  vs: '20260001',
  issued: '2026-11-11',
  due: '2026-11-25',
  currency: 'CZK',
  supplier: { name: 'Jana Nováková', account: '19-2000145399/0800', vatPayer: false },
  client: { name: 'Kavárna Pod Věží s.r.o.' },
  items: [
    { desc: 'Návrh', qty: 1, unit: 'ks', price: 8500, vat: 21 },
    { desc: 'Focení', qty: 4, unit: 'h', price: 950, vat: 21 },
  ],
  note: '',
  paidAt: null,
  ...over,
});
const layout = (inv, extra = {}) => layoutInvoice(inv, { measure, payment: invoicePayment(inv), branding: true, ...extra });
const texts = (pages) => pages.flat().filter((op) => op.t === 'text').map((op) => op.s);

// ---- účty ---------------------------------------------------------------

test('číslo účtu: kontrola modulo 11', () => {
  assert.deepEqual(parseCzAccount('19-2000145399/0800'), { prefix: '19', number: '2000145399', bank: '0800' });
  assert.deepEqual(parseCzAccount(' 2000145399 / 0800 '), { prefix: '', number: '2000145399', bank: '0800' });
  assert.equal(parseCzAccount('2000145398/0800'), null);
  assert.equal(parseCzAccount('123456789/0100'), null);
  assert.equal(parseCzAccount('nesmysl'), null);
  assert.equal(parseCzAccount('0/0800'), null);
});

test('IBAN: převod z českého čísla účtu a zpět', () => {
  const iban = czAccountToIban({ prefix: '19', number: '2000145399', bank: '0800' });
  assert.equal(iban, 'CZ6508000000192000145399');
  assert.ok(isValidIban(iban));
  assert.equal(ibanToCzAccount(iban), '19-2000145399/0800');
  assert.equal(formatIban(iban), 'CZ65 0800 0000 1920 0014 5399');
  assert.ok(isValidIban('GB82 WEST 1234 5698 7654 32'));
  assert.ok(!isValidIban('CZ6508000000192000145398'));
  assert.ok(!isValidIban('CZ65080000001920001453'));
  assert.ok(!isValidIban('CZ6108000000000000000000'), 'účet ze samých nul neexistuje');
});

test('normalizeAccount přijme účet i IBAN, pozná cizí účet a vrátí srozumitelnou chybu', () => {
  assert.deepEqual(normalizeAccount('19-2000145399/0800'), { ok: true, iban: 'CZ6508000000192000145399', account: '19-2000145399/0800', czech: true });
  assert.equal(normalizeAccount('cz65 0800 0000 1920 0014 5399').account, '19-2000145399/0800');
  assert.equal(normalizeAccount('000019-2000145399/0800').account, '19-2000145399/0800');
  assert.equal(normalizeAccount('DE89370400440532013000').czech, false);
  assert.equal(normalizeAccount('').ok, false);
  assert.match(normalizeAccount('124/0100').error, /nesedí/);
});

// ---- QR -----------------------------------------------------------------

test('SPAYD: formát QR Platby', () => {
  const s = buildSpayd({ iban: 'CZ65 0800 0000 1920 0014 5399', amount: 12300.5, vs: '20260001', message: 'Faktura č. 20260001 – žluťoučký kůň*', recipient: 'Jana Nováková' });
  assert.equal(s, 'SPD*1.0*ACC:CZ6508000000192000145399*AM:12300.50*CC:CZK*MSG:FAKTURA C. 20260001 ZLUTOUCKY KUN*RN:JANA NOVAKOVA*X-VS:20260001');
  assert.equal(parseSpayd(s)['X-VS'], '20260001');
  assert.equal(buildSpayd({ iban: 'CZ6508000000192000145399' }), 'SPD*1.0*ACC:CZ6508000000192000145399*CC:CZK');
  assert.equal(spaydText('x'.repeat(80), 60).length, 60);
  assert.throws(() => buildSpayd({ iban: '' }));
  assert.throws(() => buildSpayd({ iban: 'CZ6508000000192000145399', amount: 10000000 }));
});

test('SPAYD: znaky se zvláštním významem se do kódu nedostanou', () => {
  assert.equal(spaydText('Sleva 100%20 +bonus a*b', 60), 'SLEVA 100 20 BONUS A B');
  assert.equal(spaydText('Łukasz Søn Đorđe Straße', 60), 'LUKASZ SON DORDE STRASSE');
  assert.equal(buildSpayd({ iban: 'X*Y:1' }).split('*').length, 4, 'hvězdička v IBAN nesmí přidat pole');
});

test('SEPA QR pro eura', () => {
  const epc = buildEpc({ iban: 'CZ65 0800 0000 1920 0014 5399', bic: 'gibaczpx', name: 'Jana Nováková', amount: 1500, remittance: 'Invoice 20260001' });
  assert.deepEqual(epc.split('\n'), ['BCD', '002', '1', 'SCT', 'GIBACZPX', 'Jana Nováková', 'CZ6508000000192000145399', 'EUR1500.00', '', '', 'Invoice 20260001']);
  assert.throws(() => buildEpc({ iban: 'CZ6508000000192000145399', name: '', amount: 5 }));
  assert.throws(() => buildEpc({ iban: 'CZ6508000000192000145399', name: 'X', amount: 0 }));
  const long = buildEpc({ iban: 'CZ6508000000192000145399', bic: 'GIBA', name: 'Ž'.repeat(90), amount: 5, remittance: 'ř'.repeat(140) });
  assert.equal(long.split('\n')[4], '', 'nesmyslný BIC se vynechá');
  assert.equal([...long.split('\n')[5]].length, 70);
  assert.ok(new TextEncoder().encode(long).length <= 331, 'nejvýš 331 bajtů');
});

test('QR matice: čtverec, vyhledávací vzory, diakritika v UTF-8, bezpečný popisek', () => {
  const m = qrMatrix('SPD*1.0*ACC:CZ6508000000192000145399*AM:12300.50*CC:CZK*X-VS:20260001');
  assert.ok(m.length >= 21 && m.every((row) => row.length === m.length));
  for (let i = 0; i < 7; i++) assert.ok(m[0][i] && m[6][i] && m[i][0] && m[i][6]);
  assert.equal(qrRuns(m).reduce((s, r) => s + r.len, 0), m.flat().filter(Boolean).length);
  assert.ok(qrMatrix('Žluťoučký kůň '.repeat(4)).length > qrMatrix('Zlutoucky kun '.repeat(4)).length, 'UTF-8 zabere víc místa než ASCII');
  assert.ok(!qrSvg(m, { title: '"><script>' }).includes('"><script>'));
});

// ---- čísla a peníze -----------------------------------------------------

test('čísla v českém zápisu', () => {
  assert.equal(parseAmount('1 250,50'), 1250.5);
  assert.equal(parseAmount('1.250,50'), 1250.5);
  assert.equal(parseAmount('1,250.50'), 1250.5);
  assert.equal(parseAmount('500,-'), 500);
  assert.equal(parseAmount('12,50 Kč'), 12.5);
  assert.equal(parseAmount('12,5 %'), 12.5);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('1.250,-'), 1250);
  assert.equal(parseAmount('2.500 Kč'), 2500);
  assert.equal(parseAmount('1.000.000,-'), 1000000);
  assert.equal(parseAmount('12.345.678,90'), 12345678.9);
  assert.equal(parseAmount('0.125'), 0.125);
  assert.equal(parseAmount('1234.5'), 1234.5);
  for (const bad of ['abc', '1e3', '0x10', '1,2,3', '12 kusů', '+5', '5,']) assert.ok(Number.isNaN(parseAmount(bad)), bad);
  for (const unclear of ['1.250', '12.500', '1.000.000']) assert.ok(Number.isNaN(parseAmount(unclear)), `${unclear} může být tisíce i desetiny`);
  assert.equal(num('abc'), 0);
  assert.ok(isAmount('1 234,50') && !isAmount('1e3'));
});

test('zaokrouhlení a formát částek', () => {
  assert.equal(toCents(1.005), 101);
  assert.equal(toCents(-1.005), -101);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents(Infinity), 0);
  assert.ok(Object.is(toCents(-0.001), 0), 'žádná záporná nula');
  assert.equal(formatMoney(1234560), '12 345,60 Kč');
  assert.equal(formatMoney(150000, 'EUR'), '1 500,00 €');
  assert.equal(formatMoney(1230000, 'EUR', 'en'), '€12,300.00');
  assert.equal(formatUnitPrice(950), '950,00 Kč');
  assert.equal(formatUnitPrice(0.333), '0,333 Kč');
  assert.equal(formatWhole(-0.2), '0 Kč');
});

test('součty faktury: neplátce', () => {
  const t = invoiceTotals(invoice());
  assert.equal(t.total, 1230000);
  assert.equal(t.tax, 0);
  assert.equal(t.vatPayer, false);
});

test('součty faktury: plátce se dvěma sazbami, prázdný řádek nepřidá sazbu', () => {
  const t = invoiceTotals(invoice({
    supplier: { name: 'X', vatPayer: true },
    items: [
      { desc: 'A', qty: 2, price: 99.99, vat: 21 },
      { desc: 'B', qty: 1, price: 1000, vat: 12 },
      { desc: 'C', qty: 3, price: '10,5', vat: 21 },
      { desc: '', qty: 1, price: '', vat: 0 },
    ],
  }));
  assert.deepEqual(t.vat, [
    { rate: 21, base: 23148, tax: 4861 },
    { rate: 12, base: 100000, tax: 12000 },
  ]);
  assert.equal(t.total, 123148 + 4861 + 12000);
  assert.equal(t.zeroRated, false);
});

test('součty faktury: záporný základ je zrcadlem kladného, nesmysl se nepočítá', () => {
  const vat = (price) => invoiceTotals(invoice({ supplier: { vatPayer: true }, items: [{ qty: 1, price, vat: 21 }] })).tax;
  assert.equal(vat(2.5), 53);
  assert.equal(vat(-2.5), -53);
  const odd = invoiceTotals(invoice({ items: [{ qty: '1e308', price: '1e308' }, { qty: 'abc', price: 5 }, null] }));
  assert.equal(odd.total, 0);
  assert.ok(invoiceTotals(invoice({ supplier: { vatPayer: true }, items: [{ qty: 1, price: 10, vat: 0 }] })).zeroRated);
  const cancelled = invoiceTotals(invoice({ supplier: { vatPayer: true }, items: [{ qty: 1, price: 50, vat: 0 }, { qty: 1, price: -50, vat: 0 }, { qty: 1, price: 100, vat: 21 }] }));
  assert.deepEqual(cancelled.vat, [{ rate: 21, base: 10000, tax: 2100 }], 'sazba, která se vyruší, v rekapitulaci není');
  assert.equal(cancelled.zeroRated, false);
});

test('obrat za rok počítá koruny podle data plnění', () => {
  const list = [
    invoice({ duzp: '2026-03-01' }),
    invoice({ issued: '2025-12-30', duzp: '2025-12-30' }),
    invoice({ currency: 'EUR' }),
    invoice({ supplier: { vatPayer: true }, paidAt: '2026-11-20' }),
  ];
  assert.deepEqual(yearTurnover(list, 2026), { cents: 2460000, foreign: 1 });
});

// ---- data, čísla faktur -------------------------------------------------

test('data', () => {
  assert.equal(addDays('2026-11-11', 14), '2026-11-25');
  assert.equal(addDays('2026-12-25', 14), '2027-01-08');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('', 14), '');
  assert.equal(daysBetween('2026-11-25', '2026-12-07'), 12);
  assert.ok(Number.isNaN(daysBetween('', '2026-11-12')));
  assert.equal(formatDate('2026-11-05'), '5. 11. 2026');
  assert.equal(formatDate('2026-11-05', 'en'), '5 Nov 2026');
  assert.ok(isIsoDate('2026-02-28') && !isIsoDate('2026-02-30') && !isIsoDate(''));
  assert.ok(isBusinessDate('2026-11-12') && !isBusinessDate('0202-11-12') && !isBusinessDate('3850-11-27') && !isBusinessDate(''));
});

test('číslování faktur', () => {
  assert.equal(nextInvoiceNumber([], 2026), '20260001');
  assert.equal(nextInvoiceNumber(['20260001', '20260007', '20250099', 'FV-3'], 2026), '20260008');
  assert.equal(nextInvoiceNumber(['20251234'], 2026), '20260001');
  assert.equal(nextInvoiceNumber(['FV-2026-012', 'FV-2026-011'], 2026), 'FV-2026-013');
  assert.equal(nextInvoiceNumber(['12/2026'], 2026), '13/2026');
  assert.equal(nextInvoiceNumber(['A9', 'A10'], 2026), 'A11');
  assert.equal(nextInvoiceNumber(['099'], 2026), '100');
  assert.equal(nextInvoiceNumber(['bez čísla', '20260003'], 2026), '20260004');
  assert.equal(nextInvoiceNumber(['26000012'], 2026), '26000013', 'vlastní osmimístná řada pokračuje');
});

test('VS, IČO, stav faktury', () => {
  assert.equal(toVs('FV-2026/0001'), '20260001');
  assert.equal(toVs('123456789012345'), '6789012345');
  assert.ok(isValidIco('12345679') && isValidIco('87654326'));
  assert.ok(!isValidIco('12345678') && !isValidIco('1234567'));
  assert.equal(invoiceStatus(invoice(), '2026-11-25'), 'open');
  assert.equal(invoiceStatus(invoice(), '2026-11-26'), 'overdue');
  assert.equal(invoiceStatus(invoice({ due: '' }), '2026-11-26'), 'open');
  assert.equal(invoiceStatus(invoice({ paidAt: '2026-11-20' }), '2026-12-30'), 'paid');
});

// ---- hodinovka, úrok, upomínky ------------------------------------------

test('hodinovka', () => {
  const input = { netMonthly: 60000, costsMonthly: 6000, taxPct: 20, hoursPerWeek: 40, billablePct: 60, weeksOff: 6 };
  const r = hourlyRate(input);
  assert.equal(Math.round(r.revenueYear), 990000);
  assert.equal(r.billableHours, 46 * 40 * 0.6);
  assert.equal(Math.round(r.rate), 897);
  assert.ok(Math.abs(netFromRate({ ...input, rate: r.rate }) - 60000) < 0.01);
  assert.equal(hourlyRate({ ...input, hoursPerWeek: 0 }).rate, 0);
  assert.equal(hourlyRate({ ...input, weeksOff: -10 }).billableHours, 52 * 40 * 0.6, 'záporné volno se nepočítá');
  assert.equal(hourlyRate({ ...input, hoursPerWeek: 400 }).billableHours, 46 * 168 * 0.6, 'týden má 168 hodin');
});

test('úrok z prodlení a zákonná sazba', () => {
  assert.equal(lateInterest(1000000, 12, 30), 9863);
  assert.equal(lateInterest(1000000, '12,5 %', 30), 10274);
  assert.equal(lateInterest(1000000, 0, 30), 0);
  assert.equal(lateInterest(1000000, 12, 0), 0);
  assert.equal(lateInterest(1000000, '1e6', 30), 0);
  assert.equal(statutoryInterestRate('2026-10-30'), 11.75);
  assert.equal(statutoryInterestRate('2026-06-30'), 11.75, 'prodlení začíná den po splatnosti');
  assert.equal(statutoryInterestRate('2026-06-29'), 11.5);
  assert.equal(statutoryInterestRate('2031-01-05'), null);
  assert.equal(statutoryInterestRate(''), null);
});

test('upomínky podle zpoždění', () => {
  assert.equal(suggestTone(3), 'friendly');
  assert.equal(suggestTone(12), 'firm');
  assert.equal(suggestTone(45), 'final');
  assert.deepEqual([1, 3, 12].map(dayWord), ['den', 'dny', 'dní']);
  const r = buildReminder(invoice(), { today: '2026-12-30', interestRate: '12' });
  assert.equal(r.daysLate, 35);
  assert.equal(r.tone, 'final');
  assert.match(r.subject, /Poslední výzva/);
  assert.match(r.body, /12 300,00 Kč/);
  assert.match(r.body, /Variabilní symbol: 20260001/);
  assert.match(r.body, /úrok z prodlení 141,53 Kč \(12 % ročně\)/);
  assert.match(r.body, /nejpozději do 6\. 1\. 2027/);
  assert.match(r.body, /dosud neeviduji/);
  assert.match(buildReminder(invoice(), { today: '2026-12-30', previous: 2 }).body, /přes předchozí připomenutí/);
  const friendly = buildReminder(invoice(), { today: '2026-11-27' });
  assert.equal(friendly.tone, 'friendly');
  assert.ok(!/úrok/.test(friendly.body));
});

test('upomínka faktuře, která ještě není po splatnosti, netvrdí opak', () => {
  for (const tone of ['friendly', 'firm', 'final', undefined]) {
    const r = buildReminder(invoice(), { today: '2026-11-12', tone, interestRate: 12 });
    assert.equal(r.tone, 'early');
    assert.ok(!/po splatnosti|byla splatná|vymáhat/.test(r.subject + r.body), tone);
    assert.match(r.body, /je splatná 25\. 11\. 2026/);
  }
  const noDate = buildReminder(invoice({ due: '' }), { today: '2026-11-12' });
  assert.equal(noDate.daysLate, 0);
});

// ---- platební údaje -----------------------------------------------------

test('platební údaje faktury: QR Platba, SEPA QR a důvody, proč kód chybí', () => {
  const p = invoicePayment(invoice());
  assert.equal(p.kind, 'spayd');
  assert.equal(p.code, 'SPD*1.0*ACC:CZ6508000000192000145399*AM:12300.00*CC:CZK*MSG:FAKTURA 20260001*RN:JANA NOVAKOVA*X-VS:20260001');
  assert.ok(p.matrix.length > 20);
  const eur = invoicePayment(invoice({ currency: 'EUR', lang: 'en', supplier: { name: 'Jana Nováková', account: '19-2000145399/0800', swift: 'gibaczpx' } }));
  assert.equal(eur.kind, 'epc');
  assert.equal(eur.label, 'SEPA QR');
  assert.ok(eur.code.includes('EUR12300.00') && eur.code.includes('GIBACZPX') && eur.code.endsWith('Invoice 20260001'));
  assert.equal(invoicePayment(invoice({ supplier: { name: 'X', account: '1/0100' } })).reason, 'account');
  assert.equal(invoicePayment(invoice({ items: [] })).reason, 'empty');
  assert.equal(invoicePayment(invoice({ supplier: { name: 'X', account: 'DE89370400440532013000' } })).reason, 'foreign');
  assert.equal(invoicePayment(invoice({ items: [{ qty: 1, price: 1e8 }] })).reason, 'limit');
  assert.equal(invoicePayment(invoice({ currency: 'EUR', supplier: { name: '', account: '19-2000145399/0800' } })).reason, 'name');
});

// ---- rozvržení ----------------------------------------------------------

test('rozvržení: jedna strana, QR, částka i patička', () => {
  const inv = invoice();
  const { pages } = layout(inv);
  assert.equal(pages.length, 1);
  const t = texts(pages);
  for (const expected of ['FAKTURA', '12 300,00 Kč', 'QR Platba', 'Vystaveno zdarma v aplikaci Cinkne', 'DATUM PLNĚNÍ', '1 ks', '4 h', 'Nejsem plátce DPH.']) {
    assert.ok(t.includes(expected), expected);
  }
  const wordy = texts(layout(invoice({ supplier: { name: 'X', account: '19-2000145399/0800', register: 'Zapsáno v rejstříku '.repeat(30) } })).pages);
  assert.ok(wordy.includes('Nejsem plátce DPH.'), 'dlouhý zápis v rejstříku prohlášení nevytlačí');
  assert.ok(wordy.some((s) => s.endsWith('…')), 'zkrácený text to přizná');
  assert.equal(pages[0].filter((op) => op.t === 'qr').length, 1);
  for (const op of pages[0]) {
    if (op.t === 'text') assert.ok(op.y > 0 && op.y < PAGE.h && op.x >= 0 && op.x <= PAGE.w, JSON.stringify(op));
  }
  assert.ok(!texts(layout(inv, { branding: false }).pages).includes('Vystaveno zdarma v aplikaci Cinkne'));
});

test('rozvržení: zaplacená faktura nese značku místo QR kódu', () => {
  const { pages } = layout(invoice({ paidAt: '2026-11-20' }));
  const t = texts(pages);
  assert.ok(t.includes('UHRAZENO') && t.includes('20. 11. 2026'));
  assert.equal(pages[0].filter((op) => op.t === 'qr').length, 0);
});

test('rozvržení: plátce DPH a dlouhá faktura na víc stran', () => {
  const inv = invoice({
    supplier: { name: 'Firma s.r.o.', account: '19-2000145399/0800', vatPayer: true, dic: 'CZ12345679' },
    items: Array.from({ length: 60 }, (_, i) => ({ desc: `Položka ${i + 1} s delším popisem, který se musí zalomit na další řádek faktury`, qty: 2, unit: 'ks', price: 100, vat: i % 2 ? 21 : 12 })),
  });
  const { pages } = layout(inv);
  assert.ok(pages.length >= 2);
  const all = texts(pages);
  for (const expected of ['FAKTURA – DAŇOVÝ DOKLAD', 'Základ DPH 21 %', 'DPH 12 %', 'CENA ZA JEDN. BEZ DPH', 'DATUM USKUT. PLNĚNÍ', `Strana ${pages.length} z ${pages.length}`]) {
    assert.ok(all.includes(expected), expected);
  }
  assert.equal(all.filter((s) => s.startsWith('Položka ')).length, 60);
  for (const ops of pages) for (const op of ops) if (op.t === 'text') assert.ok(op.y < PAGE.h - 20);
});

test('rozvržení: velmi dlouhý popis pokračuje na další straně a nic nepřeteče', () => {
  const inv = invoice({ items: [{ desc: 'slovo '.repeat(900), qty: 1, price: 100 }], note: 'x'.repeat(3000) });
  const { pages } = layout(inv);
  assert.ok(pages.length >= 2);
  for (const ops of pages) for (const op of ops) if (op.t === 'text') assert.ok(op.y < PAGE.h - PAGE.margin + 16, `y=${op.y}`);
  assert.equal(texts(pages).join(' ').split('slovo').length - 1, 900, 'žádné slovo se neztratí');
});

test('rozvržení: dlouhé jednořádkové údaje se vejdou na stránku', () => {
  const inv = invoice({
    number: 'FV-2026-000123-OPRAVNY-DOKLAD-XYZ',
    supplier: { name: 'Velmi dlouhý název společnosti s ručením omezeným a ještě delším dovětkem', account: 'viz e-mail '.repeat(10), email: 'x'.repeat(70) + '@example.cz', phone: '+420 600 000 000', vatPayer: true },
    items: [{ desc: 'A', qty: '1250,5', unit: 'člověkohodin', price: 99999999, vat: 21 }],
  });
  const { pages } = layout(inv);
  for (const op of pages.flat()) {
    if (op.t !== 'text') continue;
    const w = measure(op.s, op.f, op.z);
    const left = op.a === 'r' ? op.x - w : op.a === 'c' ? op.x - w / 2 : op.x;
    assert.ok(left >= PAGE.margin - 1 && left + w <= PAGE.w - PAGE.margin + 1, `${op.s} (${Math.round(left)}–${Math.round(left + w)})`);
  }
});

test('rozvržení: jemná cena, euro s DPH v korunách, důvod nulové daně, angličtina', () => {
  assert.ok(texts(layout(invoice({ items: [{ desc: 'A', qty: 1000, price: '0,333' }] })).pages).includes('0,333 Kč'));
  const eur = invoice({
    currency: 'EUR', lang: 'en', exchangeRate: '24,5', zeroVatNote: 'Daň odvede zákazník.',
    supplier: { name: 'Jana Nováková', account: '19-2000145399/0800', vatPayer: true, dic: 'CZ12345679', swift: 'GIBACZPX' },
    items: [{ desc: 'Design', qty: 1, price: 1000, vat: 21 }, { desc: 'Export', qty: 1, price: 500, vat: 0 }],
  });
  const t = texts(layout(eur).pages);
  for (const expected of ['INVOICE – TAX DOCUMENT', 'SUPPLIER', 'Total due', 'SEPA QR', 'BIC/SWIFT', 'GIBACZPX', '€1,710.00', 'Net amount 0%', 'Daň odvede zákazník.', 'Page 1 of 1', '11 Nov 2026']) {
    assert.ok(t.includes(expected), expected);
  }
  assert.ok(t.includes('VAT 21% in Czech currency: CZK 5,145.00 (rate 24.5 CZK/EUR)'));
});

test('zalamování textu je lineární a SVG bezpečné', () => {
  assert.deepEqual(wrapText('aa bb cc', 'sans', 10, 30, measure), ['aa bb', 'cc']);
  assert.deepEqual(wrapText('', 'sans', 10, 30, measure), ['']);
  assert.ok(wrapText('x'.repeat(40), 'sans', 10, 55, measure).every((l) => l.length <= 10));
  let calls = 0;
  const counting = (...args) => { calls += 1; return measure(...args); };
  wrapText('x'.repeat(6000), 'sans', 10, 300, counting);
  assert.ok(calls < 3000, `měření: ${calls}`);
  assert.deepEqual(fitLine('krátký', 'sans', 10, 500, measure), { s: 'krátký', z: 10 });
  const fit = fitLine('x'.repeat(200), 'sans', 10, 100, measure);
  assert.ok(fit.s.endsWith('…') && measure(fit.s, 'sans', fit.z) <= 100);
  const inv = invoice({ client: { name: 'A & B <s.r.o.>' } });
  const { pages, width, height } = layout(inv);
  const svg = pageToSvg(pages[0], width, height);
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(svg.includes('A &amp; B &lt;s.r.o.&gt;'));
});

test('název souboru', () => {
  assert.equal(safeFilename('faktura-Žluťoučký kůň/2026.pdf'), 'faktura-Zlutoucky-kun-2026.pdf');
  assert.equal(safeFilename('../../etc/passwd'), '..-..-etc-passwd');
});
