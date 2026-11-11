#!/usr/bin/env node
// Připraví stránku pro publikaci jako artefakt na claude.ai:
// tělo index.html se styly vloženými přímo do stránky (bez <html>/<head>/<body>).
// Použití: node tools/build-artifact.mjs <výstupní soubor>

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2];
if (!out) {
  console.error('Použití: node tools/build-artifact.mjs <výstupní soubor>');
  process.exit(1);
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'assets/css/app.css'), 'utf8')
  // Písma si stránka v artefaktu načte skriptem ze souborů vedle sebe.
  .replace(/@font-face\s*\{[^}]*\}\s*/g, '');
const title = /<title>[^<]*<\/title>/.exec(html)[0];
const body = /<body>([\s\S]*)<\/body>/.exec(html)[1].trim();

writeFileSync(out, [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  `<style>\n${css}</style>`,
  body,
  '',
].join('\n'));
console.log('Hotovo:', out);
