// Rozvržení faktury na stránky A4. Výsledkem je seznam kreslicích operací
// v bodech (počátek vlevo nahoře), který umí vykreslit SVG náhled i PDF.

import { formatDate, formatMoney, formatQty, invoiceTotals, num } from './calc.js';
import { formatIban } from './iban.js';

export const PAGE = { w: 595.28, h: 841.89, margin: 48 };

export const INK = '#10231c';
export const MUTED = '#5c6b65';
export const RULE = '#d3dcd7';
export const SOFT = '#f0f4f2';
export const DEFAULT_ACCENT = '#0a7a55';

/** Zalomí text do řádků podle šířky; dlouhá slova láme po znacích. */
export function wrapText(text, font, size, maxWidth, measure) {
  const out = [];
  for (const paragraph of String(text || '').split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (let word of words) {
      const candidate = line ? line + ' ' + word : word;
      if (measure(candidate, font, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      while (measure(word, font, size) > maxWidth && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && measure(word.slice(0, cut), font, size) > maxWidth) cut--;
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      line = word;
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

function addressLines(party) {
  const cityLine = [party.zip, party.city].filter(Boolean).join(' ');
  return [party.street, cityLine].filter(Boolean);
}

/**
 * @param {object} invoice
 * @param {object} opts
 * @param {(text: string, font: string, size: number) => number} opts.measure
 * @param {object|null} opts.payment  výsledek invoicePayment()
 * @param {boolean} opts.branding     patička „Vystaveno v aplikaci Cinkne“
 * @param {{ data: string, w: number, h: number }|null} opts.logo
 * @param {string} opts.accent
 * @returns {{ pages: Array<Array<object>>, width: number, height: number }}
 */
export function layoutInvoice(invoice, opts) {
  const { measure, payment = null, branding = true, logo = null } = opts;
  const accent = opts.accent || DEFAULT_ACCENT;
  const { w: W, h: H, margin: M } = PAGE;
  const CW = W - 2 * M;
  const bottom = H - M - 30;
  const supplier = invoice.supplier || {};
  const client = invoice.client || {};
  const currency = invoice.currency || 'CZK';
  const totals = invoiceTotals(invoice);
  const money = (cents) => formatMoney(cents, currency);

  const pages = [];
  let ops;
  let y;

  const text = (s, x, yy, f = 'sans', z = 9.5, c = INK, a = 'l') => {
    if (s !== '' && s != null) ops.push({ t: 'text', s: String(s), x, y: yy, f, z, c, a });
  };
  const line = (x1, y1, x2, y2, c = RULE, w = 0.75) => ops.push({ t: 'line', x1, y1, x2, y2, c, w });
  const rect = (x, yy, w, h, fill) => ops.push({ t: 'rect', x, y: yy, w, h, fill });

  const newPage = () => {
    ops = [];
    pages.push(ops);
    y = M;
  };

  // ---- hlavička první strany -------------------------------------------
  newPage();
  const title = totals.vatPayer ? 'FAKTURA – DAŇOVÝ DOKLAD' : 'FAKTURA';
  text(title, M, y + 9, 'bold', 8.5, accent);
  text(invoice.number || '', M, y + 36, 'monoBold', 22, INK);
  if (logo && logo.data) {
    const scale = Math.min(150 / logo.w, 44 / logo.h, 1);
    const lw = logo.w * scale;
    const lh = logo.h * scale;
    ops.push({ t: 'image', data: logo.data, x: W - M - lw, y, w: lw, h: lh });
  } else if (supplier.name) {
    const lines = wrapText(supplier.name, 'bold', 13, CW * 0.5, measure).slice(0, 2);
    lines.forEach((l, i) => text(l, W - M, y + 14 + i * 16, 'bold', 13, INK, 'r'));
  }
  y += 50;
  rect(M, y, CW, 2, accent);
  y += 24;

  // ---- dodavatel a odběratel -------------------------------------------
  const colW = CW / 2 - 14;
  const party = (p, x, label, isSupplier) => {
    let yy = y;
    text(label, x, yy, 'bold', 7.5, MUTED);
    yy += 16;
    for (const l of wrapText(p.name || '', 'bold', 11, colW, measure)) {
      text(l, x, yy, 'bold', 11);
      yy += 14;
    }
    yy += 1;
    for (const l of addressLines(p)) {
      for (const wl of wrapText(l, 'sans', 9.5, colW, measure)) {
        text(wl, x, yy);
        yy += 13;
      }
    }
    if (p.ico || p.dic) yy += 4;
    if (p.ico) {
      text('IČO', x, yy, 'sans', 9.5, MUTED);
      text(p.ico, x + 28, yy, 'mono', 9.5);
      yy += 13;
    }
    if (p.dic) {
      text('DIČ', x, yy, 'sans', 9.5, MUTED);
      text(p.dic, x + 28, yy, 'mono', 9.5);
      yy += 13;
    }
    if (isSupplier) {
      const notes = [];
      if (p.register) notes.push(p.register);
      if (!p.vatPayer) notes.push('Neplátce DPH.');
      if (notes.length) yy += 4;
      for (const l of wrapText(notes.join(' '), 'sans', 8, colW, measure)) {
        text(l, x, yy, 'sans', 8, MUTED);
        yy += 11;
      }
    }
    return yy;
  };
  const leftEnd = party(supplier, M, 'DODAVATEL', true);
  const rightEnd = party(client, M + CW / 2 + 14, 'ODBĚRATEL', false);
  y = Math.max(leftEnd, rightEnd) + 10;

  // ---- data --------------------------------------------------------------
  const cells = [['Datum vystavení', formatDate(invoice.issued)]];
  if (totals.vatPayer) cells.push(['Datum zdan. plnění', formatDate(invoice.duzp || invoice.issued)]);
  cells.push(['Datum splatnosti', formatDate(invoice.due)]);
  cells.push(['Forma úhrady', 'Převodem']);
  rect(M, y, CW, 40, SOFT);
  const cellW = CW / cells.length;
  cells.forEach(([label, value], i) => {
    const x = M + 12 + i * cellW;
    text(label.toUpperCase(), x, y + 15, 'bold', 7, MUTED);
    text(value, x, y + 30, 'bold', 10);
  });
  y += 40 + 26;

  // ---- položky -----------------------------------------------------------
  const right = M + CW;
  const cols = totals.vatPayer
    ? { qty: right - 268, price: right - 168, vat: right - 104, total: right }
    : { qty: right - 196, price: right - 96, total: right };
  const descW = cols.qty - 74 - M;

  const tableHead = () => {
    text('POPIS', M, y, 'bold', 7, MUTED);
    text('MNOŽSTVÍ', cols.qty, y, 'bold', 7, MUTED, 'r');
    text(totals.vatPayer ? 'CENA BEZ DPH' : 'CENA ZA JEDN.', cols.price, y, 'bold', 7, MUTED, 'r');
    if (totals.vatPayer) text('DPH', cols.vat, y, 'bold', 7, MUTED, 'r');
    text(totals.vatPayer ? 'CELKEM BEZ DPH' : 'CELKEM', cols.total, y, 'bold', 7, MUTED, 'r');
    y += 7;
    line(M, y, right, y, INK, 0.9);
    y += 16;
  };
  const continuePage = () => {
    newPage();
    text(`Faktura ${invoice.number || ''} – pokračování`, M, y + 9, 'bold', 8.5, MUTED);
    y += 34;
  };
  tableHead();

  const items = (invoice.items || []).filter((it) => String(it.desc || '').trim() || num(it.price));
  items.forEach((item, i) => {
    const descLines = wrapText(item.desc || '', 'sans', 9.5, descW, measure);
    const rowH = descLines.length * 13 + 9;
    if (y + rowH > bottom) {
      continuePage();
      tableHead();
    }
    descLines.forEach((l, k) => text(l, M, y + k * 13));
    const qty = formatQty(num(item.qty)) + (item.unit ? ' ' + item.unit : '');
    text(qty, cols.qty, y, 'mono', 9.5, INK, 'r');
    text(money(Math.round(num(item.price) * 100)), cols.price, y, 'mono', 9.5, INK, 'r');
    if (totals.vatPayer) text(`${num(item.vat)} %`, cols.vat, y, 'mono', 9.5, INK, 'r');
    text(money(totals.lines[invoice.items.indexOf(item)].base), cols.total, y, 'mono', 9.5, INK, 'r');
    y += descLines.length * 13 - 4;
    if (i < items.length - 1) line(M, y, right, y);
    y += 13;
  });
  if (!items.length) {
    text('Zatím žádné položky.', M, y, 'sans', 9.5, MUTED);
    y += 22;
  }
  y -= 13;
  line(M, y, right, y, INK, 0.9);
  y += 22;

  // ---- součty ------------------------------------------------------------
  const sumRows = [];
  if (totals.vatPayer) {
    for (const v of totals.vat) {
      sumRows.push([`Základ ${v.rate} %`, money(v.base)]);
      if (v.rate > 0) sumRows.push([`DPH ${v.rate} %`, money(v.tax)]);
    }
  }
  const sumsH = sumRows.length * 15 + 34;
  if (y + sumsH > bottom) continuePage();
  const sumX = right - 250;
  for (const [label, value] of sumRows) {
    text(label, sumX, y, 'sans', 9.5, MUTED);
    text(value, right, y, 'mono', 9.5, INK, 'r');
    y += 15;
  }
  if (sumRows.length) {
    line(sumX, y - 6, right, y - 6);
    y += 8;
  }
  y += 6;
  text('Celkem k úhradě', sumX, y, 'bold', 11);
  text(money(totals.total), right, y, 'monoBold', 16, INK, 'r');
  y += 30;

  // ---- platební údaje ----------------------------------------------------
  const paid = !!invoice.paidAt;
  const hasQr = !paid && !!(payment && payment.matrix);
  const boxH = 128;
  if (y + boxH > bottom) continuePage();
  rect(M, y, CW, boxH, SOFT);
  rect(M, y, 3, boxH, accent);
  const px = M + 18;
  let py = y + 20;
  text('PLATEBNÍ ÚDAJE', px, py, 'bold', 7.5, MUTED);
  py += 20;
  const payRows = [];
  const accountText = payment ? payment.account : supplier.account || '';
  if (accountText) payRows.push(['Číslo účtu', accountText, 'monoBold']);
  if (payment && payment.iban) payRows.push(['IBAN', formatIban(payment.iban), 'mono']);
  if (invoice.vs) payRows.push(['Variabilní symbol', invoice.vs, 'monoBold']);
  payRows.push(['Částka', money(totals.total), 'monoBold']);
  payRows.push(paid ? ['Uhrazeno', formatDate(invoice.paidAt), 'monoBold'] : ['Splatnost', formatDate(invoice.due), 'mono']);
  for (const [label, value, font] of payRows) {
    text(label, px, py, 'sans', 9, MUTED);
    text(value, px + 96, py, font, 9.5);
    py += 16;
  }
  if (hasQr) {
    const size = 88;
    const qx = right - 16 - size;
    const qy = y + 12;
    rect(qx - 6, qy - 6, size + 12, size + 12, '#ffffff');
    ops.push({ t: 'qr', matrix: payment.matrix, x: qx, y: qy, size });
    text('QR Platba', qx + size / 2, qy + size + 19, 'bold', 8, INK, 'c');
  } else if (paid) {
    text('UHRAZENO', right - 18, y + 58, 'bold', 20, accent, 'r');
    text('Neplaťte, faktura je už zaplacená.', right - 18, y + 76, 'sans', 8.5, MUTED, 'r');
  }
  y += boxH + 22;

  // ---- poznámka ----------------------------------------------------------
  if (String(invoice.note || '').trim()) {
    const noteLines = wrapText(invoice.note, 'sans', 9, CW, measure);
    for (const l of noteLines) {
      if (y > bottom) continuePage();
      text(l, M, y, 'sans', 9, MUTED);
      y += 12.5;
    }
  }

  // ---- patičky -----------------------------------------------------------
  pages.forEach((pageOps, i) => {
    ops = pageOps;
    const fy = H - M + 4;
    line(M, fy - 16, right, fy - 16);
    const contact = [supplier.name, supplier.email, supplier.phone].filter(Boolean).join('  ·  ');
    text(contact, M, fy - 3, 'sans', 7.5, MUTED);
    text(`Strana ${i + 1} z ${pages.length}`, right, fy - 3, 'sans', 7.5, MUTED, 'r');
    if (branding) text('Vystaveno zdarma v aplikaci Cinkne', M, fy + 9, 'sans', 7, MUTED);
  });

  return { pages, width: W, height: H };
}
