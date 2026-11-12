import { normalizeAccount } from './iban.js';
import { buildSpayd, buildEpc, SPAYD_MAX_AMOUNT } from './spayd.js';
import { qrMatrix } from './qr.js';
import { invoiceTotals } from './calc.js';

/**
 * Platební údaje faktury včetně QR kódu.
 * Faktura v Kč na český účet dostane QR Platbu, faktura v eurech SEPA QR.
 * `reason` říká, proč kód chybí: 'account' | 'empty' | 'limit' | 'limitEur' | 'foreign' | 'name'.
 */
export function invoicePayment(invoice) {
  const supplier = invoice.supplier || {};
  const acc = normalizeAccount(supplier.account);
  const out = {
    ok: acc.ok, error: acc.error || '', account: acc.ok ? acc.account : String(supplier.account || '').trim().slice(0, 40),
    iban: acc.ok ? acc.iban : '', bic: String(supplier.swift || '').trim().toUpperCase().slice(0, 11),
    kind: null, label: '', code: null, matrix: null, reason: acc.ok ? null : 'account',
  };
  if (!acc.ok) return out;
  const { total } = invoiceTotals(invoice);
  if (!(total > 0)) return { ...out, reason: 'empty' };
  const remittance = `Faktura ${invoice.number || ''}`.trim();
  try {
    if (invoice.currency === 'EUR') {
      out.code = buildEpc({ iban: acc.iban, bic: out.bic, name: supplier.name, amount: total / 100, remittance: invoice.lang === 'en' ? `Invoice ${invoice.number || ''}`.trim() : remittance });
      out.kind = 'epc';
      out.label = 'SEPA QR';
    } else {
      if (!acc.czech) return { ...out, reason: 'foreign' };
      if (total / 100 > SPAYD_MAX_AMOUNT) return { ...out, reason: 'limit' };
      out.code = buildSpayd({ iban: acc.iban, amount: total / 100, currency: 'CZK', vs: invoice.vs, message: remittance, recipient: supplier.name });
      out.kind = 'spayd';
      out.label = 'QR Platba';
    }
    out.matrix = qrMatrix(out.code);
  } catch {
    return { ...out, kind: null, code: null, matrix: null, reason: !String(supplier.name || '').trim() ? 'name' : invoice.currency === 'EUR' ? 'limitEur' : 'limit' };
  }
  return out;
}
