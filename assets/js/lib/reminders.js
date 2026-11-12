import { addDays, formatDate, formatMoney, invoiceTotals, lateInterest, daysBetween, todayIso } from './calc.js';

export const TONES = [
  { id: 'friendly', label: 'Přátelská', hint: 'pár dní po splatnosti' },
  { id: 'firm', label: 'Důrazná', hint: 'týden a víc' },
  { id: 'final', label: 'Poslední výzva', hint: 'měsíc a víc' },
];

/** Tón podle počtu dní po splatnosti. */
export function suggestTone(daysLate) {
  if (daysLate >= 30) return 'final';
  if (daysLate >= 8) return 'firm';
  return 'friendly';
}

export function dayWord(n) {
  if (n === 1) return 'den';
  if (n >= 2 && n <= 4) return 'dny';
  return 'dní';
}

/**
 * Sestaví text upomínky. Faktuře, která ještě není po splatnosti, patří jen zdvořilé
 * připomenutí termínu (tón 'early'), ať se zvolí cokoli.
 * @param {object} invoice
 * @param {{ tone?: string, interestRate?: number|string, today?: string, previous?: number }} options
 *   previous = kolik upomínek už odešlo
 * @returns {{ subject: string, body: string, daysLate: number, interest: number, tone: string }}
 */
export function buildReminder(invoice, { tone, interestRate = 0, today = todayIso(), previous = 0 } = {}) {
  const { total } = invoiceTotals(invoice);
  const currency = invoice.currency || 'CZK';
  const daysLate = Math.max(daysBetween(invoice.due, today) || 0, 0);
  const chosen = daysLate === 0 ? 'early' : tone || suggestTone(daysLate);
  const interest = lateInterest(total, interestRate, daysLate);
  const amount = formatMoney(total, currency);
  const supplier = invoice.supplier || {};
  const account = supplier.accountDisplay || supplier.account || '';
  const greeting = 'Dobrý den,';
  const pay = [
    `Částka: ${amount}`,
    account ? `Účet: ${account}` : '',
    invoice.vs ? `Variabilní symbol: ${invoice.vs}` : '',
  ].filter(Boolean).join('\n');
  const late = `${daysLate} ${dayWord(daysLate)} po splatnosti`;
  const due = formatDate(invoice.due);
  const sign = `S pozdravem\n${supplier.name || ''}`.trim();

  let subject;
  let paragraphs;
  if (chosen === 'early') {
    subject = `Blíží se splatnost faktury ${invoice.number}`;
    paragraphs = [
      greeting,
      `dovoluji si připomenout fakturu č. ${invoice.number}, která je splatná ${due}.`,
      pay,
      'Pokud už je platba na cestě, považujte prosím tuto zprávu za bezpředmětnou.',
      'Děkuji.',
    ];
  } else if (chosen === 'friendly') {
    subject = `Připomenutí faktury ${invoice.number}`;
    paragraphs = [
      greeting,
      `dovoluji si připomenout fakturu č. ${invoice.number} se splatností ${due}. Platbu zatím neeviduji, možná faktura jen zapadla.`,
      pay,
      'Pokud už je platba na cestě, považujte prosím tuto zprávu za bezpředmětnou. Fakturu v případě potřeby pošlu znovu.',
      'Děkuji.',
    ];
  } else if (chosen === 'firm') {
    subject = `Upomínka: faktura ${invoice.number} je ${late}`;
    paragraphs = [
      greeting,
      `faktura č. ${invoice.number} byla splatná ${due} a je ${late}. Prosím o úhradu do 5 pracovních dnů.`,
      pay,
      'Pokud úhradě něco brání, dejte mi prosím vědět a domluvíme se.',
      'Děkuji.',
    ];
  } else {
    subject = `Poslední výzva k úhradě faktury ${invoice.number}`;
    const rateText = String(interestRate).replace('.', ',').replace(/\s*%$/, '');
    const interestLine = interest > 0
      ? `K dnešnímu dni činí úrok z prodlení ${formatMoney(interest, currency)} (${rateText} % ročně).`
      : '';
    paragraphs = [
      greeting,
      `${previous > 0 ? 'přes předchozí připomenutí' : 'dosud'} neeviduji úhradu faktury č. ${invoice.number} splatné ${due}. Faktura je ${late}.`,
      pay,
      interestLine,
      `Vyzývám Vás tímto k úhradě dlužné částky nejpozději do ${formatDate(addDays(today, 7))}. Nebude-li částka v této lhůtě uhrazena, budu pohledávku vymáhat soudní cestou, a to včetně zákonného úroku z prodlení a nákladů řízení.`,
    ].filter(Boolean);
  }
  return { subject, body: [...paragraphs, sign].join('\n\n'), daysLate, interest, tone: chosen };
}
