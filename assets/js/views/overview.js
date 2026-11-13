// Přehled faktur: co čeká, co je po splatnosti, co už cinklo.

import { h, toast, confirmButton, chime } from '../ui.js';
import {
  state, persist, visibleInvoices, exportBackup, inspectBackup, applyBackup, startNewDraft, editInvoice,
  duplicateAsDraft, deleteInvoice, duplicateNumbers, markBackedUp, unbackedInvoices,
} from '../lib/store.js';
import { daysBetween, formatDate, formatMoney, formatWhole, invoiceStatus, invoiceTotals, todayIso, yearTurnover } from '../lib/calc.js';
import { saveFile, saveErrorMessage } from '../lib/save.js';
import { dayWord } from '../lib/reminders.js';
import { isPro } from '../lib/pro.js';
import { trackEvent } from '../lib/track.js';
import { downloadInvoicePdf } from './invoice.js';

const FILTERS = [
  ['all', 'Vše'],
  ['open', 'Ve splatnosti'],
  ['overdue', 'Po splatnosti'],
  ['paid', 'Zaplacené'],
];

// Limity obratu pro povinnou registraci k DPH (§ 6 zákona o DPH, stav pro rok 2026).
const VAT_LIMIT = 2000000;
const VAT_LIMIT_IMMEDIATE = 2536500;

function sumLines(invoices) {
  const byCurrency = new Map();
  for (const inv of invoices) {
    const cur = inv.currency || 'CZK';
    byCurrency.set(cur, (byCurrency.get(cur) || 0) + invoiceTotals(inv).total);
  }
  if (!byCurrency.size) return [formatMoney(0, 'CZK')];
  return [...byCurrency.entries()].sort().map(([cur, cents]) => formatMoney(cents, cur));
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  return n >= 2 && n <= 4 ? few : many;
}

/** Součet po měnách: každá měna na vlastním řádku. */
function sumText(invoices) {
  return sumLines(invoices).map((line) => h('span', { class: 'tile-line' }, line));
}

/** Buňka CSV. Text od uživatele se zneškodní, aby ho tabulkový procesor nevzal jako vzorec (=, +, -, @). */
function csvCell(value, userText = true) {
  let s = String(value ?? '');
  if (userText && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function invoicesCsv(invoices) {
  const head = ['Číslo', 'Odběratel', 'IČO odběratele', 'DIČ odběratele', 'Vystaveno', 'Datum plnění', 'Splatnost', 'Zaplaceno', 'Základ', 'DPH', 'Celkem', 'Měna', 'Variabilní symbol'];
  const amount = (cents) => (cents / 100).toFixed(2).replace('.', ',');
  const rows = invoices.map((inv) => {
    const t = invoiceTotals(inv);
    const texts = [inv.number, inv.client?.name, inv.client?.ico, inv.client?.dic].map((v) => csvCell(v));
    const dates = [inv.issued, inv.duzp || inv.issued, inv.due, inv.paidAt || ''].map((v) => csvCell(v));
    // Částky počítá aplikace sama; záporná částka (sleva) je číslo, ne vzorec.
    const numbers = [amount(t.base), amount(t.tax), amount(t.total)].map((v) => csvCell(v, false));
    return [...texts, ...dates, ...numbers, csvCell(inv.currency || 'CZK'), csvCell(inv.vs)];
  });
  return '\ufeff' + [head, ...rows].map((r) => r.join(';')).join('\r\n');
}

export function overviewView({ go }) {
  const root = h('div', { class: 'overview-view' });
  let filter = 'all';
  let pendingBackup = null;
  let dupes = new Set();

  /** Akce, která zahodí rozepsanou fakturu, se napřed zeptá. */
  const draftAction = (label, run, cls = 'btn btn-ghost btn-small') => (state.dirty
    ? confirmButton(label, 'Zahodit rozepsanou fakturu?', run, cls)
    : h('button', { type: 'button', class: cls, onclick: run }, label));

  function render() {
    const today = todayIso();
    const year = today.slice(0, 4);
    const { list, example } = visibleInvoices();
    const withStatus = list.map((inv) => ({ inv, status: invoiceStatus(inv, today) }));
    dupes = new Set(duplicateNumbers(list).map((n) => n.toLowerCase()));
    const open = withStatus.filter((x) => x.status === 'open').map((x) => x.inv);
    const overdue = withStatus.filter((x) => x.status === 'overdue').map((x) => x.inv);
    const paidThisYear = withStatus.filter((x) => x.status === 'paid' && String(x.inv.paidAt).startsWith(year)).map((x) => x.inv);

    const tiles = h('div', { class: 'tiles' },
      tile('Čeká na zaplacení', sumText(open), `${open.length} ${plural(open.length, 'faktura', 'faktury', 'faktur')} ve splatnosti`, ''),
      tile('Po splatnosti', sumText(overdue), overdue.length ? 'Pošli upomínku, ať to cinkne.' : 'Nikdo není po splatnosti.', overdue.length ? 'danger' : ''),
      tile(`Zaplaceno v roce ${year}`, sumText(paidThisYear), `${paidThisYear.length} ${plural(paidThisYear.length, 'zaplacená faktura', 'zaplacené faktury', 'zaplacených faktur')}`, 'ok')
    );

    const shown = withStatus.filter((x) => filter === 'all' || x.status === filter);
    const filters = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtr faktur' },
      FILTERS.map(([id, label]) => h('button', { type: 'button', class: 'chip' + (filter === id ? ' is-active' : ''), 'aria-pressed': filter === id ? 'true' : 'false',
        onclick: () => { filter = id; render(); } }, label))
    );

    let listEl;
    if (!list.length) {
      listEl = h('div', { class: 'card empty-card' },
        h('h2', null, 'Zatím tu žádná faktura není'),
        h('p', null, 'Jakmile nějakou uložíš, uvidíš tady, kdo zaplatil a komu se připomenout.'),
        h('a', { class: 'btn btn-primary', href: '#faktura' }, 'Vystavit první fakturu'));
    } else if (!shown.length) {
      listEl = h('p', { class: 'empty' }, 'V tomhle filtru nic není.');
    } else {
      listEl = h('ul', { class: 'invoice-list' }, shown.map(({ inv, status }) => row(inv, status, today, example)));
    }

    // Připomínka zálohy: po třech nových fakturách, nebo když nová faktura čeká na zálohu déle než týden.
    const unbacked = example ? { count: 0, oldest: '' } : unbackedInvoices();
    const waiting = unbacked.oldest ? (Date.now() - Date.parse(unbacked.oldest)) / 86400000 : 0;
    const backupNote = h('div', { class: 'notice', id: 'backup-note' },
      h('p', null, h('strong', null, `${unbacked.count} ${plural(unbacked.count, 'faktura ještě není', 'faktury ještě nejsou', 'faktur ještě není')} v záloze.`),
        ' Jsou uložené jen v tomhle prohlížeči. Když si ho vymažeš nebo vyměníš zařízení, přijdeš o ně.'),
      h('div', { class: 'notice-actions' }, h('button', { type: 'button', class: 'btn btn-small', onclick: downloadBackup }, 'Stáhnout zálohu')));
    backupNote.hidden = !(unbacked.count >= 3 || (unbacked.count >= 1 && waiting > 7));

    const exampleNote = h('div', { class: 'notice notice-example' },
      h('p', null, h('strong', null, 'Ukázkové faktury.'), ' Zmizí, jakmile uložíš první vlastní.'),
      h('div', { class: 'notice-actions' }, h('a', { class: 'btn btn-small', href: '#faktura' }, 'Vystavit fakturu')));
    exampleNote.hidden = !example;

    const showTurnover = !example && !state.profile.vatPayer && list.length > 0;
    root.replaceChildren(...[
      h('div', { class: 'view-head' }, h('h1', null, 'Přehled'), h('p', { class: 'lede' }, 'Kdo zaplatil, kdo má čas a komu je potřeba se připomenout.')),
      exampleNote,
      backupNote,
      tiles,
      h('div', { class: 'list-head' }, filters, draftAction('+ Nová faktura', () => { startNewDraft(); go('faktura'); }, 'btn btn-primary btn-small')),
      listEl,
      showTurnover && turnoverCard(list, year),
      backupCard(example),
    ].filter(Boolean));
  }

  async function downloadBackup() {
    try {
      await saveFile(`cinkne-zaloha-${todayIso()}.json`, exportBackup());
    } catch (err) {
      toast(saveErrorMessage(err), err.code === 'declined' ? '' : 'error');
      return;
    }
    markBackedUp();
    trackEvent('backup_downloaded');
    render();
    toast('Záloha je stažená. Ulož si ji i mimo tohle zařízení, třeba do e-mailu nebo na cloud.');
  }

  function tile(label, value, note, kind) {
    return h('div', { class: 'tile' + (kind ? ' is-' + kind : '') },
      h('span', { class: 'tile-label' }, label),
      h('strong', { class: 'tile-value mono' }, value),
      h('span', { class: 'tile-note' }, note));
  }

  function row(inv, status, today, example) {
    const totals = invoiceTotals(inv);
    const lateDays = daysBetween(inv.due, today) || 0;
    const sent = Array.isArray(inv.reminders) ? inv.reminders : [];
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
          ? h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => {
              inv.paidAt = null;
              persist(true);
              render();
              const fresh = [...root.querySelectorAll('.invoice-row')].find((el) => el.dataset.id === inv.id);
              if (fresh) fresh.querySelector('.row-actions button')?.focus();
            } }, 'Vrátit mezi nezaplacené')
          : h('button', { type: 'button', class: 'btn btn-small btn-paid', onclick: () => {
              inv.paidAt = todayIso();
              const saved = persist(true);
              render();
              const fresh = [...root.querySelectorAll('.invoice-row')].find((el) => el.dataset.id === inv.id);
              if (fresh) {
                fresh.classList.add('just-paid');
                const next = fresh.querySelector('.row-actions button');
                if (next) next.focus();
              }
              if (saved) {
                trackEvent('invoice_paid');
                chime();
                toast(`Cink! ${formatMoney(totals.total, inv.currency)} je doma.`);
              } else {
                toast('Označeno, ale prohlížeč změnu neuložil. Po zavření stránky zmizí.', 'error');
              }
            } }, 'Označit jako zaplacenou'),
        status !== 'paid' && h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => go('upominky', { invoiceId: inv.id }) }, 'Upomínka'),
        pdfBtn,
        draftAction('Upravit', () => { editInvoice(inv); go('faktura'); }),
        draftAction('Kopie', () => { duplicateAsDraft(inv); go('faktura'); }),
        confirmButton('Smazat', 'Opravdu smazat?', () => {
          deleteInvoice(inv.id);
          render();
          (root.querySelector('.invoice-row .row-actions button') || root.querySelector('.list-head .btn'))?.focus();
        }),
      ];
      actions.append(...buttons.filter(Boolean));
    }
    li.dataset.id = inv.id;
    li.append(
      h('div', { class: 'row-main' },
        h('div', { class: 'row-who' }, h('strong', null, inv.client?.name || 'Bez odběratele'), h('span', { class: 'mono row-number' }, inv.number),
          dupes.has(String(inv.number).trim().toLowerCase()) && h('span', { class: 'row-dupe' }, 'Stejné číslo má víc faktur. Jednu přečísluj.')),
        h('div', { class: 'row-amount mono' }, formatMoney(totals.total, inv.currency)),
        h('div', { class: 'row-status' }, pill, h('span', { class: 'row-due' }, `splatnost ${formatDate(inv.due)}`),
          status !== 'paid' && sent.length > 0 && h('span', { class: 'row-due' }, `upomenuto ${sent.length}×, naposledy ${formatDate(sent[sent.length - 1].date)}`)),
        h('span', { class: 'stamp', 'aria-hidden': 'true' }, 'Zaplaceno')
      ),
      actions
    );
    return li;
  }

  function turnoverCard(list, year) {
    const { cents, foreign } = yearTurnover(list, year);
    const amount = cents / 100;
    const share = Math.min(amount / VAT_LIMIT, 1);
    const state2 = amount > VAT_LIMIT_IMMEDIATE ? 'danger' : amount > VAT_LIMIT ? 'danger' : share > 0.8 ? 'warn' : '';
    const message = amount > VAT_LIMIT_IMMEDIATE
      ? 'Obrat přesáhl 2 536 500 Kč. Plátcem DPH se stáváš už ode dne následujícího po překročení. Ozvi se hned účetní.'
      : amount > VAT_LIMIT
        ? 'Obrat přesáhl 2 000 000 Kč. Od 1. ledna budeš plátcem DPH a přihlášku k registraci je potřeba podat do 10 pracovních dnů od překročení.'
        : share > 0.8
          ? `Do limitu zbývá ${formatWhole(VAT_LIMIT - amount)}. Je čas probrat to s účetní.`
          : `Do limitu zbývá ${formatWhole(VAT_LIMIT - amount)}.`;
    return h('section', { class: 'card turnover' + (state2 ? ' is-' + state2 : '') },
      h('h2', null, `Hlídač limitu pro DPH ${year}`),
      h('p', { class: 'turnover-figure' }, h('strong', { class: 'mono' }, formatWhole(amount)), ' z ', h('span', { class: 'mono' }, formatWhole(VAT_LIMIT))),
      h('div', { class: 'meter', role: 'img', 'aria-label': `Obrat je na ${Math.round(share * 100)} % limitu` }, h('span', { style: `width:${(share * 100).toFixed(1)}%` })),
      h('p', null, message),
      h('p', { class: 'fine' },
        'Když obrat v Česku za kalendářní rok přesáhne 2 000 000 Kč, staneš se plátcem DPH od 1. ledna následujícího roku. Přesáhne-li v témže roce 2 536 500 Kč, jsi plátcem už ode dne následujícího po překročení. ',
        'Počítáme faktury v korunách podle data plnění, i ty nezaplacené.',
        foreign ? ` Faktury v eurech (${foreign}) započtené nejsou.` : '',
        ' Je to orientační hlídač, obrat si potvrď s účetní.')
    );
  }

  function backupCard(example) {
    const pro = isPro();
    const confirmBox = h('div', { class: 'notice' });
    confirmBox.hidden = true;
    const fileInput = h('input', { type: 'file', id: 'backup-file', accept: 'application/json,.json', class: 'visually-hidden', onchange: (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          pendingBackup = inspectBackup(String(reader.result));
        } catch (err) {
          toast(err.message, 'error');
          return;
        }
        const current = state.invoices.length;
        confirmBox.replaceChildren(
          h('p', null, h('strong', null, `Záloha obsahuje ${pendingBackup.count} ${plural(pendingBackup.count, 'fakturu', 'faktury', 'faktur')}.`),
            current ? ` Nahradí ${current} ${plural(current, 'fakturu', 'faktury', 'faktur')}, které tu máš teď.` : ' Načtením se přepíše rozepsaná faktura a nastavení.',
            pendingBackup.duplicates.length > 0 && h('span', { class: 'warn-text' }, ` Pozor, v záloze má víc faktur stejné číslo: ${pendingBackup.duplicates.slice(0, 5).join(', ')}. Po načtení je přečísluj.`)),
          h('div', { class: 'notice-actions' },
            h('button', { type: 'button', class: 'btn btn-small', id: 'backup-apply', onclick: () => {
              const ok = applyBackup(pendingBackup.data);
              trackEvent('backup_restored');
              const count = pendingBackup.count;
              pendingBackup = null;
              render();
              toast(ok ? `Záloha načtena, faktur: ${count}.` : 'Záloha je načtená, ale prohlížeč ji neuložil. Po zavření stránky zmizí.', ok ? '' : 'error');
            } }, 'Načíst a nahradit'),
            h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => { pendingBackup = null; confirmBox.hidden = true; } }, 'Zrušit')));
        confirmBox.hidden = false;
      };
      reader.readAsText(file);
      e.target.value = '';
    } });
    const save = async (name, data) => {
      try {
        await saveFile(name, data);
      } catch (err) {
        toast(saveErrorMessage(err), err.code === 'declined' ? '' : 'error');
      }
    };
    const empty = example || !state.invoices.length;
    const fresh = empty ? 0 : unbackedInvoices().count;
    const lastBackup = state.lastBackupAt ? formatDate(todayIso(new Date(state.lastBackupAt))) : '';
    const backupStatus = empty ? '' : lastBackup
      ? `Poslední záloha: ${lastBackup}.${fresh ? ` Od té doby ${plural(fresh, 'přibyla', 'přibyly', 'přibylo')} ${fresh} ${plural(fresh, 'faktura', 'faktury', 'faktur')}.` : ' Všechny faktury v ní jsou.'}`
      : 'Zálohu jsi zatím nestáhl(a).';
    return h('section', { class: 'card backup' },
      h('h2', null, 'Záloha a export'),
      h('p', null, 'Faktury jsou uložené jen v tomhle prohlížeči. Přijdeš o ně, když si vymažeš data prohlížeče nebo vyměníš zařízení, a některé prohlížeče (hlavně Safari) mažou data stránek, na které delší dobu nepřijdeš, samy. Zálohu si proto stahuj pravidelně a na jiném zařízení ji zase načti. Vystavená PDF si archivuj, doklady je potřeba uchovávat roky.'),
      backupStatus && h('p', { class: 'backup-status' + (fresh || !lastBackup ? ' warn-text' : '') }, backupStatus),
      h('div', { class: 'actions-row' },
        h('button', { type: 'button', class: 'btn', disabled: empty, onclick: downloadBackup }, 'Stáhnout zálohu'),
        h('label', { class: 'btn', for: 'backup-file' }, 'Načíst zálohu', fileInput),
        h('button', { type: 'button', class: 'btn', disabled: empty || !pro, onclick: () => { trackEvent('csv_exported'); save(`cinkne-faktury-${todayIso()}.csv`, invoicesCsv(state.invoices)); } }, 'Export CSV pro účetní'),
        !pro && h('a', { class: 'pro-tag', href: '#pro' }, 'Pro')
      ),
      confirmBox
    );
  }

  render();
  return { el: root, refresh: render };
}
