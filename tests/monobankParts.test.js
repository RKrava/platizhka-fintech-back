const test = require('node:test');
const assert = require('node:assert/strict');
const { installAxiosMock, freshRequire } = require('./helpers');

const axios = installAxiosMock();
freshRequire('../src/payments/providers/monobankAcquiring');
const provider = freshRequire('../src/payments/providers/monobankParts');

test('mono_parts: code is mono_parts but uses Mono endpoint', () => {
  assert.equal(provider.code, 'mono_parts');
});

test('mono_parts: createInvoice prefixes description with [Купити частинами]', async () => {
  axios.reset();
  let captured;
  axios.setRoute('post', /invoice\/create$/, (cfg) => {
    captured = cfg.data;
    return { data: { invoiceId: 'i', pageUrl: 'https://x' } };
  });

  await provider.createInvoice({
    amount: 100,
    currency: 'UAH',
    orderRef: 'r1',
    description: 'Замовлення №42',
    items: [{ name: 'товар', qty: 1, price: 100 }],
    returnUrl: 'https://x',
    webhookUrl: 'https://x',
    credentials: { token: 'T' },
  });

  assert.match(captured.merchantPaymInfo.destination, /Купити частинами/);
});

test('mono_parts: shares resolveCredentials with mono', () => {
  const c = provider.resolveCredentials({ merchant_token: 'live' }, { isTest: false });
  assert.deepEqual(c, { token: 'live', isTest: false });
});
