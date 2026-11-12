import { h, toast, confirmButton } from './ui.js';
import { formatDate } from './lib/calc.js';
import { onStorageFailure, onExternalChange, storageWorks, exportBackup, resetAll } from './lib/store.js';
import { saveFile, saveErrorMessage } from './lib/save.js';
import { invoiceView } from './views/invoice.js';
import { overviewView } from './views/overview.js';
import { remindersView } from './views/reminders.js';
import { qrView, decodeRequest } from './views/qr.js';
import { rateView } from './views/rate.js';
import { proView } from './views/pro.js';

const TITLES = {
  faktura: 'Cinkne',
  prehled: 'Přehled – Cinkne',
  upominky: 'Upomínky – Cinkne',
  qr: 'QR Platba – Cinkne',
  hodinovka: 'Hodinovka – Cinkne',
  pro: 'Cinkne Pro',
};

const app = document.getElementById('app');
const hero = document.getElementById('hero');
const navLinks = [...document.querySelectorAll('[data-route]')];

const views = {};
let pendingParams = null;
let shownKey = null;

function comb(el, text) {
  el.replaceChildren(...[...text].map((ch) => h('span', { class: /\d/.test(ch) ? 'comb-cell' : 'comb-gap' }, ch)));
  el.setAttribute('aria-label', text);
}

function updateSlip(draft, totals) {
  const abs = Math.abs(totals.total);
  const whole = Math.floor(abs / 100).toLocaleString('cs-CZ').replace(/[\u00a0\u202f]/g, ' ');
  const cents = String(abs % 100).padStart(2, '0');
  comb(document.getElementById('slip-amount'), `${totals.total < 0 ? '-' : ''}${whole},${cents}`);
  comb(document.getElementById('slip-vs'), draft.vs || '–');
  document.getElementById('slip-currency').textContent = draft.currency === 'EUR' ? 'EUR' : 'Kč';
  document.getElementById('slip-due').textContent = formatDate(draft.due) || '–';
}

function create(name) {
  switch (name) {
    case 'faktura': return invoiceView({ onTotals: updateSlip });
    case 'prehled': return overviewView({ go });
    case 'upominky': return remindersView();
    case 'qr': return qrView({ request: null });
    case 'hodinovka': return rateView();
    case 'pro': return proView();
  }
}

/** Žádost o platbu z odkazu: nově za křížkem (#p=…), u starších odkazů v dotazu (?p=…). */
function requestFromUrl() {
  const hash = location.hash.replace(/^#/, '');
  const raw = hash.startsWith('p=') ? hash.slice(2) : hash ? null : new URLSearchParams(location.search).get('p');
  return raw ? decodeRequest(raw) : null;
}

function currentRoute() {
  const name = location.hash.replace(/^#/, '');
  return name in TITLES ? name : 'faktura';
}

function show() {
  const request = requestFromUrl();
  const name = request ? 'qr' : currentRoute();
  const key = request ? 'request' : name;
  const params = pendingParams;
  pendingParams = null;
  try {
    if (request) {
      views.request = qrView({ request });
    } else if (!views[key]) {
      views[key] = create(key);
      if (params) views[key].refresh(params);
    } else {
      views[key].refresh(params);
    }
    app.replaceChildren(views[key].el);
  } catch (err) {
    console.error(err);
    delete views[key];
    app.replaceChildren(crashCard());
  }
  hero.hidden = key !== 'faktura';
  for (const link of navLinks) {
    if (link.dataset.route === name) {
      link.setAttribute('aria-current', 'page');
      const nav = link.parentElement;
      if (nav.scrollWidth > nav.clientWidth) nav.scrollLeft = link.offsetLeft - nav.offsetLeft - 16;
    } else {
      link.removeAttribute('aria-current');
    }
  }
  document.title = request ? 'Žádost o platbu – Cinkne' : TITLES[name];
  if (shownKey !== null && shownKey !== key) window.scrollTo(0, 0);
  shownKey = key;
}

/** Přejde na obrazovku; params dostane její refresh(). */
function go(name, params) {
  pendingParams = params || null;
  if (location.hash.replace(/^#/, '') === name) show();
  else location.hash = name;
}

/** Když se obrazovka nedá vykreslit (poškozená data), nabídni záchranu místo prázdné stránky. */
function crashCard() {
  return h('div', { class: 'card empty-card' },
    h('h1', null, 'Tuhle obrazovku se nepodařilo zobrazit'),
    h('p', null, 'Uložená data jsou nejspíš poškozená. Stáhni si jejich zálohu a začni s čistými daty; zálohu pak můžeš zkusit načíst v Přehledu.'),
    h('div', { class: 'actions-row' },
      h('button', { type: 'button', class: 'btn', onclick: async () => {
        try {
          await saveFile('cinkne-zaloha.json', exportBackup());
        } catch (err) {
          toast(saveErrorMessage(err), 'error');
        }
      } }, 'Stáhnout zálohu dat'),
      confirmButton('Začít s čistými daty', 'Opravdu smazat všechna data?', () => {
        resetAll();
        location.hash = '';
        location.reload();
      }, 'btn')));
}

// Když prohlížeč nenačte písma ze stylu, zkusíme je přidat ze souborů ručně.
async function ensureFonts() {
  if (!document.fonts || !window.FontFace) return;
  const faces = [
    ['IBM Plex Sans', '400', 'PlexSans-Regular.ttf'],
    ['IBM Plex Sans', '600', 'PlexSans-SemiBold.ttf'],
    ['JetBrains Mono', '400', 'JetBrainsMono-Regular.ttf'],
    ['JetBrains Mono', '600', 'JetBrainsMono-SemiBold.ttf'],
    ['Bricolage Grotesque', '800', 'Bricolage-ExtraBold.ttf'],
  ];
  let added = false;
  for (const [family, weight, file] of faces) {
    const spec = `${weight} 16px "${family}"`;
    try {
      await document.fonts.load(spec).catch(() => {});
      const loaded = [...document.fonts].some(
        (f) => f.family.replace(/["']/g, '') === family && String(f.weight) === weight && f.status === 'loaded'
      );
      if (loaded) continue;
      const res = await fetch(new URL('../fonts/' + file, import.meta.url));
      if (!res.ok) continue;
      const face = new FontFace(family, await res.arrayBuffer(), { weight });
      document.fonts.add(await face.load());
      added = true;
    } catch {
      /* zůstane náhradní písmo */
    }
  }
  if (added && views.faktura) views.faktura.redraw();
}

// ---- úložiště -----------------------------------------------------------

function storageNote() {
  if (document.getElementById('storage-note')) return;
  const note = h('div', { class: 'wrap' }, h('div', { class: 'notice is-danger', id: 'storage-note', role: 'alert' },
    h('p', null, h('strong', null, 'Tenhle prohlížeč teď data neukládá.'),
      ' Může to být anonymní okno, zakázané nebo plné úložiště. Co vytvoříš, po zavření stránky zmizí, takže si faktury hned stahuj jako PDF a zálohu si ulož v Přehledu.')));
  app.before(note);
}
onStorageFailure(storageNote);
if (!storageWorks()) storageNote();

// Jiná záložka uložila data: překresli, až tu uživatel zrovna nepíše.
let stale = false;
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
onExternalChange(() => {
  if (typing() && !document.hidden) stale = true;
  else show();
});
document.addEventListener('focusout', () => {
  if (!stale) return;
  setTimeout(() => {
    if (stale && !typing()) {
      stale = false;
      show();
    }
  }, 0);
});

window.addEventListener('hashchange', show);
show();
ensureFonts();
