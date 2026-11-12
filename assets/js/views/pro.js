// Cinkne Pro, dobrovolné příspěvky a pravidla hry.

import config from '../../../config.js';
import { h, field, toast } from '../ui.js';
import { formatWhole } from '../lib/calc.js';
import { normalizeAccount } from '../lib/iban.js';
import { buildSpayd } from '../lib/spayd.js';
import { qrMatrix, qrSvg } from '../lib/qr.js';
import { isPro, proIsFree, unlockWithCode } from '../lib/pro.js';
import { state, persist } from '../lib/store.js';

const FREE = [
  'Faktury s QR Platbou bez omezení počtu',
  'PDF ke stažení, přehled a hlídání splatnosti',
  'Upomínky ve třech tónech',
  'QR Platba a kalkulačka hodinovky',
  'Záloha dat do souboru',
];
const PRO = [
  'Vlastní logo v záhlaví faktury',
  'Vlastní barva faktury',
  'Faktura bez patičky „Vystaveno v aplikaci Cinkne“',
  'Export faktur do CSV pro účetní',
];

export function proView() {
  const root = h('div', { class: 'pro-view' });

  function render() {
    const free = proIsFree();
    const unlocked = isPro();
    const price = formatWhole(config.pro.priceCzk);

    const owner = normalizeAccount(config.owner.account);

    let proAction;
    if (free) {
      proAction = h('p', { class: 'pill is-ok' }, 'Teď odemčeno všem');
    } else if (state.pro.unlocked) {
      proAction = h('p', { class: 'pill is-ok' }, 'Máš odemčeno. Díky!');
    } else {
      const code = field({ id: 'pro-code', label: 'Mám kód', mono: true, placeholder: 'CINK-XXXX-XXXX-XXXX' });
      const ways = [];
      if (config.pro.paymentUrl) {
        ways.push(h('div', { class: 'pay-way' },
          h('a', { class: 'btn btn-primary', href: config.pro.paymentUrl, target: '_blank', rel: 'noopener' }, `Zaplatit kartou ${price}`),
          h('p', { class: 'fine' }, 'Kód ti přijde e-mailem po zaplacení.')));
      }
      if (owner.ok) {
        if (!state.pro.order) {
          state.pro.order = String(Math.floor(10000000 + Math.random() * 89999999));
          persist();
        }
        const spayd = buildSpayd({ iban: owner.iban, amount: config.pro.priceCzk, vs: state.pro.order, message: 'Cinkne Pro', recipient: config.owner.name });
        const qr = h('div', { class: 'qr-code qr-small' });
        qr.innerHTML = qrSvg(qrMatrix(spayd), { title: `QR Platba na ${price}` });
        ways.push(h('div', { class: 'pay-way pay-qr' },
          qr,
          h('div', { class: 'pay-qr-text' },
            h('strong', null, `Zaplatit QR Platbou ${price}`),
            h('dl', { class: 'facts' },
              h('div', null, h('dt', null, 'Účet'), h('dd', { class: 'mono' }, owner.account)),
              h('div', null, h('dt', null, 'Variabilní symbol'), h('dd', { class: 'mono' }, state.pro.order))),
            h('p', { class: 'fine' }, config.owner.email
              ? ['Po zaplacení napiš na ', h('span', { class: 'mono' }, config.owner.email), ' svůj variabilní symbol. Kód ti pošlu, jakmile platba dorazí.']
              : 'Po zaplacení se ozvi provozovateli se svým variabilním symbolem a dostaneš kód.'))));
      }
      proAction = h('div', { class: 'pro-buy' },
        ways.length ? ways : h('p', { class: 'fine' }, 'Platby se právě nastavují. Zkus to prosím později.'),
        h('p', { class: 'fine' }, 'Jednorázová platba, žádné předplatné.'),
        h('form', { class: 'copy-field', novalidate: true, onsubmit: async (e) => {
          e.preventDefault();
          if (await unlockWithCode(code.input.value)) {
            toast('Pro je odemčené. Díky!');
            render();
          } else {
            code.setHint('Tenhle kód neznám. Zkontroluj překlepy.', 'warn');
          }
        } }, code, h('button', { type: 'submit', class: 'btn btn-small' }, 'Odemknout'))
      );
    }

    const plans = h('div', { class: 'plans' },
      h('section', { class: 'card plan' },
        h('h2', null, 'Zdarma'),
        h('p', { class: 'plan-price mono' }, '0 Kč'),
        h('ul', { class: 'ticks' }, FREE.map((t) => h('li', null, t))),
        h('a', { class: 'btn', href: '#faktura' }, 'Vystavit fakturu')),
      h('section', { class: 'card plan plan-pro' },
        h('h2', null, 'Pro'),
        h('p', { class: 'plan-price mono' }, free ? 'v betě zdarma' : `${price} jednorázově`),
        h('ul', { class: 'ticks' }, h('li', null, 'Všechno z verze zdarma'), PRO.map((t) => h('li', null, t))),
        proAction,
        free && h('p', { class: 'fine' }, 'Cinkne je v betě, takže funkce Pro teď může používat každý.'))
    );

    const sections = [
      h('div', { class: 'view-head' }, h('h1', null, 'Cinkne Pro'),
        h('p', { class: 'lede' }, unlocked && !free ? 'Všechno je odemčené.' : 'Fakturovat můžeš zdarma napořád. Pro přidává vlastní vzhled a export.')),
      plans,
    ];

    if (owner.ok) {
      const tips = [50, 100, 250];
      let amount = 100;
      const box = h('div', { class: 'qr-code qr-small' });
      const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Výše příspěvku' });
      const draw = () => {
        const spayd = buildSpayd({ iban: owner.iban, amount, message: 'Dik za Cinkne', recipient: config.owner.name });
        box.innerHTML = qrSvg(qrMatrix(spayd), { title: `QR Platba na ${amount} Kč` });
        chips.replaceChildren(...tips.map((t) => h('button', { type: 'button', class: 'chip' + (t === amount ? ' is-active' : ''), 'aria-pressed': t === amount ? 'true' : 'false',
          onclick: () => { amount = t; draw(); } }, formatWhole(t))));
      };
      draw();
      sections.push(h('section', { class: 'card tip' },
        h('div', null,
          h('h2', null, 'Ušetřilo ti Cinkne čas?'),
          h('p', null, 'Aplikace je bez reklam a bez sledování. Jestli ti pomohla dostat zaplaceno, můžeš přispět na provoz. Jak jinak než QR Platbou.'),
          chips,
          h('p', { class: 'fine mono' }, owner.account)),
        box));
    }

    sections.push(h('section', { class: 'card privacy' },
      h('h2', null, 'Tvoje data jsou tvoje'),
      h('ul', { class: 'ticks' },
        h('li', null, 'Faktury, odběratelé i číslo účtu zůstávají ve tvém prohlížeči. Na žádný server se neposílají.'),
        h('li', null, 'Žádná registrace, žádné cookies, žádné sledování.'),
        h('li', null, 'PDF i QR kódy vznikají přímo u tebe v zařízení.')),
      h('p', { class: 'fine' }, 'Cinkne nenahrazuje účetního ani daňového poradce. Za správnost vystavených dokladů odpovídá ten, kdo je vystavuje.'),
      config.owner.email && h('p', { class: 'fine' }, 'Provozuje ', config.owner.name || 'Cinkne', ', kontakt: ', h('span', { class: 'mono' }, config.owner.email))
    ));

    root.replaceChildren(...sections);
  }

  render();
  return { el: root, refresh: render };
}
