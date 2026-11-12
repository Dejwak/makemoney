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
    console.log('FAIL ' + name + '\n     ' + String(err && err.message ? err.message : err).split('\n').join('\n     '));
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}
function equal(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: čekal jsem ${JSON.stringify(expected)}, je ${JSON.stringify(actual)}`);
}

const PAID_CONFIG = `export default {
  siteUrl: 'https://example.test/',
  owner: { name: 'Provozovatel', account: '19-2000145399/0800', email: 'provoz@example.test' },
  pro: { enabled: true, priceCzk: 290, paymentUrl: 'https://example.test/pay',
    licenseHashes: ['57f6d9150cd6400651862682c8e02cea30f4e6b5d37fc459500da1f08dff94d2'] },
};`; // otisk kódu CINK-TEST-TEST-TEST

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cinkne-e2e-'));
  const problems = [];

  async function open(options = {}, configBody = null) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...options });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('requestfailed', (r) => problems.push('requestfailed: ' + r.url()));
    if (configBody) await page.route('**/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: configBody }));
    await page.goto(base);
    await page.waitForSelector('.sheet svg');
    return page;
  }
  const go = async (page, route) => {
    await page.goto(base + '#' + route);
    await page.waitForTimeout(150);
  };
  const noOverflow = async (page, label) => {
    const o = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(o[0] <= o[1], `${label}: stránka přetéká do šířky (${o[0]} > ${o[1]})`);
  };
  const sheetText = (page) => page.evaluate(() => document.querySelector('.preview-pages').textContent);

  let page = await open();

  await step('první načtení ukáže ukázkovou fakturu s QR Platbou', async () => {
    assert(await page.isVisible('.notice-example'), 'chybí upozornění na ukázková data');
    equal((await page.textContent('#inv-total')).trim(), '12 300,00 Kč', 'celkem');
    assert((await sheetText(page)).includes('QR Platba'), 'v náhledu chybí QR Platba');
    equal(await page.getAttribute('#slip-amount', 'aria-label'), '12 300,00', 'částka v platebním příkazu');
  });

  await step('prázdná faktura neprojde kontrolou a řekne proč', async () => {
    await page.click('text=Začít s prázdnou fakturou');
    await page.click('text=Jen uložit');
    const text = await page.textContent('.problems');
    assert(text.includes('Doplň své jméno') && text.includes('Doplň odběratele') && text.includes('položku s cenou'), 'chybí hlášky: ' + text);
    await go(page, 'prehled');
    assert(await page.isVisible('text=Ukázkové faktury'), 'neuložená faktura se nesmí dostat do přehledu');
    await go(page, 'faktura');
  });

  await step('vyplnění faktury, desetinná čárka a neplatný účet', async () => {
    await page.fill('#sup-name', 'Petr Svoboda');
    await page.fill('#sup-ico', '12345679');
    await page.fill('#sup-account', '123/0100x');
    assert((await page.textContent('#sup-account-hint')).includes('nesedí'), 'neplatný účet má dostat nápovědu');
    assert((await page.textContent('.preview-status')).includes('QR kód na faktuře nebude'), 'stav náhledu pro neplatný účet');
    await page.fill('#sup-account', '19-2000145399/0800');
    await page.fill('#cli-name', 'Žluťoučký kůň s.r.o.');
    await page.fill('#item-1-desc', 'Konzultace');
    await page.fill('#item-1-qty', '2,5');
    await page.fill('#item-1-unit', 'hod');
    await page.fill('#item-1-price', '1 234,50');
    await page.waitForTimeout(100);
    equal((await page.textContent('#inv-total')).trim(), '3 086,25 Kč', 'celkem');
    const spayd = await page.evaluate(async () => {
      const { state } = await import('./assets/js/lib/store.js');
      const { invoicePayment } = await import('./assets/js/lib/payment.js');
      return invoicePayment(state.draft).spayd;
    });
    assert(/^SPD\*1\.0\*ACC:CZ6508000000192000145399\*AM:3086\.25\*CC:CZK\*MSG:FAKTURA \d+\*RN:PETR SVOBODA\*X-VS:\d+$/.test(spayd), 'SPAYD: ' + spayd);
  });

  await step('plátce DPH se dvěma sazbami', async () => {
    await page.check('#sup-vat');
    await page.click('text=+ Přidat položku');
    await page.fill('#item-2-desc', 'Kniha');
    await page.fill('#item-2-price', '1000');
    await page.selectOption('#item-2-vat', '12');
    await page.waitForTimeout(100);
    equal((await page.textContent('#inv-total')).trim(), '4 854,36 Kč', 'celkem s DPH'); // 3086,25 × 1,21 + 1000 × 1,12
    const text = await sheetText(page);
    assert(text.includes('FAKTURA – DAŇOVÝ DOKLAD') && text.includes('Základ 12 %') && text.includes('DPH 21 %'), 'rekapitulace DPH v náhledu');
    await page.uncheck('#sup-vat');
    await page.click('[aria-label="Odebrat položku 2"]');
    await page.waitForTimeout(100);
    equal((await page.textContent('#inv-total')).trim(), '3 086,25 Kč', 'celkem po návratu');
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
  });

  await step('opakované uložení fakturu nezdvojí a nová dostane další číslo', async () => {
    await page.fill('#inv-note', 'Děkuji.');
    await page.click('text=Jen uložit');
    await go(page, 'prehled');
    equal(await page.locator('.invoice-row').count(), 1, 'počet faktur v přehledu');
    await page.click('text=+ Nová faktura');
    await page.waitForTimeout(150);
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

  await step('přehled: zaplaceno, zpět, kopie a smazání', async () => {
    await page.click('.btn-paid');
    assert((await page.textContent('.tile.is-ok .tile-value')).includes('3 086,25'), 'zaplacená částka v dlaždici');
    assert((await page.textContent('.invoice-row')).includes('Zaplaceno'), 'stav řádku');
    await page.click('text=Vrátit mezi nezaplacené');
    assert((await page.textContent('.tiles .tile:first-child .tile-value')).includes('3 086,25'), 'čekající částka v dlaždici');
    await page.click('.row-actions >> text=Kopie');
    await page.waitForTimeout(150);
    equal(await page.inputValue('#cli-name'), 'Žluťoučký kůň s.r.o.', 'kopie má převzít odběratele');
    equal(await page.inputValue('#inv-number'), String(Number(firstNumber) + 1), 'kopie má nové číslo');
    await page.click('text=Jen uložit');
    await go(page, 'prehled');
    equal(await page.locator('.invoice-row').count(), 2, 'počet faktur po kopii');
    const del = page.locator('.invoice-row').first().locator('text=Smazat');
    await del.click();
    await page.locator('.invoice-row').first().locator('text=Opravdu smazat?').click();
    equal(await page.locator('.invoice-row').count(), 1, 'počet faktur po smazání');
  });

  await step('upomínka k faktuře po splatnosti a její zápis', async () => {
    await page.click('.row-actions >> text=Upravit');
    await page.waitForTimeout(150);
    await page.fill('#inv-issued', '2026-01-05');
    await page.fill('#inv-due', '2026-01-19');
    await page.click('text=Jen uložit');
    await go(page, 'prehled');
    assert((await page.textContent('.invoice-row')).includes('po splatnosti'), 'faktura má být po splatnosti');
    await page.click('.row-actions >> text=Upomínka');
    await page.waitForTimeout(150);
    assert((await page.inputValue('#rem-subject')).includes('Poslední výzva'), 'tón podle počtu dní');
    const body = await page.inputValue('#rem-body');
    assert(body.includes('3 086,25 Kč') && body.includes('19-2000145399/0800'), 'text upomínky nese částku a účet');
    assert(!/\bty\b|\btvoj/i.test(body), 'upomínka dlužníkovi musí vykat');
    await page.click('text=Zapsat jako odeslanou');
    await go(page, 'prehled');
    assert((await page.textContent('.invoice-row')).includes('upomenuto 1×'), 'zápis upomínky v přehledu');
  });

  await step('zaplacená faktura má v PDF místo QR kódu značku Uhrazeno', async () => {
    await page.click('.btn-paid');
    const paid = await page.evaluate(async () => {
      const { state } = await import('./assets/js/lib/store.js');
      const { layoutInvoice } = await import('./assets/js/lib/layout.js');
      const { layoutOptions } = await import('./assets/js/views/invoice.js');
      const inv = state.invoices[0];
      const { pages } = layoutInvoice(inv, { ...layoutOptions(inv), measure: (t, f, z) => t.length * z * 0.5 });
      const ops = pages.flat();
      return { stamp: ops.some((op) => op.s === 'UHRAZENO'), qr: ops.some((op) => op.t === 'qr') };
    });
    assert(paid.stamp && !paid.qr, JSON.stringify(paid));
  });

  await step('záloha: export, smazání úložiště a obnova', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('text=Stáhnout zálohu')]);
    const file = path.join(tmp, 'zaloha.json');
    await download.saveAs(file);
    assert(JSON.parse(fs.readFileSync(file, 'utf8')).app === 'cinkne', 'záloha nemá hlavičku');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.overview-view');
    assert(await page.isVisible('text=Ukázkové faktury'), 'po smazání úložiště mají být vidět ukázky');
    await page.setInputFiles('#backup-file', file);
    await page.waitForTimeout(200);
    equal(await page.locator('.invoice-row').count(), 1, 'počet faktur po obnově');
    const bad = path.join(tmp, 'spatna.json');
    fs.writeFileSync(bad, '{"nesmysl": true');
    await page.setInputFiles('#backup-file', bad);
    await page.waitForTimeout(200);
    assert((await page.textContent('#toast')).includes('není platná záloha'), 'poškozený soubor má dostat srozumitelnou chybu');
    equal(await page.locator('.invoice-row').count(), 1, 'poškozená záloha nesmí smazat data');
  });

  await step('QR Platba: kód, PNG a kalkulačka hodinovky', async () => {
    await go(page, 'qr');
    await page.fill('#qr-amount', '450');
    await page.fill('#qr-message', 'Půlka za chatu');
    assert(await page.locator('.qr-code svg').count(), 'chybí QR kód');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('text=Uložit jako PNG')]);
    equal(download.suggestedFilename(), 'qr-platba.png', 'název PNG');
    await page.fill('#qr-account', '123');
    assert(await page.isDisabled('text=Uložit jako PNG'), 'bez platného účtu nejde PNG uložit');
    await go(page, 'hodinovka');
    equal((await page.textContent('#rate-result')).trim(), '900 Kč / hod', 'výchozí hodinovka');
    await page.fill('#rate-hoursPerWeek', '0');
    equal((await page.textContent('#rate-result')).trim(), 'Doplň údaje', 'nulové hodiny');
  });

  await step('žádná obrazovka nepřetéká na šířku (1280 px)', async () => {
    for (const route of ['faktura', 'prehled', 'upominky', 'qr', 'hodinovka', 'pro']) {
      await go(page, route);
      await noOverflow(page, route);
    }
  });
  await page.context().close();

  page = await open({ viewport: { width: 360, height: 740 }, colorScheme: 'dark' });
  await step('telefon v tmavém režimu: nic nepřetéká', async () => {
    await page.check('#sup-vat');
    for (const route of ['faktura', 'prehled', 'upominky', 'qr', 'hodinovka', 'pro']) {
      await go(page, route);
      await noOverflow(page, route + ' (360 px)');
    }
  });
  await page.context().close();

  page = await open();
  await step('odkaz se žádostí o platbu otevře QR Platbu a nerozbije se na nesmyslu', async () => {
    const payload = Buffer.from(JSON.stringify({ a: '19-2000145399/0800', m: '450', v: '123', t: 'Večeře', n: 'Jana' }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await page.goto(base + '?p=' + payload);
    await page.waitForSelector('.qr-code svg');
    assert((await page.textContent('.qr-layout h2')).includes('Jana tě žádá o platbu'), 'nadpis žádosti');
    await page.goto(base + '?p=%%%nesmysl');
    await page.waitForSelector('.sheet svg');
  });
  await page.context().close();

  page = await open({}, PAID_CONFIG);
  await step('placený režim: zamčené funkce, platba QR i kartou, odemčení kódem', async () => {
    assert((await sheetText(page)).includes('Vystaveno zdarma v aplikaci Cinkne'), 'patička na faktuře zdarma');
    assert(await page.isDisabled('#sup-logo'), 'logo má být zamčené');
    await go(page, 'pro');
    equal(await page.getAttribute('.pay-way a', 'href'), 'https://example.test/pay', 'platební odkaz');
    assert(await page.locator('.pay-qr .qr-code svg').count(), 'QR Platba za Pro');
    assert((await page.textContent('.pay-qr')).includes('provoz@example.test'), 'kontakt pro zaslání kódu');
    await page.fill('#pro-code', 'spatny-kod');
    await page.click('text=Odemknout');
    await page.waitForTimeout(150);
    assert((await page.textContent('#pro-code-hint')).includes('neznám'), 'špatný kód');
    await page.fill('#pro-code', 'cink-test-test-test');
    await page.click('text=Odemknout');
    await page.waitForTimeout(200);
    assert((await page.textContent('.plan-pro')).includes('Máš odemčeno'), 'odemčení');
    await go(page, 'faktura');
    assert(!(await sheetText(page)).includes('Vystaveno zdarma v aplikaci Cinkne'), 'po odemčení bez patičky');
    assert(!(await page.isDisabled('#sup-logo')), 'po odemčení jde nahrát logo');
    await go(page, 'qr');
    assert(await page.isVisible('text=Kopírovat odkaz s žádostí'), 'sdílení odkazem při nastavené adrese webu');
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
