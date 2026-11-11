import { normalizeAccount } from './iban.js';
import { buildSpayd } from './spayd.js';
import { qrMatrix } from './qr.js';
import { invoiceTotals } from './calc.js';

/**
 * Platební údaje faktury včetně QR Platby.
 * Vrací { ok, account, iban, spayd, matrix } – matrix je null, když není co platit.
 */
export function invoicePayment(invoice) {
  const supplier = invoice.supplier || {};
  const acc = normalizeAccount(supplier.account);
  if (!acc.ok) return { ok: false, error: acc.error, account: String(supplier.account || '').trim(), iban: '', spayd: null, matrix: null };
  const { total } = invoiceTotals(invoice);
  let spayd = null;
  let matrix = null;
  if (total > 0 && total <= 999999999) {
    spayd = buildSpayd({
      iban: acc.iban,
      amount: total / 100,
      currency: invoice.currency,
      vs: invoice.vs,
      message: `Faktura ${invoice.number || ''}`,
      recipient: supplier.name,
    });
    matrix = qrMatrix(spayd);
  }
  return { ok: true, account: acc.account, iban: acc.iban, spayd, matrix };
}
