// Samostatná QR Platba: řekni si o peníze kódem, který stačí naskenovat.

import config from '../../../config.js';
import { h, field, toast } from '../ui.js';
import { state, persist, exampleProfile } from '../lib/store.js';
import { formatMoney, isAmount, num, toCents, toVs } from '../lib/calc.js';
import { normalizeAccount, formatIban } from '../lib/iban.js';
import { buildSpayd } from '../lib/spayd.js';
import { qrMatrix, qrSvg, drawQr } from '../lib/qr.js';
import { saveFile, copyText, saveErrorMessage } from '../lib/save.js';

/** Zakóduje platební údaje do odkazu (část za #, která se neposílá na server). */
export function encodeRequest(q) {
  const json = JSON.stringify({ a: q.account, m: q.amount, v: q.vs, t: q.message, n: q.name });
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeRequest(param) {
  try {
    const bin = atob(String(param).replace(/-/g, '+').replace(/_/g, '/'));
    const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    if (!o || typeof o !== 'object') return null;
    const s = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : '');
    return { account: s(o.a, 40), amount: s(o.m, 16), vs: toVs(s(o.v, 20)), message: s(o.t, 60), name: s(o.n, 35) };
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
  const qrBox = h('div', { class: 'qr-code' });
  const summary = h('dl', { class: 'facts qr-facts' });
  const status = h('p', { class: 'preview-status', role: 'status' });
  const savePng = h('button', { type: 'button', class: 'btn btn-primary' }, 'Uložit jako PNG');
  const copyBtn = h('button', { type: 'button', class: 'btn' }, 'Kopírovat platební údaje');
  const shareBtn = h('button', { type: 'button', class: 'btn' }, 'Kopírovat odkaz se žádostí');
  const details = h('textarea', { id: 'qr-details', rows: 4, readOnly: true, class: 'mono visually-hidden', tabindex: '-1', 'aria-label': 'Platební údaje' });
  const exampleNote = h('div', { class: 'notice notice-example' },
    h('p', null, h('strong', null, 'Ukázkový účet.'), ' Přepiš ho svým číslem účtu, než kód někomu pošleš.'));
  const formSlot = h('div', { class: 'qr-form' });

  // q = to, co se počítá do kódu. Příchozí žádost z odkazu se jen zobrazí, neukládá se.
  let q = null;
  let isExample = false;
  let current = null;

  function load() {
    if (request) {
      q = { ...request };
      isExample = false;
      return;
    }
    const saved = state.qr;
    // Dokud uživatel nezadal vlastní účet, vychází se z profilu; ukázkový účet se nikdy neukládá.
    const example = exampleProfile();
    const fallback = state.demo ? example : state.profile;
    q = { ...saved, account: saved.account || fallback.account || '', name: saved.name || fallback.name || '' };
    isExample = q.account.replace(/\s+/g, '') === example.account;
  }

  function clear(message, kind) {
    current = null;
    qrBox.innerHTML = '<div class="qr-placeholder">QR</div>';
    summary.replaceChildren();
    status.textContent = message;
    status.className = 'preview-status' + (kind ? ' is-' + kind : '');
  }

  function update() {
    exampleNote.hidden = !isExample;
    shareBtn.hidden = !config.siteUrl || !!request;
    const acc = normalizeAccount(q.account);
    const cents = toCents(num(q.amount));
    if (!acc.ok) {
      clear(String(q.account).trim() ? acc.error : 'Doplň číslo účtu a kód je hotový.', 'warn');
    } else if (!acc.czech) {
      clear('QR Platba funguje jen s českým účtem.', 'warn');
    } else if (!isAmount(q.amount) || cents < 0) {
      clear('Částce nerozumím. Piš ji třeba jako 1 250,50.', 'warn');
    } else {
      let spayd;
      try {
        spayd = buildSpayd({ iban: acc.iban, amount: cents / 100, vs: q.vs, message: q.message, recipient: q.name });
      } catch (err) {
        clear(err.message, 'warn');
        spayd = null;
      }
      if (spayd) {
        const matrix = qrMatrix(spayd);
        qrBox.innerHTML = qrSvg(matrix, { title: 'QR Platba' });
        status.textContent = 'Stačí naskenovat v bankovní aplikaci. Údaje se vyplní samy.';
        status.className = 'preview-status is-ok';
        const lines = [cents > 0 ? formatMoney(cents, 'CZK') : 'Částku zadá plátce', acc.account, q.vs ? `VS ${q.vs}` : ''].filter(Boolean);
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
          h('div', null, h('dt', null, 'Částka'), h('dd', { class: 'mono' }, cents > 0 ? formatMoney(cents, 'CZK') : 'zadá ten, kdo platí')),
          h('div', null, h('dt', null, 'Účet'), h('dd', { class: 'mono' }, acc.account)),
          q.vs && h('div', null, h('dt', null, 'Variabilní symbol'), h('dd', { class: 'mono' }, q.vs)),
          q.message && h('div', null, h('dt', null, 'Zpráva'), h('dd', null, q.message))
        );
      }
    }
    // Ukázkový účet se dá prohlédnout, ale ne rozeslat.
    savePng.disabled = copyBtn.disabled = shareBtn.disabled = !current || isExample;
  }

  savePng.addEventListener('click', async () => {
    if (!current) return;
    try {
      await saveFile('qr-platba.png', await qrPng(current.matrix, current.lines));
    } catch (err) {
      toast(saveErrorMessage(err), err.code === 'declined' ? '' : 'error');
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
    const url = config.siteUrl.replace(/\/?$/, '/') + '#p=' + encodeRequest(q);
    toast((await copyText(url)) ? 'Odkaz je ve schránce. Pošli ho tomu, kdo má platit.' : 'Kopírování tu nejde.');
  });

  function buildForm() {
    if (request) {
      formSlot.replaceChildren(h('div', { class: 'card' },
        h('h2', null, request.name ? `${request.name} tě žádá o platbu` : 'Žádost o platbu'),
        h('p', null, 'Naskenuj kód v bankovní aplikaci.'),
        h('p', { class: 'warn-text' }, 'Jméno v odkazu si může napsat kdokoli. Plať jen tomu, koho znáš, a před odesláním si v bance zkontroluj číslo účtu i částku.'),
        h('a', { class: 'btn', href: './' }, 'Vytvořit vlastní QR Platbu')));
      return;
    }
    const set = (key) => (value) => {
      q[key] = value;
      state.qr[key] = value;
      if (key === 'account') {
        isExample = value.replace(/\s+/g, '') === exampleProfile().account;
        // Jméno z ukázky k cizímu účtu nepatří.
        if (state.demo && !state.qr.name) {
          q.name = '';
          nameField.input.value = '';
        }
      }
      persist();
      update();
    };
    const nameField = field({ id: 'qr-name', label: 'Tvoje jméno', value: q.name, wide: true, maxlength: 35, oninput: set('name') });
    formSlot.replaceChildren(h('form', { class: 'card', novalidate: true, onsubmit: (e) => e.preventDefault() },
      h('div', { class: 'grid' },
        field({ id: 'qr-account', label: 'Tvůj účet nebo IBAN', value: q.account, mono: true, wide: true, placeholder: '2000145399/0800', maxlength: 40, oninput: set('account') }),
        field({ id: 'qr-amount', label: 'Částka v Kč', value: q.amount, mono: true, inputmode: 'decimal', maxlength: 16, placeholder: 'nech prázdné, ať ji doplní ten, kdo platí', oninput: set('amount') }),
        field({ id: 'qr-vs', label: 'Variabilní symbol', value: q.vs, mono: true, inputmode: 'numeric', maxlength: 10,
          oninput: (v, el) => { const vs = toVs(v); if (el.value !== vs) el.value = vs; set('vs')(vs); } }),
        field({ id: 'qr-message', label: 'Zpráva pro příjemce', value: q.message, wide: true, maxlength: 60, placeholder: 'Půlka za chatu', oninput: set('message') }),
        nameField
      )));
  }

  root.append(
    h('div', { class: 'view-head' }, h('h1', null, 'QR Platba'),
      h('p', { class: 'lede' }, 'Dluží ti kamarád za večeři nebo zákazník zálohu? Pošli mu kód, zaplatí na dvě klepnutí.')),
    exampleNote,
    h('div', { class: 'qr-layout' },
      formSlot,
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

  const refresh = () => {
    load();
    buildForm();
    update();
  };
  refresh();
  return { el: root, refresh };
}
