// Průchod aplikací v prohlížeči. Spuštění: npm run test:e2e
// Potřebuje balíček `playwright` s Chromiem (v CI se instaluje ve workflow).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.ttf': 'font/ttf', '.json': 'application/json', '.txt': 'text/plain',
};

function serve() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('ok   ' + name);
  } catch (err) {
    results.push({ name, ok: false });
    const lines = String(err && err.message ? err.message : err).replace(/\u001b\[\d+m/g, '').split('\n').filter((l) => l.trim()).slice(0, 8);
    console.log('FAIL ' + name + '\n     ' + lines.join('\n     '));
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}
function equal(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: čekal jsem ${JSON.stringify(expected)}, je ${JSON.stringify(actual)}`);
}
/** Počká, až podmínka začne platit (rozhraní se překresluje se zpožděním). */
async function eventually(check, what, timeout = 4000) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await check();
      if (last === true) return;
    } catch (err) {
      last = err.message;
    }
    if (Date.now() > end) throw new Error(`${what}${last === false || last == null ? '' : ' (' + last + ')'}`);
    await new Promise((r) => setTimeout(r, 60));
  }
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const PAID_CONFIG = `export default {
  siteUrl: 'https://example.test/',
  owner: { name: 'Provozovatel', address: 'Dlouhá 1, Praha', ico: '12345679', account: '19-2000145399/0800', email: 'provoz@example.test' },
  pro: { enabled: true, priceCzk: 290, paymentUrl: 'https://example.test/pay',
    licenseHashes: ['acfeba53c6c8dafa07b5008c4d475f4a04c9b088ed7c384633dca1ba4c85942c'] },
};`; // otisk kódu CINK-TEST-TEST-TEST

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cinkne-e2e-'));
  const problems = [];

  async function open(options = {}, { config = null, init = null } = {}) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...options });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('requestfailed', (r) => problems.push('requestfailed: ' + r.url()));
    if (config) await page.route('**/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: config }));
    if (init) await page.addInitScript(init);
    await page.goto(base);
    await page.waitForSelector('.sheet svg');
    return page;
  }
  const go = async (page, route) => {
    await page.goto(base + '#' + route);
    await page.waitForFunction((r) => document.querySelector(`[data-route="${r}"]`)?.getAttribute('aria-current') === 'page', route);
  };
  const noOverflow = async (page, label) => {
    const o = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(o[0] <= o[1], `${label}: stránka přetéká do šířky (${o[0]} > ${o[1]})`);
  };
  const sheetText = (page) => page.evaluate(() => [...document.querySelectorAll('.preview-pages text')].map((t) => t.textContent).join(' '));
  const totalIs = (page, expected) => eventually(async () => (await page.textContent('#inv-total')).trim() === expected || (await page.textContent('#inv-total')).trim(), `celkem má být ${expected}`);
  const statusHas = (page, part) => eventually(async () => (await page.textContent('.preview-status')).includes(part) || (await page.textContent('.preview-status')), `stav náhledu má obsahovat „${part}“`);
  const stateOf = (page) => page.evaluate(async () => JSON.parse(JSON.stringify((await import('./assets/js/lib/store.js')).state)));
  const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('cinkne:v1') || 'null'));
  const draftSpayd = (page) => page.evaluate(async () => {
    const { state } = await import('./assets/js/lib/store.js');
    const { invoicePayment } = await import('./assets/js/lib/payment.js');
    return invoicePayment(state.draft).code;
  });
  /** Čistý formulář vyplněný platnou fakturou. */
  async function fillInvoice(page, { client = 'Žluťoučký kůň s.r.o.', price = '1 234,50', qty = '2,5' } = {}) {
    if (await page.isVisible('text=Začít s prázdnou fakturou')) await page.click('text=Začít s prázdnou fakturou');
    await page.fill('#sup-name', 'Petr Svoboda');
    await page.fill('#sup-street', 'Dlouhá 1');
    await page.fill('#sup-city', 'Praha');
    await page.fill('#sup-ico', '27074358');
    await page.fill('#sup-account', '2000145399/0800');
    await page.fill('#cli-name', client);
    await page.fill('#item-1-desc', 'Konzultace');
    await page.fill('#item-1-qty', qty);
    await page.fill('#item-1-unit', 'h');
    await page.fill('#item-1-price', price);
  }
  const saveOnly = async (page) => {
    await page.click('text=Jen uložit');
    await eventually(async () => (await page.textContent('.save-status')).includes('je uložená v přehledu'), 'faktura se má uložit');
  };

  // ---- základní cesta ----------------------------------------------------
  let page = await open();

  await step('první načtení ukáže ukázkovou fakturu s QR Platbou', async () => {
    assert(await page.isVisible('.notice-example'), 'chybí upozornění na ukázková data');
    await totalIs(page, '12 300,00 Kč');
    assert((await sheetText(page)).includes('QR Platba'), 'v náhledu chybí QR Platba');
    equal(await page.getAttribute('#slip-amount', 'aria-label'), '12 300,00', 'částka v platebním příkazu');
    equal(await page.title(), 'Cinkne', 'titulek');
  });

  await step('prázdná faktura neprojde kontrolou, řekne proč a hlášky mizí s opravami', async () => {
    await page.click('text=Začít s prázdnou fakturou');
    await page.click('text=Jen uložit');
    const text = await page.textContent('.problems');
    for (const part of ['Doplň své jméno', 'Doplň svou adresu', 'Doplň odběratele', 'položku s cenou']) assert(text.includes(part), `chybí hláška „${part}“: ${text}`);
    await page.fill('#sup-name', 'Petr Svoboda');
    await eventually(async () => !(await page.textContent('.problems')).includes('Doplň své jméno'), 'opravená hláška má zmizet');
    await go(page, 'prehled');
    assert(await page.isVisible('text=Zatím tu žádná faktura není'), 'po smazání ukázky má být přehled prázdný, ne ukázkový');
    await go(page, 'faktura');
  });

  await step('vyplnění faktury: český zápis čísel, neplatný účet, nesrozumitelná cena', async () => {
    await fillInvoice(page);
    await totalIs(page, '3 086,25 Kč');
    await page.fill('#sup-account', '123/0100x');
    await statusHas(page, 'QR kód na faktuře nebude');
    assert((await page.textContent('#sup-account-hint')).includes('nesedí'), 'neplatný účet má dostat nápovědu');
    await page.fill('#sup-account', '2000145399/0800');
    await statusHas(page, 'QR Platba je na faktuře');
    await page.fill('#item-1-price', '1.234,50');
    await totalIs(page, '3 086,25 Kč');
    await page.fill('#item-1-price', '1234,5 Kč');
    await totalIs(page, '3 086,25 Kč');
    await page.fill('#item-1-price', '12 korun');
    equal(await page.getAttribute('#item-1-price', 'aria-invalid'), 'true', 'nesrozumitelná cena má být označená');
    await page.click('text=Jen uložit');
    assert((await page.textContent('.problems')).includes('ceně nerozumím'), 'nesrozumitelná cena brání uložení');
    await page.fill('#item-1-price', '1 234,50');
    const spayd = await draftSpayd(page);
    assert(/^SPD\*1\.0\*ACC:CZ7908000000002000145399\*AM:3086\.25\*CC:CZK\*MSG:FAKTURA \d+\*RN:PETR SVOBODA\*X-VS:\d+$/.test(spayd), 'SPAYD: ' + spayd);
  });

  await step('plátce DPH: DIČ, dvě sazby, důvod nulové daně', async () => {
    await page.check('#sup-vat');
    await page.click('text=+ Přidat položku');
    await page.fill('#item-2-desc', 'Kniha');
    await page.fill('#item-2-price', '1000');
    await page.selectOption('#item-2-vat', '12');
    await totalIs(page, '4 854,36 Kč'); // 3086,25 × 1,21 + 1000 × 1,12
    const text = await sheetText(page);
    for (const part of ['FAKTURA – DAŇOVÝ DOKLAD', 'Základ DPH 12 %', 'DPH 21 %', 'CENA ZA JEDN. BEZ DPH']) assert(text.includes(part), 'v náhledu chybí ' + part);
    await page.click('text=Jen uložit');
    assert((await page.textContent('.problems')).includes('DIČ'), 'plátce bez DIČ nesmí projít');
    await page.selectOption('#item-2-vat', '0');
    assert(await page.isVisible('#inv-zero-note'), 'u nulové sazby se má objevit pole pro důvod');
    await page.click('text=Jen uložit');
    assert((await page.textContent('.problems')).includes('0 % DPH'), 'nulová daň potřebuje důvod');
    await page.uncheck('#sup-vat');
    await page.click('[aria-label="Odebrat položku 2"]');
    await totalIs(page, '3 086,25 Kč');
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
    equal(focused, 'item-1-desc', 'po odebrání položky má fokus zůstat ve formuláři');
  });

  let firstNumber;
  await step('uložení a stažení PDF', async () => {
    firstNumber = await page.inputValue('#inv-number');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('text=Uložit a stáhnout PDF')]);
    equal(download.suggestedFilename(), `faktura-${firstNumber}.pdf`, 'název souboru');
    const file = path.join(tmp, 'faktura.pdf');
    await download.saveAs(file);
    const bytes = fs.readFileSync(file);
    assert(bytes.subarray(0, 5).toString() === '%PDF-', 'soubor není PDF');
    assert(bytes.length > 10000, 'PDF je podezřele malé: ' + bytes.length);
    assert(await page.isVisible('text=Upravuješ uloženou fakturu'), 'editor má říct, že je otevřená uložená faktura');
  });

  await step('opakované uložení fakturu nezdvojí a nová dostane další číslo', async () => {
    await page.fill('#inv-note', 'Děkuji.');
    await eventually(async () => (await page.textContent('.save-status')).includes('neuložené změny'), 'stav má upozornit na neuložené změny');
    await saveOnly(page);
    await go(page, 'prehled');
    equal(await page.locator('.invoice-row').count(), 1, 'počet faktur v přehledu');
    await page.click('text=+ Nová faktura');
    await page.waitForSelector('#inv-number');
    equal(await page.inputValue('#inv-number'), String(Number(firstNumber) + 1), 'další číslo');
    equal(await page.inputValue('#sup-name'), 'Petr Svoboda', 'dodavatel se má pamatovat');
  });

  await step('data přežijí nové načtení stránky', async () => {
    await page.reload();
    await page.waitForSelector('.sheet svg');
    await go(page, 'prehled');
    equal(await page.locator('.invoice-row').count(), 1, 'počet faktur po načtení');
    assert((await page.textContent('.invoice-row')).includes('Žluťoučký kůň s.r.o.'), 'odběratel v přehledu');
  });

  await step('zaplacení přežije opakované uložení z editoru', async () => {
    await page.click('.row-actions >> text=Upravit');
    await page.waitForSelector('#inv-note');
    await go(page, 'prehled');
    await page.click('.btn-paid');
    assert((await page.textContent('.tile.is-ok .tile-value')).includes('3 086,25'), 'zaplacená částka v dlaždici');
    await go(page, 'faktura');
    await page.fill('#inv-note', 'Děkuji za platbu.');
    await saveOnly(page);
    const s = await stateOf(page);
    assert(s.invoices[0].paidAt, 'opakované uložení smazalo zaplacení');
    equal(s.invoices[0].note, 'Děkuji za platbu.', 'poznámka');
    await go(page, 'prehled');
    await page.click('text=Vrátit mezi nezaplacené');
    assert((await page.textContent('.tiles .tile:first-child .tile-value')).includes('3 086,25'), 'čekající částka v dlaždici');
  });

  await step('změna čísla otevřené faktury nabídne novou fakturu místo tichého přepsání', async () => {
    await go(page, 'faktura');
    await page.fill('#inv-number', String(Number(firstNumber) + 1));
    await page.fill('#cli-name', 'Druhý klient');
    await page.click('text=Jen uložit');
    await page.click(`text=Uložit jako novou fakturu ${Number(firstNumber) + 1}`);
    await eventually(async () => (await stateOf(page)).invoices.length === 2, 'mají být dvě faktury');
    const names = (await stateOf(page)).invoices.map((i) => i.client.name);
    assert(names.includes('Žluťoučký kůň s.r.o.') && names.includes('Druhý klient'), 'původní faktura musí zůstat: ' + names);
    await page.click('.new-invoice button');
    await page.fill('#inv-number', firstNumber);
    await page.fill('#cli-name', 'Třetí');
    await page.fill('#item-1-price', '5');
    await page.click('text=Jen uložit');
    assert((await page.textContent('.problems')).includes('už má jiná faktura'), 'stejné číslo dvakrát nesmí projít');
  });

  await step('rozepsanou fakturu přehled nezahodí bez zeptání; kopie a smazání', async () => {
    await go(page, 'prehled');
    await page.click('text=+ Nová faktura');
    assert(await page.isVisible('text=Zahodit rozepsanou fakturu?'), 'má se zeptat');
    assert((await stateOf(page)).draft.client.name === 'Třetí', 'první klepnutí nesmí nic zahodit');
    const row = page.locator('.invoice-row', { hasText: 'Druhý klient' });
    await row.locator('text=Kopie').click();
    await row.locator('text=Zahodit rozepsanou fakturu?').dblclick();
    assert(await page.isVisible('.overview-view'), 'dvojklik nesmí platit jako potvrzení');
    await page.waitForTimeout(600);
    await row.locator('text=Zahodit rozepsanou fakturu?').click();
    await page.waitForSelector('#cli-name');
    equal(await page.inputValue('#cli-name'), 'Druhý klient', 'kopie má převzít odběratele');
    equal(await page.inputValue('#inv-number'), String(Number(firstNumber) + 2), 'kopie má nové číslo');
    await saveOnly(page);
    await go(page, 'prehled');
    equal(await page.locator('.invoice-row').count(), 3, 'počet faktur po kopii');
    const first = page.locator('.invoice-row').first();
    await first.locator('text=Smazat').dblclick();
    equal(await page.locator('.invoice-row').count(), 3, 'dvojklik na Smazat nesmí mazat');
    await page.waitForTimeout(600);
    await first.locator('text=Opravdu smazat?').click();
    await eventually(async () => (await page.evaluate(() => document.activeElement?.tagName)) === 'BUTTON', 'po smazání má fokus zůstat na tlačítku');
    equal(await page.locator('.invoice-row').count(), 2, 'počet faktur po smazání');
    await page.click('text=+ Nová faktura');
    await page.waitForSelector('#inv-number');
    equal(await page.inputValue('#inv-number'), String(Number(firstNumber) + 3), 'číslo smazané faktury se nesmí použít znovu');
  });

  await step('upomínky: před splatností jen připomenutí, po splatnosti výzva a zápis', async () => {
    await go(page, 'prehled');
    const row = page.locator('.invoice-row', { hasText: 'Žluťoučký kůň' });
    await row.locator('text=Upomínka').click();
    await page.waitForSelector('#rem-subject');
    assert((await page.inputValue('#rem-subject')).includes('Blíží se splatnost'), 'předmět před splatností');
    assert(!/po splatnosti|vymáhat/.test(await page.inputValue('#rem-body')), 'text před splatností nesmí tvrdit prodlení');
    assert(await page.isDisabled('.segment >> nth=1'), 'důrazný tón má být před splatností zamčený');
    await go(page, 'prehled');
    await page.locator('.invoice-row', { hasText: 'Žluťoučký kůň' }).locator('text=Upravit').click();
    await page.waitForSelector('#inv-issued');
    await page.fill('#inv-issued', '2026-08-03');
    await eventually(async () => (await page.inputValue('#inv-due')) === '2026-08-17', 'splatnost se má posunout s datem vystavení');
    await saveOnly(page);
    await go(page, 'prehled');
    await page.locator('.invoice-row', { hasText: 'Žluťoučký kůň' }).locator('text=Upomínka').click();
    await page.waitForSelector('#rem-subject');
    assert((await page.inputValue('#rem-subject')).includes('Poslední výzva'), 'tón podle počtu dní');
    const body = await page.inputValue('#rem-body');
    assert(body.includes('3 086,25 Kč') && body.includes('2000145399/0800') && body.includes('dosud neeviduji'), 'text upomínky');
    assert(!/\b(ty|tvůj|tvoje|tobě)\b/i.test(body), 'upomínka dlužníkovi musí vykat');
    await page.click('text=Použít zákonných 11,75 %');
    await eventually(async () => (await page.inputValue('#rem-body')).includes('11,75 % ročně'), 'úrok v textu');
    await page.click('text=Zapsat jako odeslanou');
    await eventually(async () => (await page.inputValue('#rem-body')).includes('přes předchozí připomenutí'), 'další výzva má zmínit předchozí');
    await go(page, 'prehled');
    assert((await page.textContent('.invoice-list')).includes('upomenuto 1×'), 'zápis upomínky v přehledu');
  });

  await step('zaplacená faktura má v PDF místo QR kódu značku Uhrazeno', async () => {
    await page.locator('.invoice-row', { hasText: 'Žluťoučký kůň' }).locator('.btn-paid').click();
    const paid = await page.evaluate(async () => {
      const { state } = await import('./assets/js/lib/store.js');
      const { layoutInvoice } = await import('./assets/js/lib/layout.js');
      const { layoutOptions } = await import('./assets/js/views/invoice.js');
      const inv = state.invoices.find((i) => i.paidAt);
      const { pages } = layoutInvoice(inv, { ...layoutOptions(inv), measure: (t, f, z) => t.length * z * 0.5 });
      const ops = pages.flat();
      return { stamp: ops.some((op) => op.s === 'UHRAZENO'), qr: ops.some((op) => op.t === 'qr') };
    });
    assert(paid.stamp && !paid.qr, JSON.stringify(paid));
  });

  await step('hlídač limitu pro DPH počítá obrat', async () => {
    const text = await page.textContent('.turnover');
    assert(text.includes('Hlídač limitu pro DPH') && text.includes('2 000 000 Kč'), text.slice(0, 120));
    assert(/[1-9]/.test(await page.textContent('.turnover-figure strong')), 'obrat nemá být nula');
  });

  await step('záloha: export, obnova s potvrzením, poškozené soubory', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('text=Stáhnout zálohu')]);
    const file = path.join(tmp, 'zaloha.json');
    await download.saveAs(file);
    assert(JSON.parse(fs.readFileSync(file, 'utf8')).app === 'cinkne', 'záloha nemá hlavičku');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.overview-view');
    assert(await page.isVisible('text=Ukázkové faktury'), 'po smazání úložiště mají být vidět ukázky');
    await page.setInputFiles('#backup-file', file);
    await page.waitForSelector('#backup-apply');
    equal(await page.locator('.invoice-row .tag').count(), 3, 'před potvrzením se nic nemění');
    await page.click('#backup-apply');
    await eventually(async () => (await page.locator('.invoice-row').count()) === 2, 'počet faktur po obnově');
    const bad = path.join(tmp, 'spatna.json');
    fs.writeFileSync(bad, '{"nesmysl": true');
    await page.setInputFiles('#backup-file', bad);
    await eventually(async () => (await page.textContent('#toast')).includes('není platná záloha'), 'poškozený soubor má dostat srozumitelnou chybu');
    fs.writeFileSync(bad, JSON.stringify({ app: 'cinkne', data: { version: 1, invoices: [null, { id: 'x', number: '9' }], draft: null, rate: null, qr: null, reminder: null } }));
    await page.setInputFiles('#backup-file', bad);
    await page.click('#backup-apply');
    await eventually(async () => (await page.locator('.invoice-row').count()) === 1, 'neúplná záloha se má načíst vyčištěná');
    for (const route of ['faktura', 'upominky', 'qr', 'hodinovka', 'pro', 'prehled']) {
      await page.reload();
      await go(page, route);
      assert(!(await page.isVisible('text=se nepodařilo zobrazit')), `obrazovka ${route} po neúplné záloze`);
      assert((await page.textContent('#app')).length > 50, `obrazovka ${route} je prázdná`);
    }
  });
  await page.context().close();

  // ---- jednotlivé případy na čistém stavu --------------------------------

  page = await open();
  await step('QR Platba si nepamatuje ukázkový účet', async () => {
    await go(page, 'qr');
    assert(await page.isVisible('text=Ukázkový účet'), 'ukázkový účet má být označený');
    assert(await page.isDisabled('text=Uložit jako PNG'), 'kód s ukázkovým účtem nejde uložit');
    equal((await stored(page))?.qr?.account || '', '', 'ukázkový účet se nesmí uložit');
    await go(page, 'faktura');
    await fillInvoice(page);
    await page.fill('#sup-account', '2000145399/0800');
    await saveOnly(page);
    await go(page, 'qr');
    equal(await page.inputValue('#qr-account'), '2000145399/0800', 'QR obrazovka má převzít vlastní účet');
    equal(await page.inputValue('#qr-name'), 'Petr Svoboda', 'a vlastní jméno');
    await page.reload();
    await go(page, 'qr');
    equal(await page.inputValue('#qr-account'), '2000145399/0800', 'i po načtení');
  });

  await step('QR Platba: částka, PNG, příliš vysoká částka, cizí účet', async () => {
    await page.fill('#qr-amount', '450');
    await page.fill('#qr-message', 'Půlka za chatu');
    assert(await page.locator('.qr-code svg').count(), 'chybí QR kód');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('text=Uložit jako PNG')]);
    equal(download.suggestedFilename(), 'qr-platba.png', 'název PNG');
    await page.fill('#qr-amount', '10000000');
    assert((await page.textContent('.qr-card .preview-status')).includes('příliš vysoká'), 'hláška o limitu');
    equal(await page.locator('.qr-code svg').count(), 0, 'starý kód nesmí zůstat na obrazovce');
    assert(await page.isDisabled('text=Uložit jako PNG'), 'bez kódu nejde PNG uložit');
    await page.fill('#qr-amount', '15 korun');
    assert((await page.textContent('.qr-card .preview-status')).includes('Částce nerozumím'), 'nesrozumitelná částka');
    await page.fill('#qr-amount', '15 Kč');
    assert(await page.locator('.qr-code svg').count(), 'částka s Kč je v pořádku');
    await page.fill('#qr-account', 'DE89370400440532013000');
    assert((await page.textContent('.qr-card .preview-status')).includes('jen s českým účtem'), 'cizí IBAN');
  });

  await step('kalkulačka hodinovky', async () => {
    await go(page, 'hodinovka');
    equal((await page.textContent('#rate-result')).trim(), '850 Kč/h', 'výchozí hodinovka');
    await page.click('text=Výdajový paušál 40 % 20 %');
    equal((await page.textContent('#rate-result')).trim(), '900 Kč/h', 'po volbě paušálu 40 %');
    assert((await page.textContent('.rate-result')).includes('7 200 Kč'), 'denní sazba má odpovídat hodinové');
    await page.fill('#rate-currentRate', '50');
    assert((await page.textContent('.rate-compare')).includes('nepokryješ ani náklady'), 'nízká sazba');
    await page.fill('#rate-hoursPerWeek', '0');
    equal((await page.textContent('#rate-result')).trim(), 'Doplň údaje', 'nulové hodiny');
    await page.fill('#rate-hoursPerWeek', '-5');
    equal((await page.textContent('#rate-result')).trim(), 'Doplň údaje', 'záporné hodiny');
    assert(!(await page.textContent('.rate-result')).includes('-'), 'žádná záporná čísla ve výsledku');
  });
  await page.context().close();

  page = await open();
  await step('PDF se vyrobí i s číslem jako FA-2026--001 a exotickými znaky', async () => {
    await fillInvoice(page);
    await page.fill('#inv-number', 'FA-2026--001');
    await page.fill('#item-1-unit', '...');
    await page.fill('#sup-dic', 'CZ::12 -> x');
    await page.fill('#inv-note', 'Děkuji 🚀');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('text=Uložit a stáhnout PDF')]);
    equal(download.suggestedFilename(), 'faktura-FA-2026-001.pdf', 'název souboru');
    await eventually(async () => (await page.textContent('#toast')).includes('písmo neumí'), 'upozornění na chybějící znak');
  });

  await step('faktura v eurech: SEPA QR, anglické popisky, kurz u plátce', async () => {
    await page.selectOption('#inv-currency', 'EUR');
    await page.selectOption('#inv-lang', 'en');
    await statusHas(page, 'SEPA QR');
    await eventually(async () => (await sheetText(page)).includes('INVOICE'), 'náhled má být anglicky');
    const text = await sheetText(page);
    for (const part of ['INVOICE', 'SUPPLIER', 'Total due', 'SEPA QR', 'Not registered for VAT.']) assert(text.includes(part), 'v náhledu chybí ' + part);
    assert((await draftSpayd(page)).startsWith('BCD\n002\n1\nSCT\n'), 'kód má být SEPA QR');
    assert(!(await page.isVisible('#inv-rate')), 'neplátce kurz nepotřebuje');
    await page.check('#sup-vat');
    assert(await page.isVisible('#inv-rate'), 'plátce v eurech vyplňuje kurz');
    await page.fill('#sup-dic', 'CZ12345679');
    await page.click('text=Jen uložit');
    assert((await page.textContent('.problems')).includes('doplň kurz'), 'bez kurzu nejde uložit');
    await page.fill('#inv-rate', '24,5');
    await eventually(async () => (await sheetText(page)).includes('in Czech currency'), 'DPH v korunách na faktuře');
  });

  await step('našeptávač odběratele nepřepíše, co už je vyplněné', async () => {
    await page.selectOption('#inv-currency', 'CZK');
    await page.uncheck('#sup-vat');
    await page.fill('#inv-number', '20260050');
    await page.fill('#cli-name', 'Klient');
    await page.fill('#cli-street', 'Stará 1');
    await page.fill('#cli-ico', '12345679');
    await page.click('text=Jen uložit');
    await page.click('text=Přečíslovat fakturu FA-2026--001');
    await eventually(async () => (await page.textContent('.save-status')).includes('20260050 je uložená'), 'přečíslovaná faktura se má uložit');
    equal((await stateOf(page)).invoices.length, 1, 'přečíslování nemá přidat fakturu');
    await page.click('.new-invoice button');
    await page.fill('#cli-ico', '87654326');
    await page.locator('#cli-name').pressSequentially('Klient Nový s.r.o.');
    equal(await page.inputValue('#cli-ico'), '87654326', 'vyplněné IČO má zůstat');
    equal(await page.inputValue('#cli-street'), '', 'psaní jména nemá doplňovat cizí adresu');
  });
  await page.context().close();

  page = await open({}, { init: () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (window.__storageFull) throw new DOMException('quota', 'QuotaExceededError');
      return real.call(this, key, value);
    };
  } });
  await step('plné úložiště: uložení přizná neúspěch', async () => {
    await fillInvoice(page);
    await page.evaluate(() => { window.__storageFull = true; });
    await page.click('text=Jen uložit');
    await eventually(async () => (await page.textContent('.save-status')).includes('nepodařilo uložit'), 'stav má přiznat neúspěch');
    assert(await page.isVisible('#storage-note'), 'trvalé upozornění na neukládání');
  });
  await page.context().close();

  page = await open();
  await step('poškozená uložená data aplikaci nerozbijí', async () => {
    for (const broken of ['{"version":1,"invoices":[null],"draft":null,"rate":null,"qr":null}', '{"version":1,"draft":{"items":"x"},"invoices":"nic"}', 'nesmysl', '[]']) {
      await page.evaluate((v) => localStorage.setItem('cinkne:v1', v), broken);
      for (const route of ['faktura', 'prehled', 'upominky', 'qr', 'hodinovka']) {
        await page.goto(base + '#' + route);
        await page.reload();
        await page.waitForFunction(() => document.querySelector('#app').textContent.length > 50);
        assert(!(await page.isVisible('text=se nepodařilo zobrazit')), `${route} s daty ${broken.slice(0, 30)}`);
      }
    }
  });
  await page.context().close();

  page = await open();
  await step('ukázku nejde uložit jako svou; po prvním uložení zmizí a vlastní údaje zůstanou', async () => {
    await page.click('text=Jen uložit');
    assert((await page.textContent('.problems')).includes('ukázkové hodnoty'), 'ukázkové údaje dodavatele nesmí projít');
    await page.fill('#sup-name', 'Petr Svoboda');
    await page.fill('#sup-ico', '');
    await page.fill('#sup-email', 'petr@svoboda.test');
    await page.fill('#sup-account', '2000145399/0800');
    await saveOnly(page);
    assert(!(await page.isVisible('.notice-example')), 'po uložení už nemá být vidět upozornění na ukázku');
    const s1 = await stateOf(page);
    equal(s1.profile.account, '2000145399/0800', 'vlastní účet v profilu');
    await go(page, 'qr');
    equal(await page.inputValue('#qr-account'), '2000145399/0800', 'QR obrazovka nabízí vlastní účet');
  });
  await page.context().close();

  page = await open();
  await step('po skrytí ukázky se ukázkový účet nikde nenabízí jako vlastní', async () => {
    await page.click('.notice-example >> text=Skrýt');
    await go(page, 'qr');
    assert(await page.isVisible('text=Ukázkový účet') || (await page.inputValue('#qr-account')) === '', 'ukázkový účet bez označení');
    assert(await page.isDisabled('text=Uložit jako PNG'), 'kód s ukázkovým účtem nejde uložit');
    await eventually(async () => (await stored(page))?.profile?.account === '', 'ukázkový účet není v profilu');
  });

  await step('ruční psaní data vystavení neodnese splatnost o staletí', async () => {
    await go(page, 'faktura');
    await page.focus('#inv-issued');
    await page.keyboard.type('01052027');
    await eventually(async () => (await page.inputValue('#inv-issued')) === '2027-01-05' || (await page.inputValue('#inv-issued')), 'datum vystavení má být 5. 1. 2027');
    equal(await page.inputValue('#inv-due'), '2027-01-19', 'splatnost se má posunout o stejných 14 dní');
    equal(await page.inputValue('#inv-duzp'), '2027-01-05', 'datum plnění se má posunout s datem vystavení');
  });
  await page.context().close();

  page = await open();
  await step('našeptávač: výběr jiného odběratele nahradí údaje toho předchozího, novější adresa má přednost', async () => {
    const make = async (number, name, street) => {
      await page.fill('#inv-number', number);
      await page.fill('#cli-name', name);
      await page.fill('#cli-street', street);
      await saveOnly(page);
      await page.click('.new-invoice button');
    };
    await fillInvoice(page, { client: 'ACME' });
    await make('20260001', 'ACME', 'Stará adresa 1');
    await page.fill('#item-1-price', '10');
    await make('20260002', 'ACME', 'Nová adresa 9');
    await page.fill('#item-1-price', '10');
    await make('20260003', 'Beta a.s.', 'Betová 5');
    const pick = (name) => page.evaluate((value) => {
      const input = document.querySelector('#cli-name');
      input.value = value;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
    }, name);
    await pick('ACME');
    equal(await page.inputValue('#cli-street'), 'Nová adresa 9', 'adresa z poslední faktury odběratele');
    await pick('Beta a.s.');
    equal(await page.inputValue('#cli-street'), 'Betová 5', 'po výběru jiného odběratele nesmí zůstat adresa předchozího');
    await page.fill('#cli-street', 'Ručně napsaná 3');
    await pick('ACME');
    equal(await page.inputValue('#cli-street'), 'Ručně napsaná 3', 'ručně napsanou adresu výběr nepřepíše');
  });

  await step('dvě okna: rozepsaná faktura v jednom přežije uložení ve druhém', async () => {
    const other = await page.context().newPage();
    other.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    await other.goto(base);
    await other.waitForSelector('.sheet svg');
    // v prvním okně je rozepsáno a kurzor zůstává v poli
    await page.fill('#cli-name', 'Rozepsaný v okně A');
    await page.fill('#item-1-price', '777');
    await page.focus('#inv-note');
    await page.waitForTimeout(400);
    // druhé okno mezitím uloží jinou fakturu
    await other.fill('#cli-name', 'Uložený z okna B');
    await other.fill('#item-1-price', '55');
    await other.click('text=Jen uložit');
    await eventually(async () => (await other.textContent('.save-status')).includes('je uložená'), 'okno B má uložit');
    await page.waitForTimeout(300);
    await page.keyboard.type('Poznámka psaná po uložení ve druhém okně');
    equal(await page.inputValue('#cli-name'), 'Rozepsaný v okně A', 'rozepsaný odběratel zůstal');
    await eventually(async () => (await sheetText(page)).includes('Poznámka psaná po uložení ve druhém okně'), 'náhled dál sleduje, co se píše');
    await page.click('text=Jen uložit');
    assert((await page.textContent('.problems')).includes('už má jiná faktura'), 'číslo mezitím obsadilo druhé okno a aplikace to má říct');
    await page.fill('#inv-number', '20260099');
    await page.click('text=Jen uložit');
    await eventually(async () => {
      const names = (await stored(page)).invoices.map((i) => i.client.name);
      return (names.includes('Rozepsaný v okně A') && names.includes('Uložený z okna B')) || names.join(', ');
    }, 'v úložišti mají být faktury z obou oken');
    const mine = (await stored(page)).invoices.find((i) => i.client.name === 'Rozepsaný v okně A');
    equal(mine.note, 'Poznámka psaná po uložení ve druhém okně', 'uložila se faktura, kterou okno ukazovalo');
    await other.close();
  });
  await page.context().close();

  // ---- rozložení ---------------------------------------------------------

  page = await open();
  await step('žádná obrazovka nepřetéká na šířku (1280 px), navigace vrací nahoru a mění titulek', async () => {
    for (const vatPayer of [false, true]) {
      if (vatPayer) {
        await go(page, 'faktura');
        await page.check('#sup-vat');
      }
      for (const route of ['faktura', 'prehled', 'upominky', 'qr', 'hodinovka', 'pro']) {
        await go(page, route);
        await noOverflow(page, route);
        const leak = /(^|[^\p{L}])(false|undefined|NaN|null)([^\p{L}]|$)|\[object/u.exec(await page.evaluate(() => document.body.innerText));
        assert(!leak, `na obrazovce ${route} je vidět „${leak && leak[0].trim()}“`);
      }
    }
    await go(page, 'faktura');
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.click('[data-route="prehled"]');
    await eventually(async () => (await page.evaluate(() => window.scrollY)) === 0, 'po přechodu má být stránka nahoře');
    equal(await page.title(), 'Přehled – Cinkne', 'titulek přehledu');
  });
  await page.context().close();

  page = await open({ viewport: { width: 360, height: 740 }, colorScheme: 'dark' });
  await step('telefon v tmavém režimu: nic nepřetéká', async () => {
    await page.check('#sup-vat');
    await page.selectOption('#inv-currency', 'EUR');
    for (const width of [360, 320]) {
      await page.setViewportSize({ width, height: 740 });
      for (const route of ['faktura', 'prehled', 'upominky', 'qr', 'hodinovka', 'pro']) {
        await go(page, route);
        await noOverflow(page, `${route} (${width} px)`);
      }
    }
  });
  await page.context().close();

  page = await open();
  await step('odkaz se žádostí o platbu: nový i starý tvar, varování, nesmysl', async () => {
    const payload = b64url({ a: '19-2000145399/0800', m: '450', v: '12AB34567890123', t: 'Večeře <b>x</b>', n: 'Jana' });
    await page.goto(base + '#p=' + payload);
    await page.waitForSelector('.qr-code svg');
    assert((await page.textContent('.qr-form h2')).includes('Jana tě žádá o platbu'), 'nadpis žádosti');
    assert((await page.textContent('.qr-form')).includes('Jméno v odkazu si může napsat kdokoli'), 'varování');
    assert((await page.textContent('.qr-facts')).includes('4567890123'), 'zobrazený VS má odpovídat kódu');
    equal(await page.locator('.qr-facts b').count(), 0, 'text z odkazu se nesmí vykreslit jako HTML');
    equal((await stored(page))?.qr?.account || '', '', 'žádost se neukládá');
    await page.goto(base + '?p=' + payload);
    await page.waitForSelector('.qr-code svg');
    await page.goto(base + '#p=%%%nesmysl');
    await page.reload();
    await page.waitForSelector('.sheet svg');
  });
  await page.context().close();

  page = await open({}, { config: PAID_CONFIG });
  await step('placený režim: zamčené funkce, platba QR i kartou, odemčení kódem', async () => {
    assert((await sheetText(page)).includes('Vystaveno zdarma v aplikaci Cinkne'), 'patička na faktuře zdarma');
    assert(await page.isDisabled('#sup-logo'), 'logo má být zamčené');
    await go(page, 'pro');
    equal(await page.getAttribute('.pay-way a', 'href'), 'https://example.test/pay', 'platební odkaz');
    assert(await page.locator('.pay-qr .qr-code svg').count(), 'QR Platba za Pro');
    assert((await page.textContent('.pay-qr')).includes('provoz@example.test'), 'kontakt pro zaslání kódu');
    assert((await page.textContent('.privacy')).includes('IČO 12345679'), 'údaje provozovatele');
    await page.fill('#pro-code', 'spatny-kod');
    await page.click('text=Odemknout');
    await eventually(async () => (await page.textContent('#pro-code-hint')).includes('neznám'), 'špatný kód');
    await page.fill('#pro-code', ' cink–test test-TEST ');
    await page.click('text=Odemknout');
    await eventually(async () => (await page.textContent('.plan-pro')).includes('Máš odemčeno'), 'odemčení kódem s jinými pomlčkami');
    await go(page, 'faktura');
    assert(!(await sheetText(page)).includes('Vystaveno zdarma v aplikaci Cinkne'), 'po odemčení bez patičky');
    assert(!(await page.isDisabled('#sup-logo')), 'po odemčení jde nahrát logo');
    await go(page, 'qr');
    assert(!(await page.isVisible('text=Kopírovat odkaz se žádostí')) || await page.isDisabled('text=Kopírovat odkaz se žádostí'), 'ukázkový účet nejde sdílet');
    await page.fill('#qr-account', '2000145399/0800');
    assert(await page.isEnabled('text=Kopírovat odkaz se žádostí'), 'sdílení odkazem při nastavené adrese webu');
  });
  await page.context().close();

  await step('během testů nevznikla chyba v konzoli ani neúspěšný požadavek', async () => {
    assert(problems.length === 0, problems.join('\n'));
  });

  await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} z ${results.length} kroků v pořádku`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
