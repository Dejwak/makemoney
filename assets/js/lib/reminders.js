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

// Texty upomínek. Odběrateli se vyká; anglická faktura dostane anglickou upomínku.
const TEXTS = {
  cs: {
    greeting: 'Dobrý den,',
    sign: 'S pozdravem',
    thanks: 'Děkuji.',
    amount: 'Částka', account: 'Účet', vs: 'Variabilní symbol',
    late: (n) => `${n} ${dayWord(n)} po splatnosti`,
    early: {
      subject: (no) => `Blíží se splatnost faktury ${no}`,
      lines: (c) => [
        `dovoluji si připomenout fakturu č. ${c.no}, která je splatná ${c.due}.`,
        c.pay,
        'Pokud už je platba na cestě, považujte prosím tuto zprávu za bezpředmětnou.',
        c.t.thanks,
      ],
    },
    friendly: {
      subject: (no) => `Připomenutí faktury ${no}`,
      lines: (c) => [
        `dovoluji si připomenout fakturu č. ${c.no} se splatností ${c.due}. Platbu zatím neeviduji, možná faktura jen zapadla.`,
        c.pay,
        'Pokud už je platba na cestě, považujte prosím tuto zprávu za bezpředmětnou. Fakturu v případě potřeby pošlu znovu.',
        c.t.thanks,
      ],
    },
    firm: {
      subject: (no, late) => `Upomínka: faktura ${no} je ${late}`,
      lines: (c) => [
        `faktura č. ${c.no} byla splatná ${c.due} a je ${c.late}. Prosím o úhradu do 5 pracovních dnů.`,
        c.pay,
        'Pokud úhradě něco brání, dejte mi prosím vědět a domluvíme se.',
        c.t.thanks,
      ],
    },
    final: {
      subject: (no) => `Poslední výzva k úhradě faktury ${no}`,
      lines: (c) => [
        `${c.previous > 0 ? 'přes předchozí připomenutí' : 'dosud'} neeviduji úhradu faktury č. ${c.no} splatné ${c.due}. Faktura je ${c.late}.`,
        c.pay,
        c.interest ? `K dnešnímu dni činí úrok z prodlení ${c.interest} (${c.rate} % ročně).` : '',
        `Vyzývám Vás tímto k úhradě dlužné částky nejpozději do ${c.deadline}. Nebude-li částka v této lhůtě uhrazena, budu pohledávku vymáhat soudní cestou, a to včetně zákonného úroku z prodlení a nákladů řízení.`,
      ],
    },
  },
  en: {
    greeting: 'Hello,',
    sign: 'Kind regards',
    thanks: 'Thank you.',
    amount: 'Amount', account: 'Account', vs: 'Payment reference',
    late: (n) => `${n} ${n === 1 ? 'day' : 'days'} overdue`,
    early: {
      subject: (no) => `Invoice ${no} is due soon`,
      lines: (c) => [
        `this is a friendly reminder that invoice ${c.no} is due on ${c.due}.`,
        c.pay,
        'If the payment is already on its way, please disregard this message.',
        c.t.thanks,
      ],
    },
    friendly: {
      subject: (no) => `Reminder: invoice ${no}`,
      lines: (c) => [
        `I would like to remind you of invoice ${c.no}, which was due on ${c.due}. I have not received the payment yet; perhaps the invoice was simply overlooked.`,
        c.pay,
        'If the payment is already on its way, please disregard this message. I am happy to send the invoice again if needed.',
        c.t.thanks,
      ],
    },
    firm: {
      subject: (no, late) => `Payment reminder: invoice ${no} is ${late}`,
      lines: (c) => [
        `invoice ${c.no} was due on ${c.due} and is now ${c.late}. Please arrange payment within 5 business days.`,
        c.pay,
        'If anything is preventing the payment, please let me know so that we can find a solution.',
        c.t.thanks,
      ],
    },
    final: {
      subject: (no) => `Final notice: invoice ${no}`,
      lines: (c) => [
        `${c.previous > 0 ? 'despite my previous reminders, ' : ''}I have still not received payment of invoice ${c.no}, which was due on ${c.due}. The invoice is ${c.late}.`,
        c.pay,
        c.interest ? `As of today, late-payment interest amounts to ${c.interest} (${c.rate}% per year).` : '',
        `I request payment of the outstanding amount by ${c.deadline} at the latest. If the amount is not paid by then, I will pursue the claim in court, including statutory late-payment interest and the costs of the proceedings.`,
      ],
    },
  },
};

/**
 * Sestaví text upomínky. Faktuře, která ještě není po splatnosti, patří jen zdvořilé
 * připomenutí termínu (tón 'early'), ať se zvolí cokoli.
 * @param {object} invoice
 * @param {{ tone?: string, interestRate?: number|string, today?: string, previous?: number }} options
 *   previous = kolik upomínek už odešlo
 * @returns {{ subject: string, body: string, daysLate: number, interest: number, tone: string, lang: string }}
 */
export function buildReminder(invoice, { tone, interestRate = 0, today = todayIso(), previous = 0 } = {}) {
  const lang = invoice.lang === 'en' ? 'en' : 'cs';
  const t = TEXTS[lang];
  const { total } = invoiceTotals(invoice);
  const currency = invoice.currency || 'CZK';
  const daysLate = Math.max(daysBetween(invoice.due, today) || 0, 0);
  const chosen = daysLate === 0 ? 'early' : TEXTS.cs[tone] && tone !== 'early' ? tone : suggestTone(daysLate);
  const interest = lateInterest(total, interestRate, daysLate);
  const supplier = invoice.supplier || {};
  const account = supplier.accountDisplay || supplier.account || '';
  const pay = [
    `${t.amount}: ${formatMoney(total, currency, lang)}`,
    account ? `${t.account}: ${account}` : '',
    invoice.vs ? `${t.vs}: ${invoice.vs}` : '',
  ].filter(Boolean).join('\n');
  const late = t.late(daysLate);
  const rate = String(interestRate).replace(/\s*%$/, '');
  const context = {
    t, pay, late, previous,
    no: invoice.number,
    due: formatDate(invoice.due, lang),
    deadline: formatDate(addDays(today, 7), lang),
    interest: interest > 0 ? formatMoney(interest, currency, lang) : '',
    rate: lang === 'en' ? rate.replace(',', '.') : rate.replace('.', ','),
  };
  const template = t[chosen];
  const lines = template.lines(context).filter(Boolean);
  // Česká věta po oslovení pokračuje malým písmenem, anglická začíná velkým.
  if (lang === 'en') lines[0] = lines[0].charAt(0).toUpperCase() + lines[0].slice(1);
  const sign = `${t.sign}\n${supplier.name || ''}`.trim();
  return {
    subject: template.subject(invoice.number, late),
    body: [t.greeting, ...lines, sign].join('\n\n'),
    daysLate, interest, tone: chosen, lang,
  };
}
