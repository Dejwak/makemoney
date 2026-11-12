import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCzAccount, czAccountToIban, isValidIban, ibanToCzAccount, normalizeAccount, formatIban } from '../assets/js/lib/iban.js';
import { buildSpayd, parseSpayd, spaydText } from '../assets/js/lib/spayd.js';
import { qrMatrix, qrRuns } from '../assets/js/lib/qr.js';
import {
  num, toCents, formatMoney, invoiceTotals, addDays, daysBetween, formatDate, isIsoDate,
  nextInvoiceNumber, toVs, isValidIco, invoiceStatus, hourlyRate, netFromRate, lateInterest,
} from '../assets/js/lib/calc.js';
import { buildReminder, suggestTone, dayWord } from '../assets/js/lib/reminders.js';
import { invoicePayment } from '../assets/js/lib/payment.js';
import { layoutInvoice, wrapText } from '../assets/js/lib/layout.js';
import { pageToSvg } from '../assets/js/lib/render-svg.js';

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
    { desc: 'Focení', qty: 4, unit: 'hod', price: 950, vat: 21 },
  ],
  note: '',
  paidAt: null,
  ...over,
});

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
});

test('normalizeAccount přijme účet i IBAN a vrátí srozumitelnou chybu', () => {
  assert.deepEqual(normalizeAccount('19-2000145399/0800'), { ok: true, iban: 'CZ6508000000192000145399', account: '19-2000145399/0800' });
  assert.equal(normalizeAccount('cz65 0800 0000 1920 0014 5399').account, '19-2000145399/0800');
  assert.equal(normalizeAccount('').ok, false);
  assert.match(normalizeAccount('124/0100').error, /nesedí/);
});

test('SPAYD: formát QR Platby', () => {
  const s = buildSpayd({ iban: 'CZ65 0800 0000 1920 0014 5399', amount: 12300.5, vs: '20260001', message: 'Faktura č. 20260001 – žluťoučký kůň*', recipient: 'Jana Nováková' });
  assert.equal(s, 'SPD*1.0*ACC:CZ6508000000192000145399*AM:12300.50*CC:CZK*MSG:FAKTURA C. 20260001 ZLUTOUCKY KUN*RN:JANA NOVAKOVA*X-VS:20260001');
  const parsed = parseSpayd(s);
  assert.equal(parsed.AM, '12300.50');
  assert.equal(parsed['X-VS'], '20260001');
  assert.equal(buildSpayd({ iban: 'CZ6508000000192000145399' }), 'SPD*1.0*ACC:CZ6508000000192000145399*CC:CZK');
  assert.equal(buildSpayd({ iban: 'CZ6508000000192000145399', amount: 10, currency: 'EUR' }), 'SPD*1.0*ACC:CZ6508000000192000145399*AM:10.00*CC:EUR');
  assert.equal(spaydText('x'.repeat(80), 60).length, 60);
  assert.ok(!buildSpayd({ iban: 'CZ6508000000192000145399', message: 'a*b' }).includes('A*B'));
  assert.throws(() => buildSpayd({ iban: '' }));
});

test('QR matice je čtvercová a má vyhledávací vzory', () => {
  const m = qrMatrix('SPD*1.0*ACC:CZ6508000000192000145399*AM:12300.50*CC:CZK*X-VS:20260001');
  assert.ok(m.length >= 21);
  assert.ok(m.every((row) => row.length === m.length));
  for (let i = 0; i < 7; i++) assert.ok(m[0][i] && m[6][i] && m[i][0] && m[i][6]);
  const dark = m.flat().filter(Boolean).length;
  assert.equal(qrRuns(m).reduce((s, r) => s + r.len, 0), dark);
});

test('částky a zaokrouhlení', () => {
  assert.equal(num('1 250,50'), 1250.5);
  assert.equal(num('abc'), 0);
  assert.equal(toCents(1.005), 101);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents(8500 * 1), 850000);
  assert.equal(formatMoney(1234560), '12 345,60 Kč');
  assert.equal(formatMoney(150000, 'EUR'), '1 500,00 €');
});

test('součty faktury: neplátce', () => {
  const t = invoiceTotals(invoice());
  assert.equal(t.total, 1230000);
  assert.equal(t.tax, 0);
  assert.equal(t.vatPayer, false);
});

test('součty faktury: plátce se dvěma sazbami', () => {
  const t = invoiceTotals(invoice({
    supplier: { name: 'X', vatPayer: true },
    items: [
      { desc: 'A', qty: 2, price: 99.99, vat: 21 },
      { desc: 'B', qty: 1, price: 1000, vat: 12 },
      { desc: 'C', qty: 3, price: '10,5', vat: 21 },
    ],
  }));
  assert.deepEqual(t.vat, [
    { rate: 21, base: 23148, tax: 4861 },
    { rate: 12, base: 100000, tax: 12000 },
  ]);
  assert.equal(t.base, 123148);
  assert.equal(t.total, 123148 + 4861 + 12000);
});

test('data', () => {
  assert.equal(addDays('2026-11-11', 14), '2026-11-25');
  assert.equal(addDays('2026-12-25', 14), '2027-01-08');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(daysBetween('2026-11-25', '2026-12-07'), 12);
  assert.equal(daysBetween('2026-03-01', '2026-04-01'), 31);
  assert.equal(formatDate('2026-11-05'), '5. 11. 2026');
  assert.ok(isIsoDate('2026-02-28'));
  assert.ok(!isIsoDate('2026-02-30'));
  assert.ok(!isIsoDate(''));
});

test('číslování, VS, IČO, stav', () => {
  assert.equal(nextInvoiceNumber([], 2026), '20260001');
  assert.equal(nextInvoiceNumber(['20260001', '20260007', '20250099', 'FV-3'], 2026), '20260008');
  assert.equal(nextInvoiceNumber(['20251234'], 2026), '20260001');
  assert.equal(nextInvoiceNumber(['FV-2026-012', 'FV-2026-011'], 2026), 'FV-2026-013');
  assert.equal(nextInvoiceNumber(['12/2026'], 2026), '13/2026');
  assert.equal(nextInvoiceNumber(['A9', 'A10'], 2026), 'A11');
  assert.equal(nextInvoiceNumber(['099'], 2026), '100');
  assert.equal(nextInvoiceNumber(['bez čísla', '20260003'], 2026), '20260004');
  assert.equal(toVs('FV-2026/0001'), '20260001');
  assert.equal(toVs('123456789012345'), '6789012345');
  assert.ok(isValidIco('12345679'));
  assert.ok(isValidIco('87654326'));
  assert.ok(!isValidIco('12345678'));
  assert.ok(!isValidIco('1234567'));
  assert.equal(invoiceStatus(invoice(), '2026-11-25'), 'open');
  assert.equal(invoiceStatus(invoice(), '2026-11-26'), 'overdue');
  assert.equal(invoiceStatus(invoice({ paidAt: '2026-11-20' }), '2026-12-30'), 'paid');
});

test('hodinovka', () => {
  const input = { netMonthly: 60000, costsMonthly: 6000, taxPct: 20, hoursPerWeek: 40, billablePct: 60, weeksOff: 6 };
  const r = hourlyRate(input);
  assert.equal(Math.round(r.revenueYear), 990000);
  assert.equal(r.billableHours, 46 * 40 * 0.6);
  assert.equal(Math.round(r.rate), 897);
  assert.ok(Math.abs(netFromRate({ ...input, rate: r.rate }) - 60000) < 0.01);
  assert.equal(hourlyRate({ ...input, hoursPerWeek: 0 }).rate, 0);
});

test('úrok z prodlení a upomínky', () => {
  assert.equal(lateInterest(1000000, 12, 30), 9863);
  assert.equal(lateInterest(1000000, 0, 30), 0);
  assert.equal(lateInterest(1000000, 12, 0), 0);
  assert.equal(suggestTone(3), 'friendly');
  assert.equal(suggestTone(12), 'firm');
  assert.equal(suggestTone(45), 'final');
  assert.equal(dayWord(1), 'den');
  assert.equal(dayWord(3), 'dny');
  assert.equal(dayWord(12), 'dní');
  const r = buildReminder(invoice(), { today: '2026-12-30', interestRate: '12' });
  assert.equal(r.daysLate, 35);
  assert.equal(r.tone, 'final');
  assert.match(r.subject, /Poslední výzva/);
  assert.match(r.body, /12 300,00 Kč/);
  assert.match(r.body, /Variabilní symbol: 20260001/);
  assert.match(r.body, /úrok z prodlení 141,53 Kč/);
  const friendly = buildReminder(invoice(), { today: '2026-11-27' });
  assert.equal(friendly.tone, 'friendly');
  assert.ok(!/úrok/.test(friendly.body));
});

test('platební údaje faktury', () => {
  const p = invoicePayment(invoice());
  assert.ok(p.ok);
  assert.equal(p.account, '19-2000145399/0800');
  assert.equal(p.spayd, 'SPD*1.0*ACC:CZ6508000000192000145399*AM:12300.00*CC:CZK*MSG:FAKTURA 20260001*RN:JANA NOVAKOVA*X-VS:20260001');
  assert.ok(p.matrix.length > 20);
  const bad = invoicePayment(invoice({ supplier: { name: 'X', account: '1/0100' } }));
  assert.equal(bad.ok, false);
  assert.equal(bad.matrix, null);
  assert.equal(invoicePayment(invoice({ items: [] })).matrix, null);
});

test('rozvržení: jedna strana, QR, částka i patička', () => {
  const inv = invoice();
  const { pages } = layoutInvoice(inv, { measure, payment: invoicePayment(inv), branding: true });
  assert.equal(pages.length, 1);
  const texts = pages[0].filter((op) => op.t === 'text').map((op) => op.s);
  assert.ok(texts.includes('FAKTURA'));
  assert.ok(texts.includes('12 300,00 Kč'));
  assert.ok(texts.includes('QR Platba'));
  assert.ok(texts.includes('Vystaveno zdarma v aplikaci Cinkne'));
  assert.ok(texts.some((t) => t.includes('Neplátce DPH')));
  assert.equal(pages[0].filter((op) => op.t === 'qr').length, 1);
  for (const op of pages[0]) {
    if (op.t === 'text') assert.ok(op.y > 0 && op.y < 841.89 && op.x >= 0 && op.x <= 595.28, JSON.stringify(op));
  }
  const noBrand = layoutInvoice(inv, { measure, payment: invoicePayment(inv), branding: false });
  assert.ok(!noBrand.pages[0].some((op) => op.s === 'Vystaveno zdarma v aplikaci Cinkne'));
});

test('rozvržení: zaplacená faktura nese značku místo QR kódu', () => {
  const inv = invoice({ paidAt: '2026-11-20' });
  const { pages } = layoutInvoice(inv, { measure, payment: invoicePayment(inv), branding: true });
  const texts = pages[0].filter((op) => op.t === 'text').map((op) => op.s);
  assert.ok(texts.includes('UHRAZENO') && texts.includes('20. 11. 2026'));
  assert.equal(pages[0].filter((op) => op.t === 'qr').length, 0);
});

test('rozvržení: plátce DPH a dlouhá faktura na víc stran', () => {
  const inv = invoice({
    supplier: { name: 'Firma s.r.o.', account: '19-2000145399/0800', vatPayer: true, dic: 'CZ12345679' },
    items: Array.from({ length: 60 }, (_, i) => ({ desc: `Položka ${i + 1} s delším popisem, který se musí zalomit na další řádek faktury`, qty: 2, unit: 'ks', price: 100, vat: i % 2 ? 21 : 12 })),
  });
  const { pages } = layoutInvoice(inv, { measure, payment: invoicePayment(inv), branding: true });
  assert.ok(pages.length >= 2);
  const all = pages.flat().filter((op) => op.t === 'text').map((op) => op.s);
  assert.ok(all.includes('FAKTURA – DAŇOVÝ DOKLAD'));
  assert.ok(all.includes('Základ 21 %') && all.includes('DPH 12 %'));
  assert.ok(all.includes(`Strana ${pages.length} z ${pages.length}`));
  assert.equal(all.filter((s) => s.startsWith('Položka ')).length, 60);
  for (const ops of pages) for (const op of ops) if (op.t === 'text') assert.ok(op.y < 841.89 - 20);
});

test('zalamování textu a SVG výstup', () => {
  assert.deepEqual(wrapText('aa bb cc', 'sans', 10, 30, measure), ['aa bb', 'cc']);
  assert.deepEqual(wrapText('', 'sans', 10, 30, measure), ['']);
  assert.ok(wrapText('x'.repeat(40), 'sans', 10, 55, measure).every((l) => l.length <= 10));
  const inv = invoice({ client: { name: 'A & B <s.r.o.>' } });
  const { pages, width, height } = layoutInvoice(inv, { measure, payment: invoicePayment(inv), branding: true });
  const svg = pageToSvg(pages[0], width, height);
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(svg.includes('A &amp; B &lt;s.r.o.&gt;'));
});
