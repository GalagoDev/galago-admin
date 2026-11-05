/* eslint-disable @typescript-eslint/no-require-imports -- Isolated intake tests with mocked APIs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
const load = Module._load;
Module._resolveFilename = function(request, parent, ...rest) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request, parent, ...rest);
};
Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
let responses = [], requests = [];
Module._load = function(request, parent, isMain) {
  if (request === 'openai') return class {
    chat = { completions: { create: async (input) => {
      requests.push(input);
      assert.ok(responses.length, 'unexpected extra AI request');
      return { choices: [{ message: { content: JSON.stringify(responses.shift()) } }] };
    } } };
  };
  return load.call(this, request, parent, isMain);
};
process.env.OPENAI_API_KEY = 'test-only';
const phone = require('../src/lib/order-phone.ts');
const telegram = require('../src/lib/telegram-openai-orders.ts');
const apps = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'shopify-webhook.gs'), 'utf8'), apps);

const cases = [
  ['061 123 456', '38761123456'], ['061 123 450', '38761123450'],
  ['066-097-765', '38766097765'], ['067 129 6610', '387671296610'],
  ['0603577777', '387603577777'], ['064 417 0826', '387644170826'],
  ['+387 61 123 456', '38761123456'], ['00387 61 123 456', '38761123456'],
  ['00387 (0)61 123 456', '38761123456'], ['+387 (0)61 123 456', '38761123456'],
  ['(061) 123/456', '38761123456'], ['035 123 456', '38735123456'],
  ['61 123 456', '38761123456'], ['+385 91 123 4567', '385911234567'],
  ['0049 151 12345678', '4915112345678'], ['387611234567890', '387611234567890'],
];
for (const [raw, expected] of cases) {
  assert.equal(phone.normalizeOrderPhone(raw), expected, raw);
  assert.equal(apps.normalizePhone_(raw), expected, `Apps Script: ${raw}`);
}
for (const raw of ['', '06631318', '3876631318', '387611234567890', '061123456/062222333', '061X23456']) {
  assert.equal(phone.isUsableOrderPhone(raw), false, raw);
}
for (const [raw] of cases.slice(0, -1)) assert.ok(phone.isUsableOrderPhone(raw), raw);
assert.equal(phone.resolveOrderPhone('Kupac 067 129 6610\n2x Zola\nSDS 209\nPaketa 2', '38767129661'), '387671296610');
assert.equal(phone.resolveOrderPhone('061 123 456\n75000 Tuzla\nSDS 89', '38761123459'), '38761123456');
assert.equal(phone.resolveOrderPhone('061123456 / 061 123 456'), '38761123456');
assert.throws(() => phone.resolveOrderPhone('061123456 / 062222333'), /više/);
assert.throws(() => phone.resolveOrderPhone('06631318\nLewa 95', '38766313180'), /nije potpun/);
assert.throws(() => phone.resolveOrderPhone('Kupac bez telefona', '38761123456'), /nedostaje/);
assert.throws(() => phone.verifyImagePhone('061123456', '061123459'), /pouzdano/);
phone.verifyImagePhone('00387 61 123 456', '+387 (0)61 123 456');

const shopify = apps.mapShopifyOrder_({
  shipping_address: { name: 'Test kupac', phone: '0038761939205', zip: '71000' },
  phone: '061000001', billing_address: { phone: '061000002' }, customer: { phone: '061000003' },
  line_items: [{ name: 'Tanzi', quantity: 1, price: '89' }], total_price: '89',
});
assert.equal(shopify.brojTelefona, '38761939205');
assert.equal(shopify.phoneOriginal, '0038761939205');
assert.equal(shopify.phoneSource, 'shipping_address.phone');
assert.equal(apps.mapShopifyOrder_({ shipping_address: { phone: ' ' }, phone: '0671296610', customer: { phone: '061000000' } }).brojTelefona, '387671296610');
assert.equal(apps.mapShopifyOrder_({ shipping_address: { phone: '06631318' }, customer: { phone: '061000000' } }).brojTelefona, '3876631318', 'do not silently substitute another person or guess a digit');

const modelOrder = { primalac: 'Test kupac', brojTelefona: '38767129661', grad: '75000', adresa: 'Test 12', artikal: 'Zola set', brojPaketa: '1', ukupanIznos: '209' };
const reset = (...items) => { responses = items; requests = []; };
(async () => {
  reset(modelOrder);
  const result = await telegram.extractTelegramOrderFromText('Test kupac\n067 129 6610\n75000 Tuzla, Test 12\nZola set\nSDS 209\nPaketa 2');
  assert.equal(result.brojTelefona, '387671296610', 'source wins over truncated AI output');
  assert.equal(result.artikal, 'Zola set');
  assert.equal(result.brojPaketa, '2');
  assert.equal(result.otkupnina, '209');
  assert.equal(result.dop, '1');
  assert.equal(result.zamjena, '0');
  assert.equal(requests.length, 1);
  reset({ ...modelOrder, brojTelefona: '38761123459' });
  assert.equal((await telegram.extractTelegramOrderFromText('Test kupac\n061123456\n75000 Tuzla\nZola set SDS 209')).brojTelefona, '38761123456');
  reset(modelOrder);
  await assert.rejects(telegram.extractTelegramOrderFromText('Test kupac\n06631318\n75000 Tuzla\nZola SDS 209'), /nije potpun/);
  const image = { imageBytes: new ArrayBuffer(1), mimeType: 'image/png', caption: 'Zola set\nSDS 209' };
  reset({ ...modelOrder, brojTelefona: '061123456' }, { phone: '061123459' });
  await assert.rejects(telegram.extractTelegramOrderFromImage(image), /pouzdano/);
  assert.equal(requests.length, 2);
  assert.ok(!JSON.stringify(requests[1]).includes('061123456'), 'independent reading must not be anchored to first result');
  reset({ ...modelOrder, brojTelefona: '0671296610' }, { phone: '067 129 6610' });
  assert.equal((await telegram.extractTelegramOrderFromImage(image)).brojTelefona, '387671296610');
  reset({ ...modelOrder, brojTelefona: '' });
  assert.equal((await telegram.extractTelegramOrderFromImage({ ...image, caption: 'Telefon: 061123456\nZola set\nSDS 209' })).brojTelefona, '38761123456');
  assert.equal(requests.length, 1, 'explicit caption phone does not need another model read');
  reset({ ...modelOrder, brojTelefona: '' });
  const captionPhoneLast = await telegram.extractTelegramOrderFromImage({ ...image, caption: 'Zola set\nSDS 209\nTelefon: 061123456' });
  assert.equal(captionPhoneLast.artikal, 'Zola set');
  assert.equal(captionPhoneLast.otkupnina, '209');
  console.log('Phone normalization, Shopify mapping and Telegram extraction regression tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
