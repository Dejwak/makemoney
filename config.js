// Nastavení provozovatele. Tohle je jediný soubor, který je potřeba upravit,
// aby aplikace začala vydělávat. Podrobnosti jsou v README.md.

export default {
  // Veřejná adresa webu, např. 'https://cinkne.cz/'. Zapne sdílení platebních odkazů.
  siteUrl: '',

  // Kdo aplikaci provozuje. Vyplněný účet zapne dobrovolné příspěvky přes QR Platbu.
  owner: {
    name: '',
    account: '', // české číslo účtu (19-2000145399/0800) nebo IBAN
    email: '',
  },

  // Placená verze. Dokud je paymentUrl prázdné, jsou funkce Pro odemčené všem (beta).
  pro: {
    priceCzk: 290,
    paymentUrl: '', // platební odkaz, např. Stripe Payment Link
    licenseHashes: [], // SHA-256 otisky platných kódů, vyrobí je `node tools/gen-license.mjs`
  },
};
