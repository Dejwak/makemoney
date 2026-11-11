// Drobné pomůcky pro stavbu rozhraní bez frameworku.

/** h('div', { class: 'x', onclick: fn }, child, 'text') */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'value') el.value = value;
    else if (key === 'checked' || key === 'disabled' || key === 'hidden' || key === 'open' || key === 'readOnly') el[key] = !!value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Pole formuláře se štítkem. opts: id, label, value, oninput, type, inputmode, placeholder, hint, wide, list, mono */
export function field(opts) {
  const input = h(opts.textarea ? 'textarea' : 'input', {
    id: opts.id,
    type: opts.textarea ? null : opts.type || 'text',
    inputmode: opts.inputmode,
    placeholder: opts.placeholder,
    autocomplete: opts.autocomplete || 'off',
    list: opts.list,
    rows: opts.textarea ? opts.rows || 3 : null,
    maxlength: opts.maxlength,
    class: opts.mono ? 'mono' : null,
    value: opts.value ?? '',
    oninput: (e) => opts.oninput && opts.oninput(e.target.value, e.target),
    onchange: (e) => opts.onchange && opts.onchange(e.target.value, e.target),
  });
  const hint = h('span', { class: 'field-hint', id: opts.id + '-hint' }, opts.hint || '');
  hint.hidden = !opts.hint;
  const wrap = h('label', { class: 'field' + (opts.wide ? ' field-wide' : ''), for: opts.id },
    h('span', { class: 'field-label' }, opts.label), input, hint);
  wrap.input = input;
  wrap.setHint = (text, kind) => {
    hint.textContent = text || '';
    hint.hidden = !text;
    hint.className = 'field-hint' + (kind ? ' is-' + kind : '');
  };
  return wrap;
}

let toastTimer = null;
/** Krátké oznámení dole na stránce. */
export function toast(message, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.className = 'toast is-visible' + (kind ? ' is-' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3200);
}

/** Tlačítko, které napoprvé jen požádá o potvrzení (confirm() v rámci stránky). */
export function confirmButton(label, confirmLabel, onConfirm, cls = 'btn btn-ghost btn-small') {
  let armed = false;
  let timer = null;
  const btn = h('button', { type: 'button', class: cls }, label);
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      btn.textContent = confirmLabel;
      btn.classList.add('is-danger');
      timer = setTimeout(() => {
        armed = false;
        btn.textContent = label;
        btn.classList.remove('is-danger');
      }, 4000);
      return;
    }
    clearTimeout(timer);
    onConfirm();
  });
  return btn;
}

/** Krátké cinknutí – zvuk příchozí platby. */
export function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [[1568, 0], [2093, 0.09]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.12, now + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.7);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.75);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {
    /* bez zvuku */
  }
}
