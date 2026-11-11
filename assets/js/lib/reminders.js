import { formatDate, formatMoney, invoiceTotals, lateInterest, daysBetween, todayIso } from './calc.js';

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
 * Sestaví text upomínky.
 * @returns {{ subject: string, body: string, daysLate: number, interest: number }}
 */
export function buildReminder(invoice, { tone, interestRate = 0, today = todayIso() } = {}) {
  const { total } = invoiceTotals(invoice);
  const currency = invoice.currency || 'CZK';
  const daysLate = Math.max(daysBetween(invoice.due, today), 0);
  const chosen = tone || suggestTone(daysLate);
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
  const late = daysLate > 0 ? `${daysLate} ${dayWord(daysLate)} po splatnosti` : 'po splatnosti';
  const sign = `S pozdravem\n${supplier.name || ''}`.trim();

  let subject;
  let paragraphs;
  if (chosen === 'friendly') {
    subject = `Připomenutí faktury ${invoice.number}`;
    paragraphs = [
      greeting,
      `posílám připomenutí faktury ${invoice.number} se splatností ${formatDate(invoice.due)}. Platbu u sebe zatím nevidím, možná jen zapadla.`,
      pay,
      'Pokud už je platba na cestě, berte prosím tuhle zprávu jako bezpředmětnou. Fakturu v případě potřeby pošlu znovu.',
      'Děkuji.',
    ];
  } else if (chosen === 'firm') {
    subject = `Upomínka: faktura ${invoice.number} je ${late}`;
    paragraphs = [
      greeting,
      `faktura ${invoice.number} byla splatná ${formatDate(invoice.due)} a je ${late}. Prosím o úhradu do 5 pracovních dnů.`,
      pay,
      'Pokud úhradě něco brání, dejte mi vědět a domluvíme se.',
      'Děkuji.',
    ];
  } else {
    subject = `Poslední výzva k úhradě faktury ${invoice.number}`;
    const interestLine = interest > 0
      ? `K dnešnímu dni činí úrok z prodlení ${formatMoney(interest, currency)} (${String(interestRate).replace('.', ',')} % ročně).`
      : '';
    paragraphs = [
      greeting,
      `přes předchozí připomenutí neeviduji úhradu faktury ${invoice.number} splatné ${formatDate(invoice.due)}. Faktura je ${late}.`,
      pay,
      interestLine,
      'Tímto vás vyzývám k úhradě dlužné částky do 7 dnů od doručení této výzvy. Nebude-li částka uhrazena, budu pohledávku vymáhat právní cestou včetně úroku z prodlení a nákladů spojených s vymáháním.',
    ].filter(Boolean);
  }
  return { subject, body: [...paragraphs, sign].join('\n\n'), daysLate, interest, tone: chosen };
}
