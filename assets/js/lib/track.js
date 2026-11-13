// Anonymní měření návštěv a použití přes Umami (bez cookies, bez osobních údajů).
// Vypnuté, dokud v config.js není analytics.umamiWebsiteId.
// Posílají se jen názvy obrazovek a událostí s hrubými údaji (měna, jazyk, pořadí faktury).
// Obsah faktur ani skutečná adresa stránky (může nést platební údaje) se neposílají nikdy.

import config from '../../../config.js';

const settings = config.analytics || {};
const queue = [];
let page = '/';
let started = false;

function isLocal() {
  const host = globalThis.location ? location.hostname : '';
  return !host || host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** Měří se jen na veřejném webu: ne při vývoji a ne uvnitř claude.ai. */
export function analyticsEnabled() {
  if (!settings.umamiWebsiteId || typeof document === 'undefined' || globalThis.claude) return false;
  return settings.allowLocal || !isLocal();
}

function flush() {
  while (queue.length && globalThis.umami) {
    const payload = queue.shift();
    try {
      globalThis.umami.track((defaults) => ({ ...defaults, ...payload }));
    } catch {
      /* měření nesmí aplikaci nikdy rozbít */
    }
  }
}

export function initAnalytics() {
  if (started || !analyticsEnabled()) return;
  started = true;
  const script = document.createElement('script');
  script.defer = true;
  script.src = settings.umamiScript || 'https://cloud.umami.is/script.js';
  script.dataset.websiteId = settings.umamiWebsiteId;
  script.dataset.autoTrack = 'false'; // obrazovky hlásíme sami, s adresou bez dat
  script.dataset.doNotTrack = 'true';
  script.dataset.excludeSearch = 'true';
  script.dataset.excludeHash = 'true';
  try {
    if (config.siteUrl) script.dataset.domains = new URL(config.siteUrl).hostname;
  } catch {
    /* špatně zapsaná adresa webu měření neomezí */
  }
  script.addEventListener('load', flush);
  document.head.appendChild(script);
}

function send(payload) {
  if (!analyticsEnabled()) return;
  queue.push(payload);
  if (queue.length > 50) queue.shift();
  flush();
}

/** Zobrazení obrazovky. `route` je název obrazovky, nikdy skutečná adresa. */
export function trackView(route, title) {
  page = '/' + route;
  send({ url: page, title });
}

/** Událost s hrubými údaji. Do `data` nepatří nic, co uživatel napsal. */
export function trackEvent(name, data = {}) {
  send({ url: page, name, data });
}

/** Pořadí faktury jako pásmo, aby šlo poznat, kdo se vrací, a přitom nikoho neidentifikovat. */
export function countBucket(n) {
  if (n <= 1) return '1';
  if (n <= 5) return '2-5';
  if (n <= 20) return '6-20';
  return '21+';
}
