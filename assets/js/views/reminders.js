// Upomínky: hotový text podle toho, jak dlouho je faktura po splatnosti.

import { h, field, toast } from '../ui.js';
import { state, persist, visibleInvoices } from '../lib/store.js';
import { daysBetween, formatDate, formatMoney, invoiceStatus, invoiceTotals, isAmount, num, statutoryInterestRate, todayIso } from '../lib/calc.js';
import { TONES, buildReminder, suggestTone, dayWord } from '../lib/reminders.js';
import { copyText } from '../lib/save.js';
import { trackEvent } from '../lib/track.js';

export function remindersView() {
  const root = h('div', { class: 'reminders-view' });
  let selectedId = null;
  let tone = null;
  // Ručně upravené texty podle faktury a tónu; přepnutí tónu je nezahodí.
  const edits = new Map();

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
        h('h2', null, list.length ? 'Všechno je zaplacené' : 'Žádná nezaplacená faktura'),
        h('p', null, list.length ? 'Na upomínku teď nikdo nečeká.' : 'Až nějakou fakturu vystavíš, najdeš ji tady.'),
        h('a', { class: 'btn', href: list.length ? '#prehled' : '#faktura' }, list.length ? 'Zpět na přehled' : 'Vystavit fakturu')));
      return;
    }

    const invoice = unpaid.find((inv) => inv.id === selectedId) || unpaid[0];
    selectedId = invoice.id;
    const daysLate = Math.max(daysBetween(invoice.due, today) || 0, 0);
    const overdue = daysLate > 0;
    const sentBefore = Array.isArray(invoice.reminders) ? invoice.reminders : [];
    const reminder = buildReminder(invoice, {
      tone: overdue ? tone || suggestTone(daysLate) : null,
      interestRate: state.reminder.interestRate,
      today,
      previous: sentBefore.length,
    });
    const activeTone = reminder.tone;

    const select = h('select', { id: 'rem-invoice', onchange: (e) => { selectedId = e.target.value; tone = null; render(); } },
      unpaid.map((inv) => {
        const late = daysBetween(inv.due, today) || 0;
        const label = `${inv.number} · ${inv.client?.name || 'bez odběratele'} · ${formatMoney(invoiceTotals(inv).total, inv.currency)} · ${late > 0 ? `${late} ${dayWord(late)} po splatnosti` : 've splatnosti'}`;
        return h('option', { value: inv.id, selected: inv.id === invoice.id }, label);
      }));

    const tones = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Tón upomínky' },
      TONES.map((t) => h('button', { type: 'button', class: 'segment' + (t.id === activeTone ? ' is-active' : ''), disabled: !overdue,
        'aria-pressed': t.id === activeTone ? 'true' : 'false', onclick: () => { tone = t.id; render(); } }, h('strong', null, t.label), h('span', null, t.hint))));
    const earlyNote = h('p', { class: 'fine' }, 'Faktura ještě není po splatnosti, takže se hodí jen zdvořilé připomenutí termínu. Upomínky se odemknou den po splatnosti.');
    earlyNote.hidden = overdue;

    const statutory = statutoryInterestRate(invoice.due);
    const statutoryText = statutory == null ? '' : String(statutory).replace('.', ',');
    const interest = field({ id: 'rem-interest', label: 'Úrok z prodlení (% ročně)', value: state.reminder.interestRate, inputmode: 'decimal', mono: true, placeholder: 'nevyplněno = bez úroku',
      hint: 'Zákonný úrok je repo sazba ČNB platná první den pololetí, kdy prodlení začalo, plus 8 procentních bodů.'
        + (statutory == null ? ' Pro tohle pololetí sazbu neznám, repo sazbu najdeš na cnb.cz.' : ` Pro tuhle fakturu vychází ${statutoryText} % ročně.`)
        + ' Jinou sazbu použij jen tehdy, máte-li ji sjednanou ve smlouvě.',
      onchange: (v) => { state.reminder.interestRate = v.trim(); persist(); render(); } });
    const rate = state.reminder.interestRate;
    if (rate !== '' && !(isAmount(rate) && num(rate) > 0 && num(rate) <= 1000)) interest.setHint('Sazbě nerozumím. Piš ji třeba jako 11,75.', 'warn');
    const useStatutory = h('button', { type: 'button', class: 'btn btn-small', onclick: () => { state.reminder.interestRate = statutoryText; persist(); render(); } }, `Použít zákonných ${statutoryText} %`);
    useStatutory.hidden = statutory == null || state.reminder.interestRate === statutoryText;
    const finalBox = h('div', { class: 'final-box' }, interest, useStatutory,
      h('p', { class: 'fine' }, 'Výzvu před žalobou pošli prokazatelně, tedy doporučeně nebo datovou schránkou. Samotný e-mail jako důkaz nemusí stačit.'));
    finalBox.hidden = activeTone !== 'final';

    const subject = h('input', { id: 'rem-subject', type: 'text', readOnly: true, value: reminder.subject });
    const editKey = `${invoice.id}:${activeTone}`;
    const edited = edits.has(editKey);
    const body = h('textarea', { id: 'rem-body', rows: 14, value: edited ? edits.get(editKey) : reminder.body,
      oninput: (e) => {
        const had = edits.has(editKey);
        if (e.target.value === reminder.body) edits.delete(editKey);
        else edits.set(editKey, e.target.value);
        if (had !== edits.has(editKey)) editedNote.hidden = !edits.has(editKey);
      } });
    const editedNote = h('div', { class: 'edited-note' },
      h('p', { class: 'fine' }, 'Tohle je tvoje upravená verze. Změna úroku ani data se do ní sama nepromítne.'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => { edits.delete(editKey); render(); } }, 'Vrátit původní text'));
    editedNote.hidden = !edited;
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
            h('div', null, h('dt', null, 'Po splatnosti'), h('dd', { class: 'mono' }, overdue ? `${daysLate} ${dayWord(daysLate)}` : 'zatím ne')),
            h('div', null, h('dt', null, 'Dlužná částka'), h('dd', { class: 'mono' }, formatMoney(invoiceTotals(invoice).total, invoice.currency))),
            activeTone === 'final' && reminder.interest > 0 && h('div', null, h('dt', null, 'Úrok k dnešku'), h('dd', { class: 'mono' }, formatMoney(reminder.interest, invoice.currency)))
          ),
          h('span', { class: 'field-label' }, 'Tón'),
          tones,
          earlyNote,
          finalBox
        ),
        h('div', { class: 'card' },
          h('div', { class: 'copy-field' },
            h('label', { class: 'field', for: 'rem-email' }, h('span', { class: 'field-label' }, 'Komu'), emailInput),
            h('button', { type: 'button', class: 'btn btn-small', disabled: !email, onclick: () => copy(email, 'E-mail', emailInput) }, 'Kopírovat')),
          h('div', { class: 'copy-field' },
            h('label', { class: 'field', for: 'rem-subject' }, h('span', { class: 'field-label' }, 'Předmět'), subject),
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => copy(subject.value, 'Předmět', subject) }, 'Kopírovat')),
          h('label', { class: 'field', for: 'rem-body' }, h('span', { class: 'field-label' }, 'Text (můžeš upravit)'), body),
          editedNote,
          reminder.lang === 'en' && h('p', { class: 'fine' }, 'Faktura je v angličtině, upomínka proto taky.'),
          h('div', { class: 'actions-row' },
            h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { trackEvent('reminder_copied', { tone: activeTone, lang: reminder.lang }); copy(body.value, 'Text upomínky', body); } }, 'Kopírovat text upomínky'),
            h('button', { type: 'button', class: 'btn', disabled: example, onclick: () => {
              if (!Array.isArray(invoice.reminders)) invoice.reminders = [];
              invoice.reminders.push({ date: todayIso(), tone: activeTone });
              if (persist(true)) toast('Zapsáno. V přehledu uvidíš, kdy upomínka naposledy odešla.');
              else toast('Zapsáno, ale prohlížeč změnu neuložil. Po zavření stránky zmizí.', 'error');
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
