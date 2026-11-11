// PDF přes pdf-lib. Knihovny i písma se načtou až při prvním exportu.

import { qrRuns } from './qr.js';
import { layoutInvoice } from './layout.js';

const FONT_FILES = {
  sans: 'PlexSans-Regular.ttf',
  bold: 'PlexSans-SemiBold.ttf',
  mono: 'JetBrainsMono-Regular.ttf',
  monoBold: 'JetBrainsMono-SemiBold.ttf',
};

let libsPromise = null;
let fontBytesPromise = null;

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Nepodařilo se načíst ' + url));
    document.head.appendChild(s);
  });
}

function loadLibs() {
  if (!libsPromise) {
    libsPromise = (async () => {
      if (!globalThis.PDFLib) await loadScript(new URL('../../vendor/pdf-lib.min.js', import.meta.url).href);
      if (!globalThis.fontkit) await loadScript(new URL('../../vendor/fontkit.umd.min.js', import.meta.url).href);
      return { PDFLib: globalThis.PDFLib, fontkit: globalThis.fontkit };
    })().catch((err) => {
      libsPromise = null;
      throw err;
    });
  }
  return libsPromise;
}

function loadFontBytes() {
  if (!fontBytesPromise) {
    fontBytesPromise = (async () => {
      const out = {};
      await Promise.all(
        Object.entries(FONT_FILES).map(async ([key, file]) => {
          const res = await fetch(new URL('../../fonts/' + file, import.meta.url));
          if (!res.ok) throw new Error('Nepodařilo se načíst písmo ' + file);
          out[key] = await res.arrayBuffer();
        })
      );
      return out;
    })().catch((err) => {
      fontBytesPromise = null;
      throw err;
    });
  }
  return fontBytesPromise;
}

function hexColor(PDFLib, hex) {
  const v = parseInt(hex.slice(1), 16);
  return PDFLib.rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

function dataUrlBytes(dataUrl) {
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Vyrobí PDF faktury. `layoutOpts` jsou volby pro layoutInvoice bez `measure`.
 * @returns {Promise<Uint8Array>}
 */
export async function invoicePdf(invoice, layoutOpts, deps) {
  const { PDFLib, fontkit } = deps || (await loadLibs());
  const fontBytes = (deps && deps.fontBytes) || (await loadFontBytes());
  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = {};
  for (const key of Object.keys(FONT_FILES)) {
    fonts[key] = await doc.embedFont(fontBytes[key], { subset: true });
  }
  const measure = (text, font, size) => (fonts[font] || fonts.sans).widthOfTextAtSize(text, size);
  const { pages, width, height } = layoutInvoice(invoice, { ...layoutOpts, measure });

  doc.setTitle(`Faktura ${invoice.number || ''}`.trim());
  doc.setAuthor(invoice.supplier?.name || '');
  doc.setCreator('Cinkne');
  doc.setProducer('Cinkne');

  const images = new Map();
  for (const ops of pages) {
    const page = doc.addPage([width, height]);
    for (const op of ops) {
      if (op.t === 'text') {
        const font = fonts[op.f] || fonts.sans;
        const w = op.a === 'l' ? 0 : font.widthOfTextAtSize(op.s, op.z);
        const x = op.a === 'r' ? op.x - w : op.a === 'c' ? op.x - w / 2 : op.x;
        page.drawText(op.s, { x, y: height - op.y, size: op.z, font, color: hexColor(PDFLib, op.c) });
      } else if (op.t === 'line') {
        page.drawLine({
          start: { x: op.x1, y: height - op.y1 },
          end: { x: op.x2, y: height - op.y2 },
          thickness: op.w,
          color: hexColor(PDFLib, op.c),
        });
      } else if (op.t === 'rect') {
        page.drawRectangle({ x: op.x, y: height - op.y - op.h, width: op.w, height: op.h, color: hexColor(PDFLib, op.fill) });
      } else if (op.t === 'qr') {
        const m = op.size / op.matrix.length;
        const black = PDFLib.rgb(0, 0, 0);
        for (const { r, c, len } of qrRuns(op.matrix)) {
          page.drawRectangle({ x: op.x + c * m, y: height - op.y - (r + 1) * m, width: len * m, height: m, color: black });
        }
      } else if (op.t === 'image') {
        if (!images.has(op.data)) {
          const bytes = dataUrlBytes(op.data);
          images.set(op.data, op.data.startsWith('data:image/png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes));
        }
        page.drawImage(images.get(op.data), { x: op.x, y: height - op.y - op.h, width: op.w, height: op.h });
      }
    }
  }
  return doc.save();
}
