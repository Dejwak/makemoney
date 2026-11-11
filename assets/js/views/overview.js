// Přehled faktur: co čeká, co je po splatnosti, co už cinklo.

import { h, toast, confirmButton, chime } from '../ui.js';
import { state, persist, visibleInvoices, exportBackup, importBackup, newDraft } from '../lib/store.js';
import { daysBetween, formatDate, formatMoney, invoiceStatus, invoiceTotals, todayIso } from '../lib/calc.js';
import { saveFile } from '../lib/save.js';
import { dayWord } from '../lib/reminders.js';
import { isPro } from '../lib/pro.js';
import { downloadInvoicePdf } from './invoice.js';

const FILTERS = [
  ['all', 'Vše'],
  ['open', 'Čeká'],
  ['overdue', 'Po splatnosti'],
  ['paid', 'Zaplacené'],
];

function sumText(invoices) {
  const byCurrency = new Map();
  for (const inv of invoices) {
    const cur = inv.currency || 'CZK';
    byCurrency.set(cur, (byCurrency.get(cur) || 0) + invoiceTotals(inv).total);
  }
  if (!byCurrency.size) return formatMoney(0, 'CZK');
  return [...byCurrency.entries()].sort().map(([cur, cents]) => formatMoney(cents, cur)).join(' + ');
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  return n >= 2 && n <= 4 ? few : many;
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function invoicesCsv(invoices) {
  const head = ['Číslo', 'Odběratel', 'IČO odběratele', 'Vystaveno', 'Splatnost', 'Zaplaceno', 'Základ', 'DPH', 'Celkem', 'Měna', 'Variabilní symbol'];
  const rows = invoices.map((inv) => {
    const t = invoiceTotals(inv);
    const amount = (cents) => (cents / 100).toFixed(2).replace('.', ',');
    return [inv.number, inv.client?.name, inv.client?.ico, inv.issued, inv.due, inv.paidAt || '', amount(t.base), amount(t.tax), amount(t.total), inv.currency || 'CZK', inv.vs];
  });
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
}

export function overviewView({ go }) {
  const root = h('div', { class: 'overview-view' });
  let filter = 'all';

  function render() {
    const today = todayIso();
    const { list, example } = visibleInvoices();
    const withStatus = list.map((inv) => ({ inv, status: invoiceStatus(inv, today) }));
    const open = withStatus.filter((x) => x.status === 'open').map((x) => x.inv);
    const overdue = withStatus.filter((x) => x.status === 'overdue').map((x) => x.inv);
    const paidThisYear = withStatus.filter((x) => x.status === 'paid' && String(x.inv.paidAt).startsWith(today.slice(0, 4))).map((x) => x.inv);

    const tiles = h('div', { class: 'tiles' },
      tile('Čeká na zaplacení', sumText(open), `${open.length} ${plural(open.length, 'faktura', 'faktury', 'faktur')} ve splatnosti`, ''),
      tile('Po splatnosti', sumText(overdue), overdue.length ? 'Pošli upomínku, ať to cinkne.' : 'Nikdo ti nedluží po termínu.', overdue.length ? 'danger' : ''),
      tile(`Zaplaceno v roce ${today.slice(0, 4)}`, sumText(paidThisYear), `${paidThisYear.length} ${plural(paidThisYear.length, 'zaplacená faktura', 'zaplacené faktury', 'zaplacených faktur')}`, 'ok')
    );

    const shown = withStatus.filter((x) => filter === 'all' || x.status === filter);
    const filters = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtr faktur' },
      FILTERS.map(([id, label]) => h('button', { type: 'button', class: 'chip' + (filter === id ? ' is-active' : ''), 'aria-pressed': filter === id ? 'true' : 'false',
        onclick: () => { filter = id; render(); } }, label))
    );

    const rows = shown.map(({ inv, status }) => row(inv, status, today, example));
    const listEl = rows.length
      ? h('ul', { class: 'invoice-list' }, rows)
      : h('p', { class: 'empty' }, 'V tomhle filtru nic není.');

    const exampleNote = h('div', { class: 'notice notice-example' },
      h('p', null, h('strong', null, 'Ukázkové faktury.'), ' Zmizí, jakmile uložíš první vlastní.'),
      h('div', { class: 'notice-actions' }, h('a', { class: 'btn btn-small', href: '#faktura' }, 'Vystavit fakturu')));
    exampleNote.hidden = !example;

    root.replaceChildren(
      h('div', { class: 'view-head' }, h('h1', null, 'Přehled'), h('p', { class: 'lede' }, 'Kdo zaplatil, kdo má čas a komu je potřeba se připomenout.')),
      exampleNote,
      tiles,
      h('div', { class: 'list-head' }, filters, h('a', { class: 'btn btn-primary btn-small', href: '#faktura', onclick: () => { state.draft = newDraft(state.profile, state.invoices); persist(); } }, '+ Nová faktura')),
      listEl,
      backupCard(example)
    );
  }

  function tile(label, value, note, kind) {
    return h('div', { class: 'tile' + (kind ? ' is-' + kind : '') },
      h('span', { class: 'tile-label' }, label),
      h('strong', { class: 'tile-value mono' }, value),
      h('span', { class: 'tile-note' }, note));
  }

  function row(inv, status, today, example) {
    const totals = invoiceTotals(inv);
    const lateDays = daysBetween(inv.due, today);
    const pill = status === 'paid'
      ? h('span', { class: 'pill is-ok' }, `Zaplaceno ${formatDate(inv.paidAt)}`)
      : status === 'overdue'
        ? h('span', { class: 'pill is-danger' }, `${lateDays} ${dayWord(lateDays)} po splatnosti`)
        : h('span', { class: 'pill' }, lateDays === 0 ? 'Splatná dnes' : `Splatná za ${-lateDays} ${dayWord(-lateDays)}`);

    const li = h('li', { class: 'invoice-row is-' + status });
    const actions = h('div', { class: 'row-actions' });
    if (example) {
      actions.append(h('span', { class: 'tag' }, 'Ukázka'));
    } else {
      const pdfBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => downloadInvoicePdf(inv, pdfBtn) }, 'PDF');
      const buttons = [
        status === 'paid'
          ? h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => { inv.paidAt = null; persist(true); render(); } }, 'Vrátit mezi nezaplacené')
          : h('button', { type: 'button', class: 'btn btn-small btn-paid', onclick: () => {
              inv.paidAt = today;
              persist(true);
              chime();
              render();
              const fresh = root.querySelector(`[data-id="${inv.id}"]`);
              if (fresh) fresh.classList.add('just-paid');
              toast(`Cink! ${formatMoney(totals.total, inv.currency)} je doma.`);
            } }, 'Zaplaceno'),
        status !== 'paid' && h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => go('upominky', { invoiceId: inv.id }) }, 'Upomínka'),
        pdfBtn,
        h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => { state.draft = JSON.parse(JSON.stringify(inv)); persist(); go('faktura'); } }, 'Upravit'),
        confirmButton('Smazat', 'Opravdu smazat?', () => {
          state.invoices = state.invoices.filter((x) => x.id !== inv.id);
          if (state.draft.id === inv.id) state.draft.id = null;
          persist(true);
          render();
        })
      ];
      actions.append(...buttons.filter(Boolean));
    }
    li.dataset.id = inv.id;
    li.append(
      h('div', { class: 'row-main' },
        h('div', { class: 'row-who' }, h('strong', null, inv.client?.name || 'Bez odběratele'), h('span', { class: 'mono row-number' }, inv.number)),
        h('div', { class: 'row-amount mono' }, formatMoney(totals.total, inv.currency)),
        h('div', { class: 'row-status' }, pill, h('span', { class: 'row-due' }, `splatnost ${formatDate(inv.due)}`)),
        h('span', { class: 'stamp', 'aria-hidden': 'true' }, 'Zaplaceno')
      ),
      actions
    );
    return li;
  }

  function backupCard(example) {
    const pro = isPro();
    const fileInput = h('input', { type: 'file', id: 'backup-file', accept: 'application/json,.json', class: 'visually-hidden', onchange: (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const count = importBackup(String(reader.result));
          toast(`Záloha načtena, faktur: ${count}.`);
          render();
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    } });
    const save = async (name, data) => {
      try {
        await saveFile(name, data);
      } catch (err) {
        toast(err.code === 'declined' ? 'Uložení zrušeno.' : 'Stahování tady není dostupné. Otevři Cinkne v běžném prohlížeči.', err.code === 'declined' ? '' : 'error');
      }
    };
    return h('section', { class: 'card backup' },
      h('h2', null, 'Záloha a export'),
      h('p', null, 'Faktury jsou uložené jen v tomhle prohlížeči. Zálohu si stáhni vždy, když vystavíš něco důležitého, a na jiném zařízení ji zase načti.'),
      h('div', { class: 'actions-row' },
        h('button', { type: 'button', class: 'btn', disabled: example, onclick: () => save(`cinkne-zaloha-${todayIso()}.json`, exportBackup()) }, 'Stáhnout zálohu'),
        h('label', { class: 'btn', for: 'backup-file' }, 'Načíst zálohu', fileInput),
        h('button', { type: 'button', class: 'btn', disabled: example || !pro, onclick: () => save(`cinkne-faktury-${todayIso()}.csv`, invoicesCsv(state.invoices)) }, 'Export CSV pro účetní'),
        !pro && h('a', { class: 'pro-tag', href: '#pro' }, 'Pro')
      )
    );
  }

  render();
  return { el: root, refresh: render };
}
