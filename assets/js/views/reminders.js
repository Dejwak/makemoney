// Upomínky: hotový text podle toho, jak dlouho je faktura po splatnosti.

import { h, field, toast } from '../ui.js';
import { state, persist, visibleInvoices } from '../lib/store.js';
import { daysBetween, formatDate, formatMoney, invoiceStatus, invoiceTotals, todayIso } from '../lib/calc.js';
import { TONES, buildReminder, suggestTone, dayWord } from '../lib/reminders.js';
import { copyText } from '../lib/save.js';

export function remindersView() {
  const root = h('div', { class: 'reminders-view' });
  let selectedId = null;
  let tone = null;

  async function copy(text, what, fallbackEl) {
    if (await copyText(text)) {
      toast(`${what} je ve schránce.`);
    } else {
      fallbackEl.focus();
      fallbackEl.select();
      toast('Kopírování tu nejde. Text je označený, zkopíruj ho ručně.');
    }
  }

  function render(params) {
    if (params && params.invoiceId) {
      selectedId = params.invoiceId;
      tone = null;
    }
    const today = todayIso();
    const { list, example } = visibleInvoices();
    const unpaid = list
      .filter((inv) => invoiceStatus(inv, today) !== 'paid')
      .sort((a, b) => String(a.due).localeCompare(String(b.due)));

    const head = h('div', { class: 'view-head' }, h('h1', null, 'Upomínky'),
      h('p', { class: 'lede' }, 'Připomenout se není neslušné. Vyber fakturu a pošli hotový text.'));

    if (!unpaid.length) {
      root.replaceChildren(head, h('div', { class: 'card empty-card' },
        h('h2', null, 'Všechno je zaplacené'),
        h('p', null, 'Žádná faktura na upomínku nečeká. Až nějaká bude po splatnosti, najdeš ji tady.'),
        h('a', { class: 'btn', href: '#prehled' }, 'Zpět na přehled')));
      return;
    }

    const invoice = unpaid.find((inv) => inv.id === selectedId) || unpaid[0];
    selectedId = invoice.id;
    const daysLate = Math.max(daysBetween(invoice.due, today), 0);
    const activeTone = tone || suggestTone(daysLate);
    const reminder = buildReminder(invoice, { tone: activeTone, interestRate: state.reminder.interestRate, today });

    const select = h('select', { id: 'rem-invoice', onchange: (e) => { selectedId = e.target.value; tone = null; render(); } },
      unpaid.map((inv) => {
        const late = daysBetween(inv.due, today);
        const label = `${inv.number} · ${inv.client?.name || 'bez odběratele'} · ${formatMoney(invoiceTotals(inv).total, inv.currency)} · ${late > 0 ? `${late} ${dayWord(late)} po splatnosti` : 've splatnosti'}`;
        return h('option', { value: inv.id, selected: inv.id === invoice.id }, label);
      }));

    const tones = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Tón upomínky' },
      TONES.map((t) => h('button', { type: 'button', class: 'segment' + (t.id === activeTone ? ' is-active' : ''), 'aria-pressed': t.id === activeTone ? 'true' : 'false',
        onclick: () => { tone = t.id; render(); } }, h('strong', null, t.label), h('span', null, t.hint))));

    const interest = field({ id: 'rem-interest', label: 'Úrok z prodlení (% ročně)', value: state.reminder.interestRate, inputmode: 'decimal', mono: true, placeholder: 'nevyplněno = bez úroku',
      hint: 'Zákonný úrok je repo sazba ČNB platná první den pololetí, kdy prodlení začalo, plus 8 procentních bodů. Aktuální sazbu najdeš na cnb.cz.',
      onchange: (v) => { state.reminder.interestRate = v.trim(); persist(); render(); } });
    interest.hidden = activeTone !== 'final';

    const sentBefore = Array.isArray(invoice.reminders) ? invoice.reminders : [];
    const subject = h('input', { id: 'rem-subject', type: 'text', readOnly: true, value: reminder.subject });
    const body = h('textarea', { id: 'rem-body', rows: 14, value: reminder.body });
    const email = invoice.client?.email || '';
    const emailInput = h('input', { id: 'rem-email', type: 'text', readOnly: true, class: 'mono', value: email || 'u odběratele není e-mail' });

    const exampleNote = h('div', { class: 'notice notice-example' }, h('p', null, h('strong', null, 'Ukázka.'), ' Text je sestavený z ukázkové faktury. S vlastními fakturami tu uvidíš své dlužníky.'));
    exampleNote.hidden = !example;

    root.replaceChildren(
      head,
      exampleNote,
      h('div', { class: 'reminder-layout' },
        h('div', { class: 'card' },
          h('label', { class: 'field', for: 'rem-invoice' }, h('span', { class: 'field-label' }, 'Faktura'), select),
          h('dl', { class: 'facts' },
            h('div', null, h('dt', null, 'Splatnost'), h('dd', { class: 'mono' }, formatDate(invoice.due))),
            h('div', null, h('dt', null, 'Po splatnosti'), h('dd', { class: 'mono' }, daysLate ? `${daysLate} ${dayWord(daysLate)}` : 'zatím ne')),
            h('div', null, h('dt', null, 'Dluh'), h('dd', { class: 'mono' }, formatMoney(invoiceTotals(invoice).total, invoice.currency))),
            reminder.interest > 0 && h('div', null, h('dt', null, 'Úrok k dnešku'), h('dd', { class: 'mono' }, formatMoney(reminder.interest, invoice.currency)))
          ),
          h('span', { class: 'field-label' }, 'Tón'),
          tones,
          interest
        ),
        h('div', { class: 'card' },
          h('div', { class: 'copy-field' },
            h('label', { class: 'field', for: 'rem-email' }, h('span', { class: 'field-label' }, 'Komu'), emailInput),
            h('button', { type: 'button', class: 'btn btn-small', disabled: !email, onclick: () => copy(email, 'E-mail', emailInput) }, 'Kopírovat')),
          h('div', { class: 'copy-field' },
            h('label', { class: 'field', for: 'rem-subject' }, h('span', { class: 'field-label' }, 'Předmět'), subject),
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => copy(subject.value, 'Předmět', subject) }, 'Kopírovat')),
          h('label', { class: 'field', for: 'rem-body' }, h('span', { class: 'field-label' }, 'Text (můžeš upravit)'), body),
          h('div', { class: 'actions-row' },
            h('button', { type: 'button', class: 'btn btn-primary', onclick: () => copy(body.value, 'Text upomínky', body) }, 'Kopírovat text upomínky'),
            h('button', { type: 'button', class: 'btn', disabled: example, onclick: () => {
              if (!Array.isArray(invoice.reminders)) invoice.reminders = [];
              invoice.reminders.push({ date: today, tone: activeTone });
              persist(true);
              toast('Zapsáno. V přehledu uvidíš, kdy ses naposledy připomněl(a).');
              render();
            } }, 'Zapsat jako odeslanou')),
          sentBefore.length > 0 && h('p', { class: 'fine' }, `Upomínka už odešla ${sentBefore.length}×, naposledy ${formatDate(sentBefore[sentBefore.length - 1].date)}.`)
        )
      )
    );
  }

  render();
  return { el: root, refresh: render };
}
