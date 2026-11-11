#!/usr/bin/env node
// Vyrobí licenční kódy pro Cinkne Pro a jejich SHA-256 otisky.
// Použití: node tools/gen-license.mjs [počet]
// Otisky vlož do config.js (pro.licenseHashes), kódy posílej zákazníkům po zaplacení.

import { randomBytes, createHash } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const count = Math.max(Number(process.argv[2]) || 1, 1);

function code() {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `CINK-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

const rows = Array.from({ length: count }, () => {
  const c = code();
  return { code: c, hash: createHash('sha256').update(c).digest('hex') };
});

console.log('Kódy pro zákazníky:');
for (const r of rows) console.log('  ' + r.code);
console.log('\nOtisky do config.js (pro.licenseHashes):');
for (const r of rows) console.log(`  '${r.hash}',`);
