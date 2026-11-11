# Cinkne

Faktura s QR Platbou za minutu. Webová aplikace pro živnostníky a lidi na volné noze, která jim
pomáhá dostat zaplaceno: vystaví fakturu, pohlídá splatnost, napíše upomínku a poradí s cenou.

Běží celá v prohlížeči. Nemá server, databázi, registraci ani sledování. Faktury zůstávají
u uživatele v `localStorage`, PDF i QR kódy vznikají přímo v jeho zařízení.

## Co umí

| Obrazovka | K čemu je |
| --- | --- |
| **Faktura** | Formulář s živým náhledem A4. Neplátce i plátce DPH (21 / 12 / 0 %), CZK a EUR, automatické číslování, QR Platba přímo na faktuře, export do PDF. |
| **Přehled** | Kolik čeká na zaplacení, kolik je po splatnosti, kolik letos přišlo. Označení zaplacených faktur, záloha a obnova dat, export CSV pro účetní. |
| **Upomínky** | Hotový text ve třech tónech podle počtu dní po splatnosti, volitelně s úrokem z prodlení. |
| **QR Platba** | Samostatný platební kód (dluh za večeři, záloha). Uložení jako PNG, sdílení odkazem. |
| **Hodinovka** | Kalkulačka minimální hodinové sazby z požadovaného čistého příjmu, nákladů a reálně fakturovatelného času. |
| **Pro** | Ceník, odemčení placené verze, dobrovolné příspěvky. |

## Jak na tom vydělat

Aplikace je postavená jako freemium nástroj: zdarma přivádí návštěvníky (fakturu potřebuje každý
živnostník každý měsíc), část z nich zaplatí za vlastní vzhled faktur nebo přispěje.
Všechno se zapíná v jediném souboru, [`config.js`](config.js):

1. **Dobrovolné příspěvky.** Vyplň `owner.account` (číslo účtu nebo IBAN) a `owner.name`.
   Na stránce Pro se objeví QR Platba na 50 / 100 / 250 Kč.
2. **Placená verze Pro.** Založ si platební odkaz (např. Stripe Payment Link) a vlož ho do
   `pro.paymentUrl`. Tím se funkce Pro (logo, barva, faktura bez patičky, CSV) zamknou.
   Kódy pro zákazníky vyrobíš příkazem `node tools/gen-license.mjs 10`; otisky z výpisu vlož
   do `pro.licenseHashes` a kódy posílej po zaplacení (ručně nebo automatickým e-mailem
   z platební brány). Dokud `paymentUrl` chybí, je Pro odemčené všem jako beta.
3. **Růst zdarma.** Jakmile je placená verze zapnutá, nesou faktury z bezplatné verze patičku
   „Vystaveno zdarma v aplikaci Cinkne“, takže každá odeslaná faktura ukáže aplikaci dalšímu
   podnikateli.
   Po vyplnění `siteUrl` se navíc zapne sdílení platebních odkazů z obrazovky QR Platba.

Poctivá poznámka: ověření kódu probíhá v prohlížeči, takže ho technicky zdatný člověk obejde.
Na nástroj za pár stovek to stačí; až to přestane stačit, je čas na server s účty.

Co kód nevyřeší a je na provozovateli: vlastní doména, podmínky užití a zásady ochrany
soukromí, živnost a zdanění příjmů, přivedení prvních uživatelů.

## Spuštění

Není potřeba nic instalovat ani sestavovat, stačí statický server:

```bash
npm start          # http://localhost:8080
npm test           # jednotkové testy (Node 22+)
```

## Nasazení

Web tvoří `index.html`, `config.js` a složka `assets`. Dá se nahrát na jakýkoli statický hosting
(Netlify, Cloudflare Pages, Vercel, vlastní server).

**GitHub Pages:** v repozitáři je připravený workflow `.github/workflows/pages.yml`.
V *Settings → Pages* zvol *Source: GitHub Actions* a workflow spusť ručně, nebo sluč změny
do větve `main`. U soukromého repozitáře vyžaduje GitHub Pages placený tarif GitHubu.

**Artefakt na claude.ai:** `node tools/build-artifact.mjs <soubor>` připraví variantu stránky
pro publikaci jako artefakt (styly vložené do stránky, stahování přes rozhraní hostitele).

## Jak je to postavené

```
index.html              kostra stránky
config.js               nastavení provozovatele (účet, platební odkaz, licence)
assets/css/app.css      vzhled, světlý i tmavý režim
assets/js/app.js        navigace mezi obrazovkami
assets/js/views/        šest obrazovek
assets/js/lib/          logika bez závislosti na stránce
  iban.js               české číslo účtu <-> IBAN, kontrolní součty
  spayd.js              řetězec QR Platby (SPAYD 1.0)
  calc.js               částky, DPH, data, číslování, hodinovka, úrok z prodlení
  layout.js             rozvržení faktury na stránky A4 (seznam kreslicích operací)
  render-svg.js         náhled faktury jako SVG
  render-pdf.js         stejné rozvržení jako PDF (pdf-lib)
  reminders.js          texty upomínek
  store.js              stav aplikace a localStorage
assets/vendor/          knihovny třetích stran (MIT), viz assets/vendor/README.md
assets/fonts/           písma (SIL OFL 1.1)
tests/                  testy logiky
tools/                  generátor licenčních kódů, sestavení artefaktu
```

Náhled i PDF kreslí totéž rozvržení z `layout.js`, takže to, co uživatel vidí, je to, co stáhne.

## Upozornění

Cinkne nenahrazuje účetního ani daňového poradce. Za správnost vystavených dokladů odpovídá
ten, kdo je vystavuje. Sazby DPH a náležitosti dokladů se mění; před ostrým provozem je nech
zkontrolovat.
