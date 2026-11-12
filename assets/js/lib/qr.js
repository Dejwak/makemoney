import qrcode from '../../vendor/qrcode.mjs';

// Bajtový režim kóduje text jako UTF-8 (výchozí kodér knihovny by znaky mimo Latin-1 zkomolil).
const utf8 = new TextEncoder();
qrcode.stringToBytes = (s) => [...utf8.encode(s)];

const ALPHANUMERIC = /^[0-9A-Z $%*+\-./:]*$/;

/** Vrátí matici QR kódu: pole řádků, true = tmavý modul. */
export function qrMatrix(text, level = 'M') {
  const qr = qrcode(0, level);
  qr.addData(text, ALPHANUMERIC.test(text) ? 'Alphanumeric' : 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const rows = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

/** Sloučí tmavé moduly v řádku do vodorovných pruhů: [{ r, c, len }]. */
export function qrRuns(matrix) {
  const runs = [];
  matrix.forEach((row, r) => {
    let start = -1;
    for (let c = 0; c <= row.length; c++) {
      if (row[c] && start < 0) start = c;
      if (!row[c] && start >= 0) {
        runs.push({ r, c: start, len: c - start });
        start = -1;
      }
    }
  });
  return runs;
}

/** SVG path data pro matici, v jednotkách modulů. */
export function qrPath(matrix) {
  return qrRuns(matrix).map(({ r, c, len }) => `M${c} ${r}h${len}v1h-${len}z`).join('');
}

/** Samostatné SVG (bílé pozadí, tichá zóna 4 moduly) – čitelné ve světlém i tmavém režimu. */
export function qrSvg(matrix, { quiet = 4, title = 'QR kód' } = {}) {
  const n = matrix.length + quiet * 2;
  const label = String(title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" role="img" aria-label="${label}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="#ffffff"/>` +
    `<path transform="translate(${quiet} ${quiet})" fill="#000000" d="${qrPath(matrix)}"/></svg>`
  );
}

/** Vykreslí QR do canvasu (pro export PNG). Moduly mají celý počet pixelů, kód je vystředěný v ploše size × size. */
export function drawQr(ctx, matrix, x, y, size) {
  const m = Math.max(Math.floor(size / matrix.length), 1);
  const offset = Math.floor((size - m * matrix.length) / 2);
  ctx.fillStyle = '#000000';
  for (const { r, c, len } of qrRuns(matrix)) {
    ctx.fillRect(x + offset + c * m, y + offset + r * m, len * m, m);
  }
}
