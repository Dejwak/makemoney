// Kalkulačka hodinovky: kolik si říct, aby zbylo, kolik chceš.

import { h, field } from '../ui.js';
import { state, persist } from '../lib/store.js';
import { formatWhole, hourlyRate, isAmount, netFromRate, num } from '../lib/calc.js';

const PRESETS = [
  ['Paušální daň', 12],
  ['Výdajový paušál 60 %', 14],
  ['Výdajový paušál 40 %', 20],
  ['Skutečné výdaje', 33],
];

export function rateView() {
  const root = h('div', { class: 'rate-view' });
  const rateOut = h('strong', { class: 'rate-big mono', id: 'rate-result' });
  const facts = h('dl', { class: 'facts' });
  const compare = h('p', { class: 'rate-compare', role: 'status' });
  const formSlot = h('div');

  function update() {
    const r = state.rate;
    const res = hourlyRate(r);
    const hourly = Math.ceil(res.rate / 10) * 10;
    const valid = res.rate > 0 && Object.entries(r).every(([key, v]) => key === 'currentRate' || (isAmount(v) && num(v) >= 0));
    rateOut.textContent = valid ? `${formatWhole(hourly)}/h` : 'Doplň údaje';
    facts.replaceChildren(...(valid ? [
      h('div', null, h('dt', null, 'Denní sazba (8 h)'), h('dd', { class: 'mono' }, formatWhole(hourly * 8))),
      h('div', null, h('dt', null, 'Potřebné tržby měsíčně'), h('dd', { class: 'mono' }, formatWhole(res.revenueMonth))),
      h('div', null, h('dt', null, 'Fakturovatelné hodiny za rok'), h('dd', { class: 'mono' }, Math.round(res.billableHours).toLocaleString('cs-CZ'))),
      h('div', null, h('dt', null, 'Fakturovatelné hodiny týdně'), h('dd', { class: 'mono' }, res.billableHoursPerWeek.toLocaleString('cs-CZ', { maximumFractionDigits: 1 }))),
    ] : []));
    const current = num(r.currentRate);
    compare.textContent = '';
    if (valid && current > 0) {
      const net = netFromRate({ ...r, rate: current });
      const gap = Math.round(num(r.netMonthly) - net);
      if (net < 0) {
        compare.textContent = `Při ${formatWhole(current)} za hodinu nepokryješ ani náklady a odvody. Měsíčně chybí ${formatWhole(-net)}.`;
      } else if (gap > 0) {
        compare.textContent = `Při ${formatWhole(current)} za hodinu ti zbude zhruba ${formatWhole(net)} měsíčně. Do cíle chybí ${formatWhole(gap)}.`;
      } else {
        compare.textContent = `Při ${formatWhole(current)} za hodinu ti zbude zhruba ${formatWhole(net)} měsíčně. Cíl plníš s rezervou ${formatWhole(-gap)}.`;
      }
      compare.className = 'rate-compare ' + (gap > 0 ? 'is-warn' : 'is-ok');
    }
    compare.hidden = !compare.textContent;
  }

  function buildForm() {
    const r = state.rate;
    const input = (key, label, opts = {}) => field({ id: 'rate-' + key, label, value: r[key], mono: true, inputmode: 'decimal', maxlength: 12,
      oninput: (v) => { state.rate[key] = v; persist(); update(); }, ...opts });
    const tax = input('taxPct', 'Daně a pojištění (% z tržeb)', { wide: true,
      hint: 'Tvůj odhad. Orientačně pro rok 2026: paušální daň v 1. pásmu asi 12 %, výdajový paušál 60 % asi 14 %, paušál 40 % asi 20 %, skutečné výdaje i přes 30 %. Přesné číslo ti řekne účetní.' });
    const presets = h('div', { class: 'chips field-wide', role: 'group', 'aria-label': 'Odhad podle způsobu zdanění' },
      PRESETS.map(([label, pct]) => h('button', { type: 'button', class: 'chip', onclick: () => {
        state.rate.taxPct = String(pct);
        tax.input.value = String(pct);
        persist();
        update();
      } }, `${label} ${pct} %`)));
    formSlot.replaceChildren(h('form', { class: 'card', novalidate: true, onsubmit: (e) => e.preventDefault() },
      h('div', { class: 'grid' },
        input('netMonthly', 'Kolik chceš čistého měsíčně (Kč)', { wide: true }),
        input('costsMonthly', 'Měsíční náklady na podnikání (Kč)', { wide: true, hint: 'Software, technika, účetní, coworking, cestování.' }),
        tax,
        presets,
        input('hoursPerWeek', 'Pracovních hodin týdně'),
        input('billablePct', 'Z toho fakturovatelných (%)', { hint: 'Zbytek spolkne obchod, administrativa a učení.' }),
        input('weeksOff', 'Týdnů volna za rok', { wide: true, hint: 'Dovolená, svátky i nemoc dohromady.' }),
        input('currentRate', 'Kolik si účtuješ teď (Kč/h)', { wide: true, placeholder: 'nepovinné' })
      )));
  }

  root.append(
    h('div', { class: 'view-head' }, h('h1', null, 'Hodinovka'),
      h('p', { class: 'lede' }, 'Většina lidí na volné noze si účtuje málo, protože počítá jen odpracované hodiny. Tady je vidět i dovolená, nemoc a čas, který nikdo nezaplatí.')),
    h('div', { class: 'rate-layout' },
      formSlot,
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
  const refresh = () => {
    buildForm();
    update();
  };
  refresh();
  return { el: root, refresh };
}
