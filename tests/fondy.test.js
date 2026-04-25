const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { installAxiosMock, freshRequire } = require('./helpers');

const axios = installAxiosMock();
const provider = freshRequire('../src/payments/providers/fondy');

const REFERENCE_SIGN = (params, secret) => {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([k, v]) => k !== 'signature' && v !== '' && v !== null && v !== undefined),
  );
  const sortedValues = Object.keys(filtered).sort().map((k) => String(filtered[k]));
  return crypto.createHash('sha1').update([String(secret), ...sortedValues].join('|')).digest('hex');
};

test('fondy: code is fondy + interface', () => {
  assert.equal(provider.code, 'fondy');
  for (const m of ['resolveCredentials', 'createInvoice', 'verifyWebhook', 'parseWebhook']) {
    assert.equal(typeof provider[m], 'function');
  }
});

test('fondy: signature exposed via _test matches reference', () => {
  const p = { merchant_id: '1', amount: '100', currency: 'UAH' };
  assert.equal(provider._test.generateSignature(p, 'test'), REFERENCE_SIGN(p, 'test'));
});

test('fondy: sandbox fallback uses public 1396424/test', () => {
  delete process.env.FONDY_TEST_MERCHANT_ID;
  delete process.env.FONDY_TEST_SECRET;
  const c = provider.resolveCredentials({}, { isTest: true });
  assert.equal(c.merchant_id, '1396424');
  assert.equal(c.secret_key, 'test');
});

test('fondy: live mode requires both creds', () => {
  assert.throws(() => provider.resolveCredentials({}, { isTest: false }), /merchant_id/);
  assert.throws(
    () => provider.resolveCredentials({ merchant_id: '1' }, { isTest: false }),
    /secret_key/,
  );
});

test('fondy: createInvoice posts to Fondy URL with correct signature + redirect', async () => {
  axios.reset();
  let body;
  axios.setRoute('post', /pay\.fondy\.eu\/api\/checkout\/url\/$/, (cfg) => {
    body = cfg.data.request;
    return {
      data: { response: { response_status: 'success', checkout_url: 'https://pay.fondy.eu/checkout/xyz' } },
    };
  });

  const res = await provider.createInvoice({
    amount: 250,
    currency: 'UAH',
    orderRef: 'f-1',
    items: [{ name: 'thing', qty: 1, price: 250 }],
    returnUrl: 'https://shop/return',
    webhookUrl: 'https://api/wh/fondy',
    customer: { email: 'x@y.z' },
    credentials: { merchant_id: '1396424', secret_key: 'test' },
  });

  assert.equal(body.amount, 25000); // kopecks
  assert.equal(body.merchant_id, '1396424');
  assert.equal(body.signature, REFERENCE_SIGN(body, 'test'));
  assert.equal(res.redirectUrl, 'https://pay.fondy.eu/checkout/xyz');
});

test('fondy: verifyWebhook + parseWebhook', async () => {
  const creds = { merchant_id: '1396424', secret_key: 'test' };
  const body = {
    order_id: 'f-1',
    response_status: 'success',
    order_status: 'approved',
    amount: '25000',
    currency: 'UAH',
  };
  body.signature = REFERENCE_SIGN(body, creds.secret_key);

  await provider.verifyWebhook({
    rawBody: JSON.stringify(body),
    headers: {},
    credentials: creds,
  });

  const parsed = provider.parseWebhook({ body });
  assert.equal(parsed.externalId, 'f-1');
  assert.equal(parsed.status, 'success');
  assert.equal(parsed.amount, 250);

  await assert.rejects(
    provider.verifyWebhook({
      rawBody: JSON.stringify({ ...body, signature: 'wrong' }),
      headers: {},
      credentials: creds,
    }),
    /signature mismatch/,
  );
});
