// Kalkulačka hodinovky: kolik si říct, aby zbylo, kolik chceš.

import { h, field } from '../ui.js';
import { state, persist } from '../lib/store.js';
import { formatWhole, hourlyRate, netFromRate, num } from '../lib/calc.js';

export function rateView() {
  const root = h('div', { class: 'rate-view' });
  const r = state.rate;

  const rateOut = h('strong', { class: 'rate-big mono', id: 'rate-result' });
  const facts = h('dl', { class: 'facts' });
  const compare = h('p', { class: 'rate-compare' });

  function update() {
    persist();
    const res = hourlyRate(r);
    rateOut.textContent = res.rate > 0 ? `${formatWhole(Math.ceil(res.rate / 10) * 10)} / hod` : 'Doplň údaje';
    facts.replaceChildren(
      h('div', null, h('dt', null, 'Denní sazba (8 hod)'), h('dd', { class: 'mono' }, formatWhole(Math.ceil(res.dayRate / 100) * 100))),
      h('div', null, h('dt', null, 'Potřebné tržby měsíčně'), h('dd', { class: 'mono' }, formatWhole(res.revenueMonth))),
      h('div', null, h('dt', null, 'Fakturovatelné hodiny za rok'), h('dd', { class: 'mono' }, Math.round(res.billableHours).toLocaleString('cs-CZ'))),
      h('div', null, h('dt', null, 'Fakturovatelné hodiny týdně'), h('dd', { class: 'mono' }, res.billableHoursPerWeek.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })))
    );
    const current = num(r.currentRate);
    if (current > 0 && res.rate > 0) {
      const net = netFromRate({ ...r, rate: current });
      const gap = num(r.netMonthly) - net;
      compare.textContent = gap > 0
        ? `Při ${formatWhole(current)} za hodinu ti zbude zhruba ${formatWhole(net)} měsíčně. Do cíle chybí ${formatWhole(gap)}.`
        : `Při ${formatWhole(current)} za hodinu ti zbude zhruba ${formatWhole(net)} měsíčně. Cíl plníš s rezervou ${formatWhole(-gap)}.`;
      compare.className = 'rate-compare ' + (gap > 0 ? 'is-warn' : 'is-ok');
    } else {
      compare.textContent = '';
    }
    compare.hidden = !compare.textContent;
  }

  const input = (key, label, opts = {}) => field({ id: 'rate-' + key, label, value: r[key], mono: true, inputmode: 'decimal',
    oninput: (v) => { r[key] = v; update(); }, ...opts });

  root.append(
    h('div', { class: 'view-head' }, h('h1', null, 'Hodinovka'),
      h('p', { class: 'lede' }, 'Většina lidí na volné noze si účtuje málo, protože počítá jen odpracované hodiny. Tady je vidět i dovolená, nemoc a čas, který nikdo nezaplatí.')),
    h('div', { class: 'rate-layout' },
      h('form', { class: 'card', novalidate: true, onsubmit: (e) => e.preventDefault() },
        h('div', { class: 'grid' },
          input('netMonthly', 'Kolik chceš čistého měsíčně (Kč)', { wide: true }),
          input('costsMonthly', 'Měsíční náklady na podnikání (Kč)', { wide: true, hint: 'Software, technika, účetní, coworking, cestování.' }),
          input('taxPct', 'Daně a pojištění (% z tržeb)', { wide: true, hint: 'Tvůj odhad. Záleží na tom, jestli uplatňuješ paušál, skutečné výdaje nebo paušální daň. Přesné číslo ti řekne účetní.' }),
          input('hoursPerWeek', 'Pracovních hodin týdně'),
          input('billablePct', 'Z toho fakturovatelných (%)', { hint: 'Zbytek spolkne obchod, administrativa a učení.' }),
          input('weeksOff', 'Týdnů volna za rok', { wide: true, hint: 'Dovolená, svátky i nemoc dohromady.' }),
          input('currentRate', 'Kolik si účtuješ teď (Kč / hod)', { wide: true, placeholder: 'nepovinné' })
        )),
      h('div', { class: 'card rate-result' },
        h('span', { class: 'field-label' }, 'Minimální hodinová sazba'),
        rateOut,
        compare,
        facts,
        h('p', { class: 'fine' }, 'Orientační výpočet bez DPH. Pod tuhle sazbu se nevyplatí jít; cenu podle hodnoty pro klienta si nastav klidně výš.'),
        h('a', { class: 'btn btn-primary', href: '#faktura' }, 'Vystavit fakturu')
      )
    )
  );
  update();
  return { el: root, refresh: update };
}
