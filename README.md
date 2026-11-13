# Cinkne

Faktura s QR Platbou za minutu. Webová aplikace pro živnostníky a lidi na volné noze, která jim
pomáhá dostat zaplaceno: vystaví fakturu, pohlídá splatnost, napíše upomínku a poradí s cenou.

Běží celá v prohlížeči. Nemá server, databázi, registraci ani sledování. Faktury zůstávají
u uživatele v `localStorage`, PDF i QR kódy vznikají přímo v jeho zařízení.

## Co umí

| Obrazovka | K čemu je |
| --- | --- |
| **Faktura** | Formulář s živým náhledem A4. Neplátce i plátce DPH (21 / 12 / 0 % s důvodem), CZK a EUR, česky i anglicky, automatické číslování, QR Platba (u faktur v eurech SEPA QR) přímo na faktuře, export do PDF. |
| **Přehled** | Kolik čeká na zaplacení, kolik je po splatnosti, kolik letos přišlo. Označení zaplacených faktur, kopie faktury, hlídač limitu obratu pro DPH, záloha a obnova dat, export CSV pro účetní. |
| **Upomínky** | Hotový text podle počtu dní po splatnosti, volitelně se zákonným úrokem z prodlení, evidence odeslaných upomínek. |
| **QR Platba** | Samostatný platební kód (dluh za večeři, záloha). Uložení jako PNG, sdílení odkazem. |
| **Hodinovka** | Kalkulačka minimální hodinové sazby z požadovaného čistého příjmu, nákladů a reálně fakturovatelného času. |
| **Pro** | Ceník, odemčení placené verze, dobrovolné příspěvky. |

## Jak na tom vydělat

Aplikace je postavená jako freemium nástroj: zdarma přivádí návštěvníky (fakturu potřebuje každý
živnostník každý měsíc), část z nich zaplatí za vlastní vzhled faktur nebo přispěje.
Všechno se zapíná v jediném souboru, [`config.js`](config.js):

1. **Dobrovolné příspěvky.** Vyplň `owner.account` (číslo účtu nebo IBAN) a `owner.name`.
   Na stránce Pro se objeví QR Platba na 50 / 100 / 250 Kč.
2. **Placená verze Pro.** Nastav `pro.enabled: true`. Funkce Pro (logo, barva, faktura bez
   patičky, CSV) se zamknou a na stránce Pro se objeví nákup:
   - **QR Platbou na tvůj účet** (stačí `owner.account` a `owner.email`). Každý zájemce dostane
     vlastní variabilní symbol, po zaplacení ti ho pošle e-mailem a ty mu odpovíš kódem.
     Žádné poplatky, žádná registrace u platební brány.
   - **Přes platební bránu**, pokud vyplníš `pro.paymentUrl` (libovolný platební odkaz).

   Kódy vyrobíš příkazem `node tools/gen-license.mjs 10`; otisky z výpisu vlož do
   `pro.licenseHashes`, kódy posílej zákazníkům. Dokud je `pro.enabled` vypnuté, je Pro
   odemčené všem jako beta.
3. **Růst zdarma.** Jakmile je placená verze zapnutá, nesou faktury z bezplatné verze patičku
   „Vystaveno zdarma v aplikaci Cinkne“, takže každá odeslaná faktura ukáže aplikaci dalšímu
   podnikateli. Po vyplnění `siteUrl` se navíc zapne sdílení platebních odkazů z obrazovky
   QR Platba.

### Když nemáš IČO

Zdarma můžeš aplikaci provozovat bez omezení. Tak je i nastavená: Pro je odemčené všem
a příspěvky jsou vypnuté. Prodej verze Pro nebo pravidelné přijímání příspěvků je ale soustavná
výdělečná činnost a na tu je v Česku potřeba živnostenské oprávnění, tedy i IČO. Než zapneš
`pro.enabled` nebo vyplníš `owner.account`, vyřiď si živnost a s účetní prober daně a pojištění.

Poctivá poznámka: ověření kódu probíhá v prohlížeči, takže ho technicky zdatný člověk obejde.
Na nástroj za pár stovek to stačí; až to přestane stačit, je čas na server s účty.

Co kód nevyřeší a je na provozovateli: vlastní doména, podmínky užití a zásady ochrany
soukromí, živnost a zdanění příjmů, přivedení prvních uživatelů.

## Spuštění

Není potřeba nic instalovat ani sestavovat, stačí statický server:

```bash
npm start          # http://localhost:8080
npm test           # testy výpočtů (Node 22+)
npm run test:e2e   # průchod aplikací v prohlížeči (potřebuje balíček playwright)
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
tests/                  testy výpočtů, tests/e2e průchod v prohlížeči
tools/                  generátor licenčních kódů, sestavení artefaktu
```

Náhled i PDF kreslí totéž rozvržení z `layout.js`, takže to, co uživatel vidí, je to, co stáhne.

## Co je potřeba hlídat ručně

- **Zákonný úrok z prodlení.** Tabulka sazeb po pololetích je v `assets/js/lib/calc.js`
  (`STATUTORY_RATES`). Jednou za půl roku do ní doplň novou sazbu: repo sazba ČNB platná
  první den pololetí plus 8 procentních bodů.
- **Limit obratu pro DPH** (2 000 000 Kč a 2 536 500 Kč) je v `assets/js/views/overview.js`.
- **Orientační odvody v kalkulačce hodinovky** (`assets/js/views/rate.js`) platí pro rok 2026.
- **Údaje provozovatele.** Než zapneš placenou verzi nebo příspěvky, vyplň v `config.js`
  i `owner.address` a `owner.ico`; zobrazí se na stránce Pro.

## Upozornění

Cinkne nenahrazuje účetního ani daňového poradce. Za správnost vystavených dokladů odpovídá
ten, kdo je vystavuje. Sazby DPH a náležitosti dokladů se mění; před ostrým provozem je nech
zkontrolovat.
