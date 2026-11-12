// Editor faktury s živým náhledem.

import { h, field, toast, confirmButton } from '../ui.js';
import { state, persist, saveDraftAsInvoice, startNewDraft, clearExample, emptyItem } from '../lib/store.js';
import { VAT_RATES, addDays, formatMoney, invoiceTotals, isIsoDate, isValidIco, num, toVs } from '../lib/calc.js';
import { invoicePayment } from '../lib/payment.js';
import { layoutInvoice, DEFAULT_ACCENT } from '../lib/layout.js';
import { pageToSvg, canvasMeasure } from '../lib/render-svg.js';
import { invoicePdf } from '../lib/render-pdf.js';
import { saveFile, safeFilename } from '../lib/save.js';
import { isPro } from '../lib/pro.js';

/** Volby rozvržení společné pro náhled i PDF. */
export function layoutOptions(invoice) {
  const pro = isPro();
  const supplier = invoice.supplier || {};
  return {
    payment: invoicePayment(invoice),
    branding: !pro,
    logo: pro && supplier.logo ? supplier.logo : null,
    accent: pro && /^#[0-9a-f]{6}$/i.test(supplier.color || '') ? supplier.color : DEFAULT_ACCENT,
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
    if (missing.length) toast(`PDF je hotové, ale tyhle znaky písmo neumí a budou v něm chybět: ${missing.slice(0, 12).join(' ')}`, 'error');
    else toast('PDF je připravené.');
    return true;
  } catch (err) {
    if (err && err.code === 'declined') toast('Uložení zrušeno.');
    else if (err && err.code === 'unavailable') toast('Stahování tady není dostupné. Otevři Cinkne v běžném prohlížeči.', 'error');
    else toast('PDF se nepodařilo vyrobit. Zkus to prosím znovu.', 'error');
    return false;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

function validate(draft) {
  const problems = [];
  if (!String(draft.number).trim()) problems.push('Doplň číslo faktury.');
  if (!String(draft.supplier.name).trim()) problems.push('Doplň své jméno nebo název firmy.');
  if (!String(draft.client.name).trim()) problems.push('Doplň odběratele.');
  if (!isIsoDate(draft.issued) || !isIsoDate(draft.due)) problems.push('Zkontroluj datum vystavení a splatnosti.');
  else if (draft.due < draft.issued) problems.push('Splatnost je dřív než datum vystavení.');
  const total = invoiceTotals(draft).total;
  if (total <= 0) problems.push('Přidej aspoň jednu položku s cenou.');
  if (total > 99999999999) problems.push('Částka je příliš vysoká. Zkontroluj množství a ceny.');
  return problems;
}

export function invoiceView({ onTotals }) {
  const draft = () => state.draft;
  let previewQueued = false;

  const previewPages = h('div', { class: 'preview-pages' });
  const previewStatus = h('p', { class: 'preview-status' });
  const totalOut = h('output', { class: 'total-amount mono', id: 'inv-total' });
  const problemsBox = h('div', { class: 'problems', role: 'alert' });
  problemsBox.hidden = true;

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
    if (!opts.payment.ok) {
      previewStatus.textContent = String(d.supplier.account || '').trim()
        ? 'Číslo účtu nesedí, QR kód na faktuře nebude.'
        : 'Doplň číslo účtu a na faktuře přibude QR Platba.';
      previewStatus.className = 'preview-status is-warn';
    } else if (!opts.payment.matrix) {
      previewStatus.textContent = 'QR Platba se objeví, jakmile bude co platit.';
      previewStatus.className = 'preview-status';
    } else {
      previewStatus.textContent = 'QR Platba je na faktuře. Odběratel ji zaplatí namířením telefonu.';
      previewStatus.className = 'preview-status is-ok';
    }
    onTotals && onTotals(d, totals);
  }

  function changed() {
    persist();
    if (!previewQueued) {
      previewQueued = true;
      requestAnimationFrame(renderPreview);
    }
  }

  const set = (obj, key) => (value) => {
    obj[key] = value;
    changed();
  };

  // ---- formulář --------------------------------------------------------
  const root = h('div', { class: 'invoice-view' });

  function build() {
    const d = draft();
    const s = d.supplier;
    const c = d.client;

    const banner = h('div', { class: 'notice notice-example' },
      h('p', null, h('strong', null, 'Ukázková data.'), ' Přepiš je svými údaji, nebo začni s čistým formulářem. Nic se nikam neodesílá, všechno zůstává v tomhle prohlížeči.'),
      h('div', { class: 'notice-actions' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => { clearExample(); build(); renderPreview(); } }, 'Začít s prázdnou fakturou'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => { state.demo = false; persist(); banner.remove(); } }, 'Skrýt')
      )
    );
    banner.hidden = !state.demo;

    // -- údaje faktury
    const vsField = field({ id: 'inv-vs', label: 'Variabilní symbol', value: d.vs, mono: true, inputmode: 'numeric', maxlength: 10,
      oninput: (v, el) => { d.vs = toVs(v); if (el.value !== d.vs) el.value = d.vs; changed(); } });
    const numberField = field({ id: 'inv-number', label: 'Číslo faktury', value: d.number, mono: true,
      oninput: (v) => { const linked = d.vs === toVs(d.number); d.number = v.trim(); if (linked) { d.vs = toVs(d.number); vsField.input.value = d.vs; } changed(); } });
    const dueField = field({ id: 'inv-due', label: 'Splatnost', type: 'date', value: d.due, oninput: set(d, 'due') });
    const issuedField = field({ id: 'inv-issued', label: 'Datum vystavení', type: 'date', value: d.issued,
      oninput: (v) => { d.issued = v; changed(); } });
    const duzpField = field({ id: 'inv-duzp', label: 'Datum zdan. plnění', type: 'date', value: d.duzp || d.issued, oninput: set(d, 'duzp') });
    duzpField.hidden = !s.vatPayer;
    const dueChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Splatnost za' },
      [7, 14, 30].map((days) => h('button', { type: 'button', class: 'chip', onclick: () => {
        if (!isIsoDate(d.issued)) return;
        d.due = addDays(d.issued, days);
        dueField.input.value = d.due;
        changed();
      } }, `${days} dní`))
    );
    const currency = h('select', { id: 'inv-currency', onchange: (e) => { d.currency = e.target.value; changed(); } },
      ['CZK', 'EUR'].map((cur) => h('option', { value: cur, selected: d.currency === cur }, cur)));

    const basics = h('fieldset', { class: 'card' },
      h('legend', null, 'Faktura'),
      h('div', { class: 'grid' },
        numberField, vsField, issuedField, duzpField,
        h('div', { class: 'field' }, dueField, dueChips),
        h('label', { class: 'field', for: 'inv-currency' }, h('span', { class: 'field-label' }, 'Měna'), currency)
      )
    );

    // -- dodavatel
    const icoField = field({ id: 'sup-ico', label: 'IČO', value: s.ico, mono: true, inputmode: 'numeric', maxlength: 8,
      oninput: (v) => { s.ico = v.trim(); icoField.setHint(s.ico && !isValidIco(s.ico) ? 'IČO má mít 8 číslic a tohle nesedí.' : '', 'warn'); changed(); } });
    const accountField = field({ id: 'sup-account', label: 'Číslo účtu nebo IBAN', value: s.account, mono: true, placeholder: '19-2000145399/0800', wide: true,
      oninput: (v) => { s.account = v; const p = invoicePayment(d); accountField.setHint(v.trim() && !p.ok ? p.error : '', 'warn'); changed(); } });
    const vatPayer = h('input', { type: 'checkbox', id: 'sup-vat', checked: s.vatPayer, onchange: (e) => {
      s.vatPayer = e.target.checked;
      duzpField.hidden = !s.vatPayer;
      buildItems();
      changed();
    } });

    const pro = isPro();
    const logoInfo = h('span', { class: 'field-hint' }, s.logo ? 'Logo je nahrané.' : 'PNG nebo JPG, zobrazí se v záhlaví.');
    const logoInput = h('input', { type: 'file', id: 'sup-logo', accept: 'image/png,image/jpeg', disabled: !pro, onchange: (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      readLogo(file).then((logo) => { s.logo = logo; logoInfo.textContent = 'Logo je nahrané.'; removeLogo.hidden = false; changed(); })
        .catch(() => toast('Obrázek se nepodařilo načíst. Zkus PNG nebo JPG.', 'error'));
    } });
    const removeLogo = h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => {
      s.logo = null; logoInput.value = ''; logoInfo.textContent = 'PNG nebo JPG, zobrazí se v záhlaví.'; removeLogo.hidden = true; changed();
    } }, 'Odebrat logo');
    removeLogo.hidden = !s.logo;
    const colorInput = h('input', { type: 'color', id: 'sup-color', value: s.color || DEFAULT_ACCENT, disabled: !pro,
      oninput: (e) => { s.color = e.target.value; changed(); } });

    const supplier = h('details', { class: 'card', open: state.demo || !s.name },
      h('summary', null, h('span', { class: 'legend' }, 'Dodavatel'), h('span', { class: 'summary-value' }, s.name || 'doplň své údaje')),
      h('div', { class: 'grid' },
        field({ id: 'sup-name', label: 'Jméno nebo název', value: s.name, wide: true, autocomplete: 'name', oninput: set(s, 'name') }),
        field({ id: 'sup-street', label: 'Ulice a číslo', value: s.street, wide: true, oninput: set(s, 'street') }),
        field({ id: 'sup-zip', label: 'PSČ', value: s.zip, mono: true, oninput: set(s, 'zip') }),
        field({ id: 'sup-city', label: 'Město', value: s.city, oninput: set(s, 'city') }),
        icoField,
        field({ id: 'sup-dic', label: 'DIČ', value: s.dic, mono: true, oninput: set(s, 'dic') }),
        accountField,
        field({ id: 'sup-email', label: 'E-mail', value: s.email, type: 'email', oninput: set(s, 'email') }),
        field({ id: 'sup-phone', label: 'Telefon', value: s.phone, type: 'tel', oninput: set(s, 'phone') }),
        field({ id: 'sup-register', label: 'Zápis v rejstříku', value: s.register, wide: true, oninput: set(s, 'register') }),
        h('label', { class: 'check field-wide', for: 'sup-vat' }, vatPayer, h('span', null, 'Jsem plátce DPH')),
        h('div', { class: 'field field-wide pro-fields' },
          h('span', { class: 'field-label' }, 'Vzhled faktury ', h('a', { class: 'pro-tag', href: '#pro' }, 'Pro')),
          h('div', { class: 'pro-row' },
            h('label', { class: 'file-label', for: 'sup-logo' }, h('span', null, 'Logo'), logoInput),
            removeLogo,
            h('label', { class: 'color-label', for: 'sup-color' }, h('span', null, 'Barva'), colorInput)
          ),
          pro ? logoInfo : h('span', { class: 'field-hint' }, 'Logo, vlastní barva a faktura bez patičky Cinkne jsou ve verzi Pro.')
        )
      )
    );

    // -- odběratel
    const known = new Map();
    for (const inv of state.invoices) if (inv.client && inv.client.name) known.set(inv.client.name, inv.client);
    const clientFields = {};
    const cf = (key, opts) => (clientFields[key] = field({ ...opts, value: c[key], oninput: set(c, key) }));
    const clientName = field({ id: 'cli-name', label: 'Název nebo jméno', value: c.name, wide: true, list: 'known-clients',
      oninput: (v) => {
        c.name = v;
        const match = known.get(v);
        if (match) {
          Object.assign(c, match);
          for (const [key, f] of Object.entries(clientFields)) f.input.value = c[key] || '';
        }
        changed();
      } });
    const client = h('fieldset', { class: 'card' },
      h('legend', null, 'Odběratel'),
      h('datalist', { id: 'known-clients' }, [...known.keys()].map((name) => h('option', { value: name }))),
      h('div', { class: 'grid' },
        clientName,
        cf('street', { id: 'cli-street', label: 'Ulice a číslo', wide: true }),
        cf('zip', { id: 'cli-zip', label: 'PSČ', mono: true }),
        cf('city', { id: 'cli-city', label: 'Město' }),
        cf('ico', { id: 'cli-ico', label: 'IČO', mono: true, inputmode: 'numeric', maxlength: 8 }),
        cf('dic', { id: 'cli-dic', label: 'DIČ', mono: true }),
        cf('email', { id: 'cli-email', label: 'E-mail pro upomínky', type: 'email', wide: true })
      )
    );

    // -- položky
    const itemsBody = h('div', { class: 'items' });
    function buildItems() {
      itemsBody.replaceChildren(
        ...d.items.map((item, i) => {
          const n = i + 1;
          const row = h('div', { class: 'item' + (s.vatPayer ? ' has-vat' : '') },
            field({ id: `item-${n}-desc`, label: 'Popis', value: item.desc, oninput: set(item, 'desc') }),
            field({ id: `item-${n}-qty`, label: 'Množství', value: item.qty, inputmode: 'decimal', mono: true, oninput: set(item, 'qty') }),
            field({ id: `item-${n}-unit`, label: 'Jedn.', value: item.unit, placeholder: 'ks', oninput: set(item, 'unit') }),
            field({ id: `item-${n}-price`, label: s.vatPayer ? 'Cena bez DPH' : 'Cena za jedn.', value: item.price, inputmode: 'decimal', mono: true, oninput: set(item, 'price') }),
            s.vatPayer && h('label', { class: 'field', for: `item-${n}-vat` }, h('span', { class: 'field-label' }, 'DPH'),
              h('select', { id: `item-${n}-vat`, onchange: (e) => { item.vat = Number(e.target.value); changed(); } },
                VAT_RATES.map((rate) => h('option', { value: rate, selected: num(item.vat) === rate }, `${rate} %`)))),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Odebrat položku ${n}`, title: 'Odebrat položku', disabled: d.items.length === 1,
              onclick: () => { d.items.splice(i, 1); buildItems(); changed(); } }, '×')
          );
          return row;
        })
      );
    }
    buildItems();
    const items = h('fieldset', { class: 'card' },
      h('legend', null, 'Položky'),
      itemsBody,
      h('div', { class: 'items-foot' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => {
          d.items.push(emptyItem(d.items.length ? num(d.items[d.items.length - 1].vat) : 21));
          buildItems();
          changed();
          const last = document.getElementById(`item-${d.items.length}-desc`);
          last && last.focus();
        } }, '+ Přidat položku'),
        h('div', { class: 'total' }, h('span', { class: 'total-label' }, 'Celkem k úhradě'), totalOut)
      ),
      field({ id: 'inv-note', label: 'Poznámka na faktuře', value: d.note, textarea: true, rows: 2, wide: true, oninput: set(d, 'note') })
    );

    // -- akce
    const saveAndPdf = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
      if (!check()) return;
      const invoice = saveDraftAsInvoice();
      status.textContent = savedText();
      await downloadInvoicePdf(invoice, saveAndPdf);
    } }, 'Uložit a stáhnout PDF');
    const status = h('p', { class: 'save-status' }, d.id ? savedText() : '');
    function savedText() {
      return `Faktura ${draft().number} je uložená v přehledu.`;
    }
    function check() {
      const problems = validate(d);
      problemsBox.replaceChildren(...problems.map((p) => h('p', null, p)));
      problemsBox.hidden = !problems.length;
      if (problems.length) problemsBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return !problems.length;
    }
    const actions = h('div', { class: 'actions' },
      problemsBox,
      h('div', { class: 'actions-row' },
        saveAndPdf,
        h('button', { type: 'button', class: 'btn', onclick: () => {
          if (!check()) return;
          saveDraftAsInvoice();
          status.textContent = savedText();
          toast('Uloženo do přehledu.');
        } }, 'Jen uložit'),
        confirmButton('Nová faktura', 'Zahodit rozepsané a začít novou?', () => {
          startNewDraft();
          build();
          renderPreview();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 'btn btn-ghost')
      ),
      status
    );

    const form = h('form', { class: 'invoice-form', novalidate: true, onsubmit: (e) => e.preventDefault() },
      banner, basics, supplier, client, items, actions);
    const preview = h('aside', { class: 'preview', 'aria-label': 'Náhled faktury' },
      h('div', { class: 'preview-head' }, h('h2', null, 'Náhled'), previewStatus),
      previewPages
    );
    root.replaceChildren(form, preview);
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
        const scale = Math.min(600 / img.width, 240 / img.height, 1);
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
