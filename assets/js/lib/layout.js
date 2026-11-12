// Rozvržení faktury na stránky A4. Výsledkem je seznam kreslicích operací
// v bodech (počátek vlevo nahoře), který umí vykreslit SVG náhled i PDF.

import { formatDate, formatMoney, formatQty, formatUnitPrice, invoiceTotals, num } from './calc.js';
import { formatIban } from './iban.js';

export const PAGE = { w: 595.28, h: 841.89, margin: 48 };

export const INK = '#10231c';
export const MUTED = '#5c6b65';
export const RULE = '#d3dcd7';
export const SOFT = '#f0f4f2';
export const DEFAULT_ACCENT = '#0a7a55';

const LABELS = {
  cs: {
    title: 'FAKTURA', titleVat: 'FAKTURA – DAŇOVÝ DOKLAD',
    supplier: 'DODAVATEL', client: 'ODBĚRATEL', ico: 'IČO', dic: 'DIČ', nonPayer: 'Nejsem plátce DPH.',
    issued: 'Datum vystavení', supply: 'Datum plnění', supplyVat: 'Datum uskut. plnění', due: 'Datum splatnosti',
    method: 'Forma úhrady', transfer: 'Převodem',
    desc: 'POPIS', qty: 'MNOŽSTVÍ', price: 'CENA ZA JEDN.', priceNet: 'CENA ZA JEDN. BEZ DPH', vat: 'DPH',
    total: 'CELKEM', totalNet: 'CELKEM BEZ DPH',
    continued: (n) => `Faktura ${n} – pokračování`, noItems: 'Zatím žádné položky.',
    base: (r) => `Základ DPH ${r} %`, vatRow: (r) => `DPH ${r} %`, pct: (r) => `${r} %`,
    vatCzk: (r, amount, rate) => `DPH ${r} % v české měně: ${amount} (kurz ${rate} Kč/EUR)`,
    totalDue: 'Celkem k úhradě', payHead: 'PLATEBNÍ ÚDAJE', account: 'Číslo účtu', vs: 'Variabilní symbol',
    amount: 'Částka', payDue: 'Splatnost', paid: 'Uhrazeno', paidStamp: 'UHRAZENO',
    paidNote: 'Neplaťte, faktura je už zaplacená.',
    page: (i, n) => `Strana ${i} z ${n}`, branding: 'Vystaveno zdarma v aplikaci Cinkne',
  },
  en: {
    title: 'INVOICE', titleVat: 'INVOICE – TAX DOCUMENT',
    supplier: 'SUPPLIER', client: 'CUSTOMER', ico: 'Reg. No.', dic: 'VAT ID', nonPayer: 'Not registered for VAT.',
    issued: 'Issue date', supply: 'Date of supply', supplyVat: 'Date of supply', due: 'Due date',
    method: 'Payment method', transfer: 'Bank transfer',
    desc: 'DESCRIPTION', qty: 'QUANTITY', price: 'UNIT PRICE', priceNet: 'UNIT PRICE EXCL. VAT', vat: 'VAT',
    total: 'TOTAL', totalNet: 'TOTAL EXCL. VAT',
    continued: (n) => `Invoice ${n} – continued`, noItems: 'No items yet.',
    base: (r) => `Net amount ${r}%`, vatRow: (r) => `VAT ${r}%`, pct: (r) => `${r}%`,
    vatCzk: (r, amount, rate) => `VAT ${r}% in Czech currency: ${amount} (rate ${rate} CZK/EUR)`,
    totalDue: 'Total due', payHead: 'PAYMENT DETAILS', account: 'Account No.', vs: 'Payment reference',
    amount: 'Amount', payDue: 'Due date', paid: 'Paid', paidStamp: 'PAID',
    paidNote: 'Do not pay, this invoice has been settled.',
    page: (i, n) => `Page ${i} of ${n}`, branding: 'Issued for free with Cinkne',
  },
};

/** Nejdelší začátek textu, který se vejde do šířky (půlením intervalu). */
function fitCount(text, font, size, maxWidth, measure) {
  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid), font, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

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
      while (word.length > 1 && measure(word, font, size) > maxWidth) {
        const cut = fitCount(word, font, size, maxWidth, measure);
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      line = word;
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

/** Text na jeden řádek: nejdřív zmenší písmo (nejvýš o čtvrtinu), potom zkrátí s výpustkou. */
export function fitLine(text, font, size, maxWidth, measure) {
  let s = String(text ?? '');
  let z = size;
  const min = size * 0.75;
  while (z > min && measure(s, font, z) > maxWidth) z -= 0.5;
  if (measure(s, font, z) > maxWidth) {
    const room = Math.max(maxWidth - measure('…', font, z), 0);
    s = s.slice(0, fitCount(s, font, z, room, measure)).trimEnd() + '…';
  }
  return { s, z };
}

/** Nejvýš `max` řádků; když se text nevejde, poslední řádek to přizná výpustkou. */
function capLines(lines, max) {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = kept[max - 1].replace(/.{0,2}$/, '…');
  return kept;
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
 * @param {boolean} opts.branding     patička „Vystaveno zdarma v aplikaci Cinkne“
 * @param {{ data: string, w: number, h: number }|null} opts.logo
 * @param {string} opts.accent
 * @returns {{ pages: Array<Array<object>>, width: number, height: number }}
 */
export function layoutInvoice(invoice, opts) {
  const { measure, payment = null, branding = true, logo = null } = opts;
  const accent = opts.accent || DEFAULT_ACCENT;
  const { w: W, h: H, margin: M } = PAGE;
  const CW = W - 2 * M;
  const right = M + CW;
  const bottom = H - M - 30;
  const supplier = invoice.supplier || {};
  const client = invoice.client || {};
  const currency = invoice.currency || 'CZK';
  const lang = invoice.lang === 'en' ? 'en' : 'cs';
  const L = LABELS[lang];
  const totals = invoiceTotals(invoice);
  const money = (cents) => formatMoney(cents, currency, lang);
  const date = (iso) => formatDate(iso, lang);
  const number = String(invoice.number || '');

  const pages = [];
  let ops;
  let y;

  const text = (s, x, yy, f = 'sans', z = 9.5, c = INK, a = 'l') => {
    if (s !== '' && s != null) ops.push({ t: 'text', s: String(s), x, y: yy, f, z, c, a });
  };
  /** Jednořádkový text, který se musí vejít do dané šířky. */
  const fitted = (s, x, yy, maxWidth, f = 'sans', z = 9.5, c = INK, a = 'l') => {
    const fit = fitLine(s, f, z, maxWidth, measure);
    text(fit.s, x, yy, f, fit.z, c, a);
  };
  const line = (x1, y1, x2, y2, c = RULE, w = 0.75) => ops.push({ t: 'line', x1, y1, x2, y2, c, w });
  const rect = (x, yy, w, h, fill) => ops.push({ t: 'rect', x, y: yy, w, h, fill });

  const newPage = () => {
    ops = [];
    pages.push(ops);
    y = M;
  };
  const continuePage = () => {
    newPage();
    fitted(L.continued(number), M, y + 9, CW, 'bold', 8.5, MUTED);
    y += 34;
  };

  // ---- hlavička první strany -------------------------------------------
  newPage();
  text(totals.vatPayer ? L.titleVat : L.title, M, y + 9, 'bold', 8.5, accent);
  fitted(number, M, y + 36, CW * 0.52, 'monoBold', 22, INK);
  if (logo && logo.data) {
    const scale = Math.min(150 / logo.w, 44 / logo.h, 1);
    const lw = logo.w * scale;
    const lh = logo.h * scale;
    ops.push({ t: 'image', data: logo.data, x: W - M - lw, y, w: lw, h: lh });
  } else if (supplier.name) {
    const lines = wrapText(supplier.name, 'bold', 13, CW * 0.42, measure);
    lines.slice(0, 2).forEach((l, i) => {
      const last = i === 1 && lines.length > 2;
      fitted(last ? l + '…' : l, W - M, y + 14 + i * 16, CW * 0.42, 'bold', 13, INK, 'r');
    });
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
    for (const l of capLines(wrapText(p.name || '', 'bold', 11, colW, measure), 4)) {
      text(l, x, yy, 'bold', 11);
      yy += 14;
    }
    yy += 1;
    for (const l of addressLines(p)) {
      for (const wl of capLines(wrapText(l, 'sans', 9.5, colW, measure), 3)) {
        text(wl, x, yy);
        yy += 13;
      }
    }
    if (p.ico || p.dic) yy += 4;
    for (const [idLabel, value] of [[L.ico, p.ico], [L.dic, p.dic]]) {
      if (!value) continue;
      const lw = measure(idLabel, 'sans', 9.5) + 8;
      text(idLabel, x, yy, 'sans', 9.5, MUTED);
      fitted(value, x + lw, yy, colW - lw, 'mono', 9.5);
      yy += 13;
    }
    if (isSupplier) {
      // Prohlášení o neplátcovství má vlastní řádek, aby ho dlouhý zápis v rejstříku nevytlačil.
      const notes = capLines(wrapText(p.register || '', 'sans', 8, colW, measure).filter(Boolean), 4);
      if (!p.vatPayer) notes.push(L.nonPayer);
      if (notes.length) yy += 4;
      for (const l of notes) {
        text(l, x, yy, 'sans', 8, MUTED);
        yy += 11;
      }
    }
    return yy;
  };
  const leftEnd = party(supplier, M, L.supplier, true);
  const rightEnd = party(client, M + CW / 2 + 14, L.client, false);
  y = Math.max(leftEnd, rightEnd) + 10;

  // ---- data --------------------------------------------------------------
  const cells = [
    [L.issued, date(invoice.issued)],
    [totals.vatPayer ? L.supplyVat : L.supply, date(invoice.duzp || invoice.issued)],
    [L.due, date(invoice.due)],
    [L.method, L.transfer],
  ];
  rect(M, y, CW, 40, SOFT);
  const cellW = CW / cells.length;
  cells.forEach(([label, value], i) => {
    const x = M + 12 + i * cellW;
    fitted(label.toUpperCase(), x, y + 15, cellW - 14, 'bold', 7, MUTED);
    text(value, x, y + 30, 'bold', 10);
  });
  y += 40 + 26;

  // ---- položky -----------------------------------------------------------
  const cols = totals.vatPayer
    ? { qty: right - 242, qtyW: 70, price: right - 142, priceW: 94, vat: right - 100, total: right, totalW: 94 }
    : { qty: right - 200, qtyW: 78, price: right - 100, priceW: 94, total: right, totalW: 94 };
  const descW = cols.qty - cols.qtyW - 12 - M;

  const tableHead = () => {
    text(L.desc, M, y, 'bold', 7, MUTED);
    text(L.qty, cols.qty, y, 'bold', 7, MUTED, 'r');
    fitted(totals.vatPayer ? L.priceNet : L.price, cols.price, y, cols.priceW, 'bold', 7, MUTED, 'r');
    if (totals.vatPayer) text(L.vat, cols.vat, y, 'bold', 7, MUTED, 'r');
    fitted(totals.vatPayer ? L.totalNet : L.total, cols.total, y, cols.totalW, 'bold', 7, MUTED, 'r');
    y += 7;
    line(M, y, right, y, INK, 0.9);
    y += 16;
  };
  tableHead();

  const allItems = invoice.items || [];
  const items = allItems.filter((it) => it && (String(it.desc || '').trim() || num(it.price)));
  items.forEach((item, i) => {
    const descLines = wrapText(item.desc || '', 'sans', 9.5, descW, measure);
    // Krátký řádek se nedělí; dlouhý popis pokračuje na další straně.
    if (y + Math.min(descLines.length, 4) * 13 > bottom) {
      continuePage();
      tableHead();
    }
    const qty = formatQty(num(item.qty), lang) + (item.unit ? ' ' + item.unit : '');
    fitted(qty, cols.qty, y, cols.qtyW, 'mono', 9.5, INK, 'r');
    fitted(formatUnitPrice(num(item.price), currency, lang), cols.price, y, cols.priceW, 'mono', 9.5, INK, 'r');
    if (totals.vatPayer) text(L.pct(num(item.vat)), cols.vat, y, 'mono', 9.5, INK, 'r');
    fitted(money(totals.lines[allItems.indexOf(item)].base), cols.total, y, cols.totalW, 'mono', 9.5, INK, 'r');
    descLines.forEach((l, k) => {
      if (k > 0) {
        y += 13;
        if (y > bottom) {
          continuePage();
          tableHead();
        }
      }
      text(l, M, y);
    });
    y += 9;
    if (i < items.length - 1) line(M, y, right, y);
    y += 13;
  });
  if (!items.length) {
    text(L.noItems, M, y, 'sans', 9.5, MUTED);
    y += 22;
  }
  y -= 13;
  line(M, y, right, y, INK, 0.9);
  y += 22;

  // ---- součty ------------------------------------------------------------
  const sumRows = [];
  if (totals.vatPayer) {
    for (const v of totals.vat) {
      sumRows.push([L.base(v.rate), money(v.base)]);
      if (v.rate > 0) sumRows.push([L.vatRow(v.rate), money(v.tax)]);
    }
  }
  const extra = [];
  const exchange = num(invoice.exchangeRate);
  if (totals.vatPayer && currency === 'EUR' && exchange > 0) {
    const rateText = formatQty(exchange, lang);
    for (const v of totals.vat) {
      if (v.rate > 0) extra.push(L.vatCzk(v.rate, formatMoney(Math.round(v.tax * exchange), 'CZK', lang), rateText));
    }
  }
  if (totals.zeroRated && String(invoice.zeroVatNote || '').trim()) extra.push(String(invoice.zeroVatNote).trim());
  const extraLines = capLines(extra.flatMap((e) => wrapText(e, 'sans', 8.5, CW, measure)), 8);

  const sumsH = sumRows.length * 15 + 40 + extraLines.length * 12;
  if (y + sumsH > bottom) continuePage();
  const sumX = right - 250;
  for (const [label, value] of sumRows) {
    text(label, sumX, y, 'sans', 9.5, MUTED);
    fitted(value, right, y, 150, 'mono', 9.5, INK, 'r');
    y += 15;
  }
  if (sumRows.length) {
    line(sumX, y - 6, right, y - 6);
    y += 8;
  }
  y += 6;
  text(L.totalDue, sumX, y, 'bold', 11);
  fitted(money(totals.total), right, y, 250 - measure(L.totalDue, 'bold', 11) - 12, 'monoBold', 16, INK, 'r');
  y += 22;
  for (const l of extraLines) {
    text(l, right, y, 'sans', 8.5, MUTED, 'r');
    y += 12;
  }
  y += 8;

  // ---- platební údaje ----------------------------------------------------
  const paid = !!invoice.paidAt;
  const hasQr = !paid && !!(payment && payment.matrix);
  const payRows = [];
  const accountText = payment ? payment.account : String(supplier.account || '');
  if (accountText) payRows.push([L.account, accountText, 'monoBold']);
  if (payment && payment.iban) payRows.push(['IBAN', formatIban(payment.iban), 'mono']);
  if (payment && payment.bic) payRows.push(['BIC/SWIFT', payment.bic, 'mono']);
  if (invoice.vs) payRows.push([L.vs, invoice.vs, 'monoBold']);
  payRows.push([L.amount, money(totals.total), 'monoBold']);
  payRows.push(paid ? [L.paid, date(invoice.paidAt), 'monoBold'] : [L.payDue, date(invoice.due), 'mono']);

  const qrSize = 84;
  const qrPad = hasQr ? Math.max((4 * qrSize) / payment.matrix.length, 6) : 0; // tichá zóna 4 moduly
  const boxH = Math.max(48 + payRows.length * 16, hasQr ? qrSize + 2 * qrPad + 30 : 0, 112);
  if (y + boxH > bottom) continuePage();
  rect(M, y, CW, boxH, SOFT);
  rect(M, y, 3, boxH, accent);
  const px = M + 18;
  const valueX = px + Math.max(...payRows.map((r) => measure(r[0], 'sans', 9))) + 14;
  const valueW = right - 20 - valueX - (hasQr ? qrSize + 2 * qrPad + 14 : paid ? 150 : 0);
  let py = y + 20;
  text(L.payHead, px, py, 'bold', 7.5, MUTED);
  py += 20;
  for (const [label, value, font] of payRows) {
    text(label, px, py, 'sans', 9, MUTED);
    fitted(value, valueX, py, valueW, font, 9.5);
    py += 16;
  }
  if (hasQr) {
    const qx = right - 14 - qrPad - qrSize;
    const qy = y + 8 + qrPad;
    rect(qx - qrPad, qy - qrPad, qrSize + 2 * qrPad, qrSize + 2 * qrPad, '#ffffff');
    ops.push({ t: 'qr', matrix: payment.matrix, x: qx, y: qy, size: qrSize });
    text(payment.label || 'QR Platba', qx + qrSize / 2, qy + qrSize + qrPad + 12, 'bold', 8, INK, 'c');
  } else if (paid) {
    text(L.paidStamp, right - 18, y + 54, 'bold', 20, accent, 'r');
    text(L.paidNote, right - 18, y + 72, 'sans', 8.5, MUTED, 'r');
  }
  y += boxH + 22;

  // ---- poznámka ----------------------------------------------------------
  if (String(invoice.note || '').trim()) {
    for (const l of wrapText(invoice.note, 'sans', 9, CW, measure)) {
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
    const pageText = L.page(i + 1, pages.length);
    const contact = [supplier.name, supplier.email, supplier.phone].filter(Boolean).join('  ·  ');
    fitted(contact, M, fy - 3, CW - measure(pageText, 'sans', 7.5) - 16, 'sans', 7.5, MUTED);
    text(pageText, right, fy - 3, 'sans', 7.5, MUTED, 'r');
    if (branding) text(L.branding, M, fy + 9, 'sans', 7, MUTED);
  });

  return { pages, width: W, height: H };
}
