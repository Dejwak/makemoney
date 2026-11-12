// Editor faktury s živým náhledem.

import { h, field, toast, confirmButton } from '../ui.js';
import {
  state, persist, touchDraft, saveDraftAsInvoice, startNewDraft, clearExample, emptyItem, storedDraftInvoice,
} from '../lib/store.js';
import {
  VAT_RATES, addDays, daysBetween, formatMoney, invoiceTotals, isAmount, isIsoDate, isValidIco, num, toVs,
} from '../lib/calc.js';
import { invoicePayment } from '../lib/payment.js';
import { layoutInvoice, DEFAULT_ACCENT } from '../lib/layout.js';
import { pageToSvg, canvasMeasure } from '../lib/render-svg.js';
import { invoicePdf } from '../lib/render-pdf.js';
import { saveFile, safeFilename, saveErrorMessage } from '../lib/save.js';
import { isPro } from '../lib/pro.js';

/** Volby rozvržení společné pro náhled i PDF. Logo a barva patří k profilu. */
export function layoutOptions(invoice) {
  const pro = isPro();
  return {
    payment: invoicePayment(invoice),
    branding: !pro,
    logo: pro ? state.profile.logo : null,
    accent: pro && /^#[0-9a-f]{6}$/i.test(state.profile.color || '') ? state.profile.color : DEFAULT_ACCENT,
  };
}

/** Stáhne PDF dané faktury; chyby hlásí oznámením. */
export async function downloadInvoicePdf(invoice, button) {
  const original = button ? button.textContent : '';
  if (button) {
    button.disabled = true;
    button.textContent = 'Připravuji PDF…';
  }
  try {
    const { bytes, missing } = await invoicePdf(invoice, layoutOptions(invoice));
    await saveFile(safeFilename(`faktura-${invoice.number}.pdf`) || 'faktura.pdf', bytes);
    if (missing.length) toast(`PDF je stažené, ale tyhle znaky písmo neumí a budou v něm chybět: ${missing.slice(0, 12).join(' ')}`, 'error');
    else toast('PDF je stažené.');
    return true;
  } catch (err) {
    if (err && err.code) toast(saveErrorMessage(err), err.code === 'declined' ? '' : 'error');
    else toast('PDF se nepodařilo vytvořit. Zkus to prosím znovu.', 'error');
    return false;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

/** Co brání uložení (problems) a na co je dobré upozornit (warnings). */
export function validateInvoice(draft, otherInvoices = []) {
  const problems = [];
  const warnings = [];
  const s = draft.supplier;
  const totals = invoiceTotals(draft);
  if (!String(draft.number).trim()) problems.push('Doplň číslo faktury.');
  else if (otherInvoices.some((inv) => inv.id !== draft.id && inv.number === String(draft.number).trim())) {
    problems.push(`Číslo ${draft.number} už má jiná faktura. Každá faktura potřebuje vlastní číslo.`);
  }
  if (!String(s.name).trim()) problems.push('Doplň své jméno nebo název firmy.');
  if (!String(s.street).trim() || !String(s.city).trim()) problems.push('Doplň svou adresu (sídlo podnikání).');
  if (!String(draft.client.name).trim()) problems.push('Doplň odběratele.');
  if (!isIsoDate(draft.issued) || !isIsoDate(draft.due)) problems.push('Zkontroluj datum vystavení a splatnosti.');
  else if (draft.due < draft.issued) problems.push('Datum splatnosti je dřív než datum vystavení.');
  if (draft.duzp && !isIsoDate(draft.duzp)) problems.push('Zkontroluj datum plnění.');
  draft.items.forEach((item, i) => {
    if (!isAmount(item.qty)) problems.push(`Položka ${i + 1}: množství není číslo.`);
    if (!isAmount(item.price)) problems.push(`Položka ${i + 1}: ceně nerozumím. Piš ji třeba jako 1 250,50.`);
  });
  if (totals.total <= 0) problems.push('Přidej aspoň jednu položku s cenou.');
  if (totals.total > 99999999999) problems.push('Částka je příliš vysoká. Zkontroluj množství a ceny.');
  if (s.vatPayer) {
    if (!String(s.dic).trim()) problems.push('Plátce DPH musí mít na daňovém dokladu své DIČ.');
    if (draft.currency === 'EUR' && !(num(draft.exchangeRate) > 0)) {
      problems.push('U faktury v eurech doplň kurz. DPH se na daňovém dokladu uvádí i v českých korunách.');
    }
    if (totals.zeroRated && !String(draft.zeroVatNote).trim()) {
      problems.push('U položek s 0 % DPH doplň důvod (například „Daň odvede zákazník.“).');
    }
  }
  if (!String(s.ico).trim()) warnings.push('Na faktuře chybí tvoje IČO. Podnikatel ho na dokladech uvádět musí.');
  else if (!isValidIco(s.ico)) warnings.push('Tvoje IČO nevypadá správně, zkontroluj ho.');
  if (draft.client.ico && !isValidIco(draft.client.ico)) warnings.push('IČO odběratele nevypadá správně, zkontroluj ho.');
  return { problems, warnings };
}

const PAYMENT_STATUS = {
  empty: ['QR kód se objeví, jakmile bude co platit.', ''],
  limit: ['Částka je na QR Platbu příliš vysoká (nejvýš 9 999 999,99 Kč). Faktura bude bez kódu.', 'warn'],
  foreign: ['QR Platba funguje jen s českým účtem. Faktura bude bez kódu.', 'warn'],
  name: ['Doplň své jméno, ať jde vytvořit SEPA QR.', 'warn'],
  spayd: ['QR Platba je na faktuře. Odběratel zaplatí namířením telefonu.', 'ok'],
  epc: ['Na faktuře je SEPA QR pro platbu v eurech. Přečtou ho bankovní aplikace v eurozóně.', 'ok'],
};

export function invoiceView({ onTotals }) {
  const draft = () => state.draft;
  let previewQueued = false;
  let recheck = () => {};

  const previewPages = h('div', { class: 'preview-pages' });
  const previewStatus = h('p', { class: 'preview-status', role: 'status' });
  const totalOut = h('output', { class: 'total-amount mono', id: 'inv-total' });

  function renderPreview() {
    previewQueued = false;
    const d = draft();
    const opts = layoutOptions(d);
    const { pages, width, height } = layoutInvoice(d, { ...opts, measure: canvasMeasure });
    previewPages.innerHTML = pages
      .map((ops, i) => `<div class="sheet">${pageToSvg(ops, width, height, `Náhled faktury, strana ${i + 1}`)}</div>`)
      .join('');
    const totals = invoiceTotals(d);
    totalOut.textContent = formatMoney(totals.total, d.currency);
    const p = opts.payment;
    const [text, kind] = p.reason === 'account'
      ? [String(d.supplier.account || '').trim() ? 'Číslo účtu nesedí, QR kód na faktuře nebude.' : 'Doplň číslo účtu a na faktuře přibude QR Platba.', 'warn']
      : PAYMENT_STATUS[p.kind || p.reason] || ['', ''];
    previewStatus.textContent = text;
    previewStatus.className = 'preview-status' + (kind ? ' is-' + kind : '');
    onTotals && onTotals(d, totals);
  }

  function schedulePreview() {
    if (!previewQueued) {
      previewQueued = true;
      requestAnimationFrame(renderPreview);
    }
  }

  function changed() {
    touchDraft();
    schedulePreview();
    recheck();
  }

  const root = h('div', { class: 'invoice-view' });

  function build({ focus } = {}) {
    const d = draft();
    const s = d.supplier;
    const c = d.client;
    const stored = storedDraftInvoice();
    const set = (obj, key) => (value) => {
      obj[key] = value;
      changed();
    };
    // Údaje dodavatele z nové faktury se rovnou pamatují pro další; oprava staré faktury je nemění.
    const setSupplier = (key) => (value) => {
      s[key] = value;
      if (!stored) state.profile[key] = value;
      changed();
    };

    const banner = h('div', { class: 'notice notice-example' },
      h('p', null, h('strong', null, 'Ukázková data.'), ' Přepiš je svými údaji, nebo začni s čistým formulářem. Faktury zůstávají v tomhle prohlížeči, nikam je neposíláme.'),
      h('div', { class: 'notice-actions' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => { clearExample(); build({ focus: 'sup-name' }); renderPreview(); } }, 'Začít s prázdnou fakturou'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => { state.demo = false; persist(); banner.remove(); } }, 'Skrýt')
      )
    );
    banner.hidden = !state.demo;

    const editing = h('div', { class: 'notice' },
      h('p', null, h('strong', null, `Upravuješ uloženou fakturu ${stored ? stored.number : ''}.`),
        ' Pokud už ji odběratel dostal, opravuj ji raději opravným dokladem než přepisem.'));
    editing.hidden = !stored;

    // -- údaje faktury
    const vsField = field({ id: 'inv-vs', label: 'Variabilní symbol', value: d.vs, mono: true, inputmode: 'numeric', maxlength: 10,
      oninput: (v, el) => { d.vs = toVs(v); if (el.value !== d.vs) el.value = d.vs; changed(); } });
    const numberField = field({ id: 'inv-number', label: 'Číslo faktury', value: d.number, mono: true, maxlength: 24,
      oninput: (v) => { const linked = d.vs === toVs(d.number); d.number = v.trim(); if (linked) { d.vs = toVs(d.number); vsField.input.value = d.vs; } changed(); } });
    const dueField = field({ id: 'inv-due', label: 'Splatnost', type: 'date', value: d.due, oninput: set(d, 'due') });
    const supplyLabel = () => (s.vatPayer ? 'Datum zdanitelného plnění (DUZP)' : 'Datum plnění');
    const duzpField = field({ id: 'inv-duzp', label: supplyLabel(), type: 'date', value: d.duzp || d.issued, oninput: set(d, 'duzp') });
    const issuedField = field({ id: 'inv-issued', label: 'Datum vystavení', type: 'date', value: d.issued,
      oninput: (v) => {
        // Datum plnění a splatnost se posouvají s datem vystavení, dokud je uživatel nezměnil jinak.
        const old = d.issued;
        d.issued = v;
        if (isIsoDate(old) && isIsoDate(v)) {
          if (d.duzp === old || !d.duzp) { d.duzp = v; duzpField.input.value = v; }
          const offset = daysBetween(old, d.due);
          if (Number.isFinite(offset) && offset >= 0) { d.due = addDays(v, offset); dueField.input.value = d.due; }
        }
        changed();
      } });
    const dueChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Splatnost za' },
      [7, 14, 30].map((days) => h('button', { type: 'button', class: 'chip', onclick: () => {
        if (!isIsoDate(d.issued)) {
          dueField.setHint('Nejdřív vyplň datum vystavení.', 'warn');
          return;
        }
        dueField.setHint('');
        d.due = addDays(d.issued, days);
        dueField.input.value = d.due;
        changed();
      } }, `${days} dní`))
    );
    const rateField = field({ id: 'inv-rate', label: 'Kurz (Kč za 1 EUR)', value: d.exchangeRate, mono: true, inputmode: 'decimal',
      hint: 'Kurz platný ke dni plnění. DPH se na faktuře uvede i v korunách.', oninput: set(d, 'exchangeRate') });
    const syncConditional = () => {
      rateField.hidden = !(s.vatPayer && d.currency === 'EUR');
      duzpField.querySelector('.field-label').textContent = supplyLabel();
    };
    const select = (id, value, options, onchange) => h('select', { id, onchange: (e) => onchange(e.target.value) },
      options.map(([val, label]) => h('option', { value: val, selected: value === val }, label)));
    const currency = select('inv-currency', d.currency, [['CZK', 'CZK'], ['EUR', 'EUR']], (v) => { d.currency = v; syncConditional(); changed(); });
    const language = select('inv-lang', d.lang, [['cs', 'Čeština'], ['en', 'Angličtina']], (v) => { d.lang = v; changed(); });

    const basics = h('fieldset', { class: 'card' },
      h('legend', null, 'Faktura'),
      h('div', { class: 'grid' },
        numberField, vsField, issuedField, duzpField,
        h('div', { class: 'field' }, dueField, dueChips),
        h('label', { class: 'field', for: 'inv-currency' }, h('span', { class: 'field-label' }, 'Měna'), currency),
        h('label', { class: 'field', for: 'inv-lang' }, h('span', { class: 'field-label' }, 'Jazyk faktury'), language),
        rateField
      )
    );

    // -- dodavatel
    const summaryValue = h('span', { class: 'summary-value' }, s.name || 'doplň své údaje');
    const icoHint = (value) => (value && !isValidIco(value) ? 'IČO nesedí. Má mít 8 číslic, zkontroluj překlepy.' : '');
    const icoField = field({ id: 'sup-ico', label: 'IČO', value: s.ico, mono: true, inputmode: 'numeric', maxlength: 8,
      oninput: (v) => { setSupplier('ico')(v.trim()); icoField.setHint(icoHint(s.ico), 'warn'); } });
    const accountHint = () => {
      const p = invoicePayment(d);
      return String(s.account).trim() && !p.ok ? p.error : '';
    };
    const accountField = field({ id: 'sup-account', label: 'Číslo účtu nebo IBAN', value: s.account, mono: true, placeholder: '2000145399/0800', wide: true, maxlength: 40,
      oninput: (v) => { setSupplier('account')(v); accountField.setHint(accountHint(), 'warn'); } });
    const dicField = field({ id: 'sup-dic', label: 'DIČ', value: s.dic, mono: true, maxlength: 16, oninput: setSupplier('dic') });
    const vatPayer = h('input', { type: 'checkbox', id: 'sup-vat', checked: s.vatPayer, onchange: (e) => {
      s.vatPayer = e.target.checked;
      if (!stored) state.profile.vatPayer = s.vatPayer;
      syncConditional();
      buildItems();
      changed();
    } });

    const pro = isPro();
    const logoText = () => (state.profile.logo ? 'Logo je nahrané.' : 'PNG nebo JPG, zobrazí se v záhlaví.');
    const logoInfo = h('span', { class: 'field-hint' }, logoText());
    const logoInput = h('input', { type: 'file', id: 'sup-logo', accept: 'image/png,image/jpeg', disabled: !pro, onchange: (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      readLogo(file).then((logo) => {
        state.profile.logo = logo;
        logoInfo.textContent = logoText();
        removeLogo.hidden = false;
        persist();
        schedulePreview();
      }).catch(() => toast('Obrázek se nepodařilo načíst. Zkus PNG nebo JPG.', 'error'));
    } });
    const removeLogo = h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => {
      state.profile.logo = null;
      logoInput.value = '';
      logoInfo.textContent = logoText();
      removeLogo.hidden = true;
      persist();
      schedulePreview();
    } }, 'Odebrat logo');
    removeLogo.hidden = !state.profile.logo;
    const colorInput = h('input', { type: 'color', id: 'sup-color', value: state.profile.color || DEFAULT_ACCENT, disabled: !pro,
      oninput: (e) => { state.profile.color = e.target.value; persist(); schedulePreview(); } });

    const supplier = h('details', { class: 'card', open: state.demo || !s.name || !s.street },
      h('summary', null, h('span', { class: 'legend' }, 'Dodavatel'), summaryValue),
      h('div', { class: 'grid' },
        field({ id: 'sup-name', label: 'Jméno nebo název', value: s.name, wide: true, autocomplete: 'name', maxlength: 120,
          oninput: (v) => { setSupplier('name')(v); summaryValue.textContent = v || 'doplň své údaje'; } }),
        field({ id: 'sup-street', label: 'Ulice a číslo', value: s.street, wide: true, maxlength: 120, oninput: setSupplier('street') }),
        field({ id: 'sup-zip', label: 'PSČ', value: s.zip, mono: true, maxlength: 12, oninput: setSupplier('zip') }),
        field({ id: 'sup-city', label: 'Město', value: s.city, maxlength: 80, oninput: setSupplier('city') }),
        icoField,
        dicField,
        accountField,
        field({ id: 'sup-swift', label: 'BIC/SWIFT', value: s.swift, mono: true, maxlength: 11, placeholder: 'nepovinné',
          hint: 'Hodí se u plateb ze zahraničí.', oninput: (v) => setSupplier('swift')(v.trim().toUpperCase()) }),
        field({ id: 'sup-email', label: 'E-mail', value: s.email, type: 'email', maxlength: 80, oninput: setSupplier('email') }),
        field({ id: 'sup-phone', label: 'Telefon', value: s.phone, type: 'tel', maxlength: 24, oninput: setSupplier('phone') }),
        field({ id: 'sup-register', label: 'Zápis v rejstříku', value: s.register, wide: true, maxlength: 200,
          hint: 'Firma sem napíše svůj zápis v obchodním rejstříku včetně spisové značky.', oninput: setSupplier('register') }),
        h('label', { class: 'check field-wide', for: 'sup-vat' }, vatPayer, h('span', null, 'Jsem plátce DPH')),
        h('div', { class: 'field field-wide pro-fields' },
          h('span', { class: 'field-label' }, 'Vzhled faktury ', h('a', { class: 'pro-tag', href: '#pro' }, 'Pro')),
          h('div', { class: 'pro-row' },
            h('label', { class: 'file-label', for: 'sup-logo' }, h('span', null, 'Logo'), logoInput),
            removeLogo,
            h('label', { class: 'color-label', for: 'sup-color' }, h('span', null, 'Barva'), colorInput)
          ),
          pro ? logoInfo : h('span', { class: 'field-hint' }, 'Logo, vlastní barva a faktura bez patičky „Vystaveno zdarma v aplikaci Cinkne“ jsou ve verzi Pro.')
        )
      )
    );
    icoField.setHint(icoHint(s.ico), 'warn');
    accountField.setHint(accountHint(), 'warn');

    // -- odběratel
    const known = new Map();
    for (const inv of state.invoices) if (inv.client && inv.client.name) known.set(inv.client.name, inv.client);
    const clientFields = {};
    const cf = (key, opts) => (clientFields[key] = field({ ...opts, value: c[key], oninput: set(c, key) }));
    const clientName = field({ id: 'cli-name', label: 'Jméno nebo název', value: c.name, wide: true, list: 'known-clients', maxlength: 120,
      oninput: (v, el, e) => {
        c.name = v;
        // Doplň údaje jen při výběru z nabídky a jen do polí, která jsou ještě prázdná.
        const picked = e && (e.inputType === 'insertReplacementText' || e.inputType === undefined);
        const match = picked ? known.get(v) : null;
        if (match) {
          for (const [key, f] of Object.entries(clientFields)) {
            if (!String(c[key] || '').trim() && match[key]) {
              c[key] = match[key];
              f.input.value = match[key];
            }
          }
        }
        changed();
      } });
    const client = h('fieldset', { class: 'card' },
      h('legend', null, 'Odběratel'),
      h('div', { class: 'grid' },
        clientName,
        cf('street', { id: 'cli-street', label: 'Ulice a číslo', wide: true, maxlength: 120 }),
        cf('zip', { id: 'cli-zip', label: 'PSČ', mono: true, maxlength: 12 }),
        cf('city', { id: 'cli-city', label: 'Město', maxlength: 80 }),
        cf('ico', { id: 'cli-ico', label: 'IČO', mono: true, inputmode: 'numeric', maxlength: 8 }),
        cf('dic', { id: 'cli-dic', label: 'DIČ', mono: true, maxlength: 16, hint: 'Má-li odběratel DIČ, na daňovém dokladu být musí.' }),
        cf('email', { id: 'cli-email', label: 'E-mail pro upomínky', type: 'email', wide: true, maxlength: 80 })
      ),
      h('datalist', { id: 'known-clients' }, [...known.keys()].map((name) => h('option', { value: name })))
    );

    // -- položky
    const itemsBody = h('div', { class: 'items' });
    const zeroField = field({ id: 'inv-zero-note', label: 'Důvod nulové DPH (vytiskne se na faktuře)', value: d.zeroVatNote, wide: true, list: 'zero-vat-reasons', maxlength: 300,
      hint: 'Nulová daň vždy potřebuje důvod: přenesení daňové povinnosti nebo osvobození s odkazem na zákon.', oninput: set(d, 'zeroVatNote') });
    const syncZero = () => {
      zeroField.hidden = !(s.vatPayer && d.items.some((item) => num(item.vat) === 0));
    };
    const number = (item, key) => (value, el) => {
      item[key] = value;
      if (isAmount(value)) el.removeAttribute('aria-invalid');
      else el.setAttribute('aria-invalid', 'true');
      changed();
    };
    function buildItems(focusId) {
      itemsBody.replaceChildren(
        ...d.items.map((item, i) => {
          const n = i + 1;
          const label = (name) => (n > 1 ? `${name}, položka ${n}` : null);
          const row = h('div', { class: 'item' + (s.vatPayer ? ' has-vat' : '') },
            field({ id: `item-${n}-desc`, label: 'Popis', ariaLabel: label('Popis'), value: item.desc, maxlength: 2000, oninput: set(item, 'desc') }),
            field({ id: `item-${n}-qty`, label: 'Množství', ariaLabel: label('Množství'), value: item.qty, inputmode: 'decimal', mono: true, maxlength: 14, oninput: number(item, 'qty') }),
            field({ id: `item-${n}-unit`, label: 'Jedn.', ariaLabel: label('Jednotka'), value: item.unit, placeholder: 'ks', maxlength: 8, oninput: set(item, 'unit') }),
            field({ id: `item-${n}-price`, label: s.vatPayer ? 'Cena bez DPH' : 'Cena za jedn.', ariaLabel: label('Cena za jednotku'), value: item.price, inputmode: 'decimal', mono: true, maxlength: 16, oninput: number(item, 'price') }),
            s.vatPayer && h('label', { class: 'field', for: `item-${n}-vat` }, h('span', { class: 'field-label' }, 'DPH'),
              h('select', { id: `item-${n}-vat`, 'aria-label': label('Sazba DPH'), onchange: (e) => { item.vat = Number(e.target.value); syncZero(); changed(); } },
                VAT_RATES.map((rate) => h('option', { value: rate, selected: num(item.vat) === rate }, `${rate} %`)))),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Odebrat položku ${n}`, title: 'Odebrat položku', disabled: d.items.length === 1,
              onclick: () => {
                d.items.splice(i, 1);
                buildItems(`item-${Math.max(i, 1)}-desc`);
                changed();
              } }, '×')
          );
          for (const key of ['qty', 'price']) {
            if (!isAmount(item[key])) row.querySelector(`#item-${n}-${key}`).setAttribute('aria-invalid', 'true');
          }
          return row;
        })
      );
      syncZero();
      if (focusId) {
        const target = itemsBody.querySelector('#' + focusId);
        if (target) target.focus();
      }
    }
    buildItems();
    const items = h('fieldset', { class: 'card' },
      h('legend', null, 'Položky'),
      itemsBody,
      h('div', { class: 'items-foot' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => {
          d.items.push(emptyItem(d.items.length ? num(d.items[d.items.length - 1].vat) : 21));
          buildItems(`item-${d.items.length}-desc`);
          changed();
        } }, '+ Přidat položku'),
        h('div', { class: 'total' }, h('span', { class: 'total-label' }, 'Celkem k úhradě'), totalOut)
      ),
      zeroField,
      h('datalist', { id: 'zero-vat-reasons' }, ['Daň odvede zákazník.', 'Osvobozeno od daně.', 'Reverse charge: VAT to be accounted for by the customer.'].map((v) => h('option', { value: v }))),
      field({ id: 'inv-note', label: 'Poznámka na faktuře', value: d.note, textarea: true, rows: 2, wide: true, maxlength: 4000, oninput: set(d, 'note') })
    );

    // -- akce
    const problemsBox = h('div', { class: 'problems', role: 'alert' });
    const warningsBox = h('div', { class: 'warnings' });
    const choiceBox = h('div', { class: 'notice' });
    const status = h('p', { class: 'save-status', role: 'status' }, stored && !state.dirty ? `Faktura ${stored.number} je uložená v přehledu.` : '');
    problemsBox.hidden = warningsBox.hidden = choiceBox.hidden = true;
    let problemsShown = false;

    function check(scroll) {
      const { problems, warnings } = validateInvoice(d, state.invoices);
      problemsBox.replaceChildren(...problems.map((p) => h('p', null, p)));
      problemsBox.hidden = !problems.length;
      warningsBox.replaceChildren(...warnings.map((w) => h('p', null, w)));
      warningsBox.hidden = !warnings.length;
      problemsShown = problems.length > 0;
      if (problems.length && scroll) problemsBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return !problems.length;
    }
    // Jakmile hlášky jednou svítí, mizí průběžně s opravami; neuložené změny jsou vidět ve stavu.
    recheck = () => {
      if (problemsShown) check(false);
      choiceBox.hidden = true;
      if (status.textContent && !status.classList.contains('is-error')) status.textContent = storedDraftInvoice() ? 'Máš neuložené změny.' : '';
    };

    async function save({ pdf, asNew = false, button }) {
      if (!check(true)) return;
      const current = storedDraftInvoice();
      if (current && current.number !== d.number && !asNew && button !== 'renumber') {
        // Otevřená faktura s jiným číslem: nová faktura, nebo oprava čísla té staré?
        choiceBox.replaceChildren(
          h('p', null, h('strong', null, `Změnil(a) jsi číslo z ${current.number} na ${d.number}.`), ' Má vzniknout nová faktura, nebo se má přečíslovat ta původní?'),
          h('div', { class: 'notice-actions' },
            h('button', { type: 'button', class: 'btn btn-small', onclick: () => save({ pdf, asNew: true }) }, `Uložit jako novou fakturu ${d.number}`),
            h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => save({ pdf, button: 'renumber' }) }, `Přečíslovat fakturu ${current.number}`)));
        choiceBox.hidden = false;
        choiceBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      choiceBox.hidden = true;
      const result = saveDraftAsInvoice({ asNew });
      editing.hidden = false;
      editing.querySelector('strong').textContent = `Upravuješ uloženou fakturu ${result.invoice.number}.`;
      if (result.ok) {
        status.classList.remove('is-error');
        status.textContent = `Faktura ${result.invoice.number} je uložená v přehledu.`;
        if (!pdf) toast('Uloženo do přehledu.');
      } else {
        status.classList.add('is-error');
        status.textContent = 'Fakturu se nepodařilo uložit do prohlížeče (anonymní okno nebo plné úložiště). Stáhni si PDF hned, po zavření stránky o ni přijdeš.';
      }
      buttonDirty = state.dirty;
      drawNewButton();
      if (pdf) await downloadInvoicePdf(result.invoice, saveAndPdf);
    }

    const saveAndPdf = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => save({ pdf: true }) }, 'Uložit a stáhnout PDF');
    const fresh = () => {
      startNewDraft();
      build({ focus: 'cli-name' });
      renderPreview();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const newButton = h('span', { class: 'new-invoice' });
    function drawNewButton() {
      newButton.replaceChildren(state.dirty
        ? confirmButton('Nová faktura', 'Zahodit rozepsané a začít novou?', fresh, 'btn btn-ghost')
        : h('button', { type: 'button', class: 'btn btn-ghost', onclick: fresh }, 'Nová faktura'));
    }
    drawNewButton();
    const baseRecheck = recheck;
    let buttonDirty = state.dirty;
    recheck = () => {
      baseRecheck();
      if (buttonDirty !== state.dirty) {
        buttonDirty = state.dirty;
        drawNewButton();
      }
    };

    const actions = h('div', { class: 'actions' },
      problemsBox, warningsBox, choiceBox,
      h('div', { class: 'actions-row' },
        saveAndPdf,
        h('button', { type: 'button', class: 'btn', onclick: () => save({ pdf: false }) }, 'Jen uložit'),
        newButton
      ),
      status
    );

    const form = h('form', { class: 'invoice-form', novalidate: true, onsubmit: (e) => e.preventDefault() },
      banner, editing, basics, supplier, client, items, actions);
    const preview = h('aside', { class: 'preview', 'aria-label': 'Náhled faktury' },
      h('div', { class: 'preview-head' }, h('h2', null, 'Náhled'), previewStatus),
      previewPages
    );
    syncConditional();
    root.replaceChildren(form, preview);
    if (focus) {
      const target = root.querySelector('#' + focus);
      if (target) target.focus({ preventScroll: true });
    }
  }

  build();
  renderPreview();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderPreview);

  return { el: root, refresh: () => { build(); renderPreview(); }, redraw: renderPreview };
}

/** Zmenší logo a vrátí { data, w, h } jako PNG data URL. */
function readLogo(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(450 / img.width, 180 / img.height, 1);
        const w = Math.max(Math.round(img.width * scale), 1);
        const hh = Math.max(Math.round(img.height * scale), 1);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = hh;
        canvas.getContext('2d').drawImage(img, 0, 0, w, hh);
        resolve({ data: canvas.toDataURL('image/png'), w, h: hh });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
