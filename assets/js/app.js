import { h, toast } from './ui.js';
import { onStorageFailure } from './lib/store.js';
import { formatDate } from './lib/calc.js';
import { invoiceView } from './views/invoice.js';
import { overviewView } from './views/overview.js';
import { remindersView } from './views/reminders.js';
import { qrView, decodeRequest } from './views/qr.js';
import { rateView } from './views/rate.js';
import { proView } from './views/pro.js';

const ROUTES = ['faktura', 'prehled', 'upominky', 'qr', 'hodinovka', 'pro'];

const app = document.getElementById('app');
const hero = document.getElementById('hero');
const navLinks = [...document.querySelectorAll('[data-route]')];

// Žádost o platbu z odkazu (?p=…) otevře rovnou QR Platbu.
const requestParam = new URLSearchParams(location.search).get('p');
const request = requestParam ? decodeRequest(requestParam) : null;

const views = {};
let pendingParams = null;

function comb(el, text) {
  el.replaceChildren(...[...text].map((ch) => h('span', { class: /\d/.test(ch) ? 'comb-cell' : 'comb-gap' }, ch)));
  el.setAttribute('aria-label', text);
}

function updateSlip(draft, totals) {
  const whole = Math.floor(totals.total / 100).toLocaleString('cs-CZ').replace(/[  ]/g, ' ');
  const cents = String(totals.total % 100).padStart(2, '0');
  comb(document.getElementById('slip-amount'), `${whole},${cents}`);
  comb(document.getElementById('slip-vs'), draft.vs || '–');
  document.getElementById('slip-currency').textContent = draft.currency === 'EUR' ? 'EUR' : 'Kč';
  document.getElementById('slip-due').textContent = formatDate(draft.due) || '–';
}

function create(name) {
  switch (name) {
    case 'faktura': return invoiceView({ onTotals: updateSlip });
    case 'prehled': return overviewView({ go });
    case 'upominky': return remindersView();
    case 'qr': return qrView({ request });
    case 'hodinovka': return rateView();
    case 'pro': return proView();
  }
}

function currentRoute() {
  const name = location.hash.replace(/^#/, '');
  if (ROUTES.includes(name)) return name;
  return request ? 'qr' : 'faktura';
}

function show() {
  const name = currentRoute();
  const params = pendingParams;
  pendingParams = null;
  if (!views[name]) {
    views[name] = create(name);
    if (params) views[name].refresh(params);
  } else {
    views[name].refresh(params);
  }
  app.replaceChildren(views[name].el);
  hero.hidden = name !== 'faktura';
  for (const link of navLinks) {
    if (link.dataset.route === name) {
      link.setAttribute('aria-current', 'page');
      const nav = link.parentElement;
      if (nav.scrollWidth > nav.clientWidth) nav.scrollLeft = link.offsetLeft - nav.offsetLeft - 16;
    } else {
      link.removeAttribute('aria-current');
    }
  }
}

/** Přejde na obrazovku; params dostane její refresh(). */
function go(name, params) {
  pendingParams = params || null;
  if (currentRoute() === name) show();
  else location.hash = name;
  window.scrollTo({ top: 0 });
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

let storageWarned = false;
onStorageFailure(() => {
  if (storageWarned) return;
  storageWarned = true;
  toast('Prohlížeč teď data neukládá (anonymní okno nebo plné úložiště). Stáhni si zálohu v Přehledu.', 'error');
});

window.addEventListener('hashchange', show);
show();
ensureFonts();
