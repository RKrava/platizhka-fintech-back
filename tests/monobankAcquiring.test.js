const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { installAxiosMock, freshRequire } = require('./helpers');

const axios = installAxiosMock();
const provider = freshRequire('../src/payments/providers/monobankAcquiring');

test('mono: code/name + interface', () => {
  assert.equal(provider.code, 'mono');
  for (const m of ['resolveCredentials', 'createInvoice', 'verifyWebhook', 'parseWebhook', 'getInvoice']) {
    assert.equal(typeof provider[m], 'function', `missing ${m}`);
  }
});

test('mono: resolveCredentials in live mode requires merchant_token', () => {
  assert.throws(() => provider.resolveCredentials({}, { isTest: false }), /merchant_token/);
  assert.deepEqual(
    provider.resolveCredentials({ merchant_token: 'live-tok' }, { isTest: false }),
    { token: 'live-tok', isTest: false },
  );
});

test('mono: resolveCredentials in test mode falls back to public sandbox', () => {
  delete process.env.MONO_TEST_TOKEN;
  const c = provider.resolveCredentials({}, { isTest: true });
  assert.equal(typeof c.token, 'string');
  assert.match(c.token, /^[\w-]{20,}$/);
  assert.equal(c.isTest, true);
});

test('mono: resolveCredentials test mode prefers MONO_TEST_TOKEN env', () => {
  process.env.MONO_TEST_TOKEN = 'env-token';
  const c = provider.resolveCredentials({ merchant_token: 'live' }, { isTest: true });
  assert.equal(c.token, 'env-token');
  delete process.env.MONO_TEST_TOKEN;
});

test('mono: resolveCredentials test mode prefers merchant test_token over sandbox', () => {
  delete process.env.MONO_TEST_TOKEN;
  const c = provider.resolveCredentials({ test_token: 'merch-test' }, { isTest: true });
  assert.equal(c.token, 'merch-test');
});

test('mono: createInvoice posts kopecks + extracts pageUrl', async () => {
  axios.reset();
  axios.setRoute('post', /\/api\/merchant\/invoice\/create$/, (cfg) => {
    assert.equal(cfg.headers['X-Token'], 'TOKEN');
    assert.equal(cfg.data.amount, 19999, 'amount must be in kopecks');
    assert.equal(cfg.data.ccy, 980);
    assert.equal(cfg.data.merchantPaymInfo.reference, 'order-1');
    // pruneUndefined() drops `icon` (no image provided) so the actual basketOrder
    // entry has only the populated keys.
    assert.deepEqual(cfg.data.merchantPaymInfo.basketOrder?.[0], {
      name: 'Брелок',
      qty: 1,
      sum: 19999,
      unit: 'шт.',
    });
    return {
      data: {
        invoiceId: 'inv_abc',
        pageUrl: 'https://pay.mbnk.biz/abc',
      },
    };
  });

  const res = await provider.createInvoice({
    amount: 199.99,
    currency: 'UAH',
    orderRef: 'order-1',
    description: 'Test',
    items: [{ name: 'Брелок', qty: 1, price: 199.99 }],
    returnUrl: 'https://shop.example/done',
    webhookUrl: 'https://api.example/payments/webhook/mono',
    customer: { email: 'a@b.com' },
    credentials: { token: 'TOKEN' },
  });

  assert.equal(res.externalId, 'inv_abc');
  assert.equal(res.redirectUrl, 'https://pay.mbnk.biz/abc');
});

test('mono: createInvoice rejects non-UAH currencies', async () => {
  await assert.rejects(
    provider.createInvoice({
      amount: 100,
      currency: 'USD',
      orderRef: 'x',
      returnUrl: 'https://x',
      webhookUrl: 'https://x',
      credentials: { token: 't' },
    }),
    /UAH only/,
  );
});

test('mono: createInvoice surfaces 400 error from provider', async () => {
  axios.reset();
  axios.setRoute('post', /invoice\/create$/, () => ({
    status: 400,
    data: { errText: 'Invalid amount' },
  }));
  await assert.rejects(
    provider.createInvoice({
      amount: 1,
      orderRef: 'x',
      returnUrl: 'https://x',
      webhookUrl: 'https://x',
      credentials: { token: 't' },
    }),
    /Invalid amount/,
  );
});

test('mono: parseWebhook maps statuses', () => {
  assert.equal(provider.parseWebhook({ body: { invoiceId: 'i', status: 'success', amount: 1000 } }).status, 'success');
  assert.equal(provider.parseWebhook({ body: { invoiceId: 'i', status: 'hold' } }).status, 'success');
  assert.equal(provider.parseWebhook({ body: { invoiceId: 'i', status: 'failure' } }).status, 'failed');
  assert.equal(provider.parseWebhook({ body: { invoiceId: 'i', status: 'reversed' } }).status, 'refunded');
  assert.equal(provider.parseWebhook({ body: { invoiceId: 'i', status: 'expired' } }).status, 'expired');
  assert.equal(provider.parseWebhook({ body: { invoiceId: 'i', status: 'created' } }).status, 'pending');
});

test('mono: parseWebhook converts kopecks → UAH', () => {
  const r = provider.parseWebhook({ body: { invoiceId: 'i', status: 'success', amount: 19999 } });
  assert.equal(r.amount, 199.99);
});

test('mono: verifyWebhook validates ECDSA signature against fetched pubkey', async () => {
  axios.reset();

  // Generate a fresh keypair, mock /pubkey to return the public PEM.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pubPem = publicKey.export({ format: 'pem', type: 'spki' });

  axios.setRoute('get', /\/api\/merchant\/pubkey$/, () => ({
    data: { key: pubPem },
  }));

  const rawBody = JSON.stringify({ invoiceId: 'inv', status: 'success' });
  const signer = crypto.createSign('SHA256');
  signer.update(rawBody);
  signer.end();
  const sig = signer.sign(privateKey).toString('base64');

  await provider.verifyWebhook({
    rawBody,
    headers: { 'x-sign': sig },
    credentials: { token: 'TOKEN-1' },
  });
  // Should NOT throw — pass.

  // Wrong signature — must throw.
  await assert.rejects(
    provider.verifyWebhook({
      rawBody,
      headers: { 'x-sign': Buffer.from('garbage').toString('base64') },
      credentials: { token: 'TOKEN-2' },
    }),
    /signature is invalid/,
  );
});
