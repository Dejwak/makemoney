// Samostatná QR Platba: řekni si o peníze kódem, který stačí naskenovat.

import config from '../../../config.js';
import { h, field, toast } from '../ui.js';
import { state, persist } from '../lib/store.js';
import { formatMoney, num, toCents, toVs } from '../lib/calc.js';
import { normalizeAccount, formatIban } from '../lib/iban.js';
import { buildSpayd } from '../lib/spayd.js';
import { qrMatrix, qrSvg, drawQr } from '../lib/qr.js';
import { saveFile, copyText } from '../lib/save.js';

/** Zakóduje platební údaje do parametru odkazu. */
export function encodeRequest(q) {
  const json = JSON.stringify({ a: q.account, m: q.amount, v: q.vs, t: q.message, n: q.name });
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeRequest(param) {
  try {
    const b64 = String(param).replace(/-/g, '+').replace(/_/g, '/');
    const o = JSON.parse(decodeURIComponent(escape(atob(b64))));
    return { account: String(o.a || ''), amount: String(o.m || ''), vs: String(o.v || ''), message: String(o.t || ''), name: String(o.n || '') };
  } catch {
    return null;
  }
}

function qrPng(matrix, lines) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 800 + 70 + lines.length * 44;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawQr(ctx, matrix, 80, 80, 640);
  ctx.fillStyle = '#10231c';
  ctx.textAlign = 'center';
  lines.forEach((line, i) => {
    ctx.font = `${i === 0 ? 600 : 400} ${i === 0 ? 36 : 28}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.fillText(line, 400, 800 + i * 44);
  });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function qrView({ request }) {
  const root = h('div', { class: 'qr-view' });
  // Příchozí žádost o platbu z odkazu se zobrazí, ale neukládá.
  const q = request ? { ...request } : state.qr;
  if (!request && !q.account) {
    q.account = state.profile.account || '';
    q.name = q.name || state.profile.name || '';
  }

  const qrBox = h('div', { class: 'qr-code' });
  const summary = h('dl', { class: 'facts qr-facts' });
  const status = h('p', { class: 'preview-status' });
  const savePng = h('button', { type: 'button', class: 'btn btn-primary' }, 'Uložit jako PNG');
  const copyBtn = h('button', { type: 'button', class: 'btn' }, 'Kopírovat platební údaje');
  const shareBtn = h('button', { type: 'button', class: 'btn' }, 'Kopírovat odkaz s žádostí');
  shareBtn.hidden = !config.siteUrl;
  const details = h('textarea', { id: 'qr-details', rows: 4, readOnly: true, class: 'mono visually-hidden', tabindex: '-1', 'aria-label': 'Platební údaje' });
  let current = null;

  function update() {
    if (!request) persist();
    const acc = normalizeAccount(q.account);
    const cents = toCents(num(q.amount));
    current = null;
    if (!acc.ok) {
      qrBox.innerHTML = '<div class="qr-placeholder">QR</div>';
      status.textContent = String(q.account).trim() ? acc.error : 'Doplň číslo účtu a kód je hotový.';
      status.className = 'preview-status is-warn';
      summary.replaceChildren();
    } else {
      let spayd;
      try {
        spayd = buildSpayd({ iban: acc.iban, amount: cents / 100, vs: q.vs, message: q.message, recipient: q.name });
      } catch (err) {
        status.textContent = err.message;
        status.className = 'preview-status is-warn';
        return;
      }
      const matrix = qrMatrix(spayd);
      qrBox.innerHTML = qrSvg(matrix, { title: 'QR Platba' });
      status.textContent = 'Stačí naskenovat v bankovní aplikaci. Údaje se vyplní samy.';
      status.className = 'preview-status is-ok';
      const lines = [
        cents > 0 ? formatMoney(cents, 'CZK') : 'Částku zadá plátce',
        acc.account,
        q.vs ? `VS ${q.vs}` : '',
      ].filter(Boolean);
      const text = [
        q.name ? `Příjemce: ${q.name}` : '',
        `Číslo účtu: ${acc.account}`,
        `IBAN: ${formatIban(acc.iban)}`,
        cents > 0 ? `Částka: ${formatMoney(cents, 'CZK')}` : '',
        q.vs ? `Variabilní symbol: ${q.vs}` : '',
        q.message ? `Zpráva: ${q.message}` : '',
      ].filter(Boolean).join('\n');
      details.value = text;
      current = { matrix, lines, text };
      summary.replaceChildren(
        h('div', null, h('dt', null, 'Částka'), h('dd', { class: 'mono' }, cents > 0 ? formatMoney(cents, 'CZK') : 'zadá plátce')),
        h('div', null, h('dt', null, 'Účet'), h('dd', { class: 'mono' }, acc.account)),
        q.vs && h('div', null, h('dt', null, 'Variabilní symbol'), h('dd', { class: 'mono' }, q.vs)),
        q.message && h('div', null, h('dt', null, 'Zpráva'), h('dd', null, q.message))
      );
    }
    savePng.disabled = copyBtn.disabled = shareBtn.disabled = !current;
  }

  savePng.addEventListener('click', async () => {
    if (!current) return;
    try {
      await saveFile('qr-platba.png', await qrPng(current.matrix, current.lines));
    } catch (err) {
      toast(err.code === 'declined' ? 'Uložení zrušeno.' : 'Stahování tady není dostupné. Otevři Cinkne v běžném prohlížeči.', err.code === 'declined' ? '' : 'error');
    }
  });
  copyBtn.addEventListener('click', async () => {
    if (!current) return;
    if (await copyText(current.text)) return toast('Platební údaje jsou ve schránce.');
    details.classList.remove('visually-hidden');
    details.focus();
    details.select();
    toast('Kopírování tu nejde. Údaje jsou označené, zkopíruj je ručně.');
  });
  shareBtn.addEventListener('click', async () => {
    const url = config.siteUrl.replace(/\/?$/, '/') + '?p=' + encodeRequest(q);
    toast((await copyText(url)) ? 'Odkaz je ve schránce. Pošli ho tomu, kdo má platit.' : 'Kopírování tu nejde.');
  });

  const set = (key) => (value) => {
    q[key] = value;
    update();
  };

  const form = request
    ? h('div', { class: 'card' },
        h('h2', null, request.name ? `${request.name} tě žádá o platbu` : 'Žádost o platbu'),
        h('p', null, 'Naskenuj kód v bankovní aplikaci. Před odesláním si v ní zkontroluj účet i částku.'),
        h('a', { class: 'btn', href: './' }, 'Vytvořit vlastní QR Platbu'))
    : h('form', { class: 'card', novalidate: true, onsubmit: (e) => e.preventDefault() },
        h('div', { class: 'grid' },
          field({ id: 'qr-account', label: 'Tvůj účet nebo IBAN', value: q.account, mono: true, wide: true, placeholder: '19-2000145399/0800', oninput: set('account') }),
          field({ id: 'qr-amount', label: 'Částka v Kč', value: q.amount, mono: true, inputmode: 'decimal', placeholder: 'nech prázdné, ať ji zadá plátce', oninput: set('amount') }),
          field({ id: 'qr-vs', label: 'Variabilní symbol', value: q.vs, mono: true, inputmode: 'numeric', maxlength: 10,
            oninput: (v, el) => { q.vs = toVs(v); if (el.value !== q.vs) el.value = q.vs; update(); } }),
          field({ id: 'qr-message', label: 'Zpráva pro příjemce', value: q.message, wide: true, maxlength: 60, placeholder: 'Půlka za chatu', oninput: set('message') }),
          field({ id: 'qr-name', label: 'Tvoje jméno', value: q.name, wide: true, maxlength: 35, oninput: set('name') })
        ));

  root.append(
    h('div', { class: 'view-head' }, h('h1', null, 'QR Platba'),
      h('p', { class: 'lede' }, 'Dluží ti kamarád za večeři nebo zákazník zálohu? Pošli mu kód, zaplatí na dvě klepnutí.')),
    h('div', { class: 'qr-layout' },
      form,
      h('div', { class: 'card qr-card' },
        qrBox,
        h('p', { class: 'qr-caption' }, 'QR Platba'),
        summary,
        status,
        h('div', { class: 'actions-row' }, savePng, copyBtn, shareBtn),
        details
      )
    )
  );
  update();
  return { el: root, refresh: update };
}
