import { qrPath } from './qr.js';

const FONTS = {
  sans: ['"IBM Plex Sans", system-ui, sans-serif', 400],
  bold: ['"IBM Plex Sans", system-ui, sans-serif', 600],
  mono: ['"JetBrains Mono", ui-monospace, monospace', 400],
  monoBold: ['"JetBrains Mono", ui-monospace, monospace', 600],
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => Math.round(v * 100) / 100;

/** Vykreslí jednu stránku rozvržení jako SVG řetězec. */
export function pageToSvg(ops, width, height, label = 'Náhled faktury') {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
  ];
  for (const op of ops) {
    if (op.t === 'text') {
      const [family, weight] = FONTS[op.f] || FONTS.sans;
      const anchor = op.a === 'r' ? 'end' : op.a === 'c' ? 'middle' : 'start';
      parts.push(
        `<text x="${n(op.x)}" y="${n(op.y)}" font-family='${family}' font-weight="${weight}" font-size="${op.z}" fill="${op.c}" text-anchor="${anchor}" style="font-variant-ligatures:none" xml:space="preserve">${esc(op.s)}</text>`
      );
    } else if (op.t === 'line') {
      parts.push(`<line x1="${n(op.x1)}" y1="${n(op.y1)}" x2="${n(op.x2)}" y2="${n(op.y2)}" stroke="${op.c}" stroke-width="${op.w}"/>`);
    } else if (op.t === 'rect') {
      parts.push(`<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" fill="${op.fill}"/>`);
    } else if (op.t === 'qr') {
      const m = op.size / op.matrix.length;
      parts.push(
        `<path transform="translate(${n(op.x)} ${n(op.y)}) scale(${m})" fill="#000000" shape-rendering="crispEdges" d="${qrPath(op.matrix)}"/>`
      );
    } else if (op.t === 'image') {
      parts.push(`<image href="${esc(op.data)}" x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" preserveAspectRatio="xMidYMid meet"/>`);
    }
  }
  parts.push('</svg>');
  return parts.join('');
}

let ctx = null;
/** Měření šířky textu přes canvas, stejnými písmy jako náhled. */
export function canvasMeasure(text, font, size) {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  const [family, weight] = FONTS[font] || FONTS.sans;
  ctx.font = `${weight} ${size}px ${family}`;
  if ('fontVariantLigatures' in ctx) ctx.fontVariantLigatures = 'none';
  return ctx.measureText(text).width;
}
