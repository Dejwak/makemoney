// Nastavení provozovatele. Tohle je jediný soubor, který je potřeba upravit,
// aby aplikace začala vydělávat. Podrobnosti jsou v README.md.

export default {
  // Veřejná adresa webu, např. 'https://cinkne.cz/'. Zapne sdílení platebních odkazů.
  siteUrl: 'https://cinkne.cz/',

  // Anonymní měření návštěv a použití přes Umami (bez cookies). Prázdné ID = vypnuto.
  // ID webu najdeš v Umami u webu v Settings jako „Website ID“.
  analytics: {
    umamiWebsiteId: '3bea029e-346c-430f-b563-65686dc2ebff',
    umamiScript: 'https://cloud.umami.is/script.js',
  },

  // Kdo aplikaci provozuje. Vyplněný účet zapne dobrovolné příspěvky přes QR Platbu.
  // Jakmile přijímáš platby, zákon chce na webu i sídlo a IČO provozovatele.
  owner: {
    name: '',
    address: '',
    ico: '',
    account: '', // české číslo účtu (2000145399/0800) nebo IBAN
    email: '',
  },

  // Placená verze. Dokud je enabled false, jsou funkce Pro odemčené všem (beta).
  // Po zapnutí se dá platit QR Platbou na účet provozovatele (owner.account + owner.email)
  // a volitelně i přes platební bránu (paymentUrl).
  pro: {
    enabled: false,
    priceCzk: 290,
    paymentUrl: '', // nepovinný platební odkaz, např. od platební brány
    licenseHashes: [], // SHA-256 otisky platných kódů, vyrobí je `node tools/gen-license.mjs`
  },
};
