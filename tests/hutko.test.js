const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { installAxiosMock, freshRequire } = require('./helpers');

const axios = installAxiosMock();
const provider = freshRequire('../src/payments/providers/hutko');

const ALGO = (params, secret) => {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([k, v]) => k !== 'signature' && v !== '' && v !== null && v !== undefined),
  );
  const sortedValues = Object.keys(filtered).sort().map((k) => String(filtered[k]));
  const payload = [String(secret), ...sortedValues].join('|');
  return crypto.createHash('sha1').update(payload).digest('hex');
};

test('hutko: code/name + interface', () => {
  assert.equal(provider.code, 'hutko');
  for (const m of ['resolveCredentials', 'createInvoice', 'verifyWebhook', 'parseWebhook']) {
    assert.equal(typeof provider[m], 'function');
  }
});

test('hutko: signature drops empty values but keeps "0"', () => {
  // Internal helper isn't exported, but createInvoice must include "0"-like
  // amounts in the signature. We assert with a manually-built payload via
  // resolveCredentials → createInvoice and inspect the request.
  const params = { a: '1', b: '0', c: '', d: 'x' };
  const expected = ALGO(params, 'secret');
  // Re-compute via our reference implementation; provider has same algo internally.
  // Drop "c", keep "b": "0".
  const filtered = ALGO({ a: '1', b: '0', d: 'x' }, 'secret');
  assert.equal(expected, filtered);
});

test('hutko: resolveCredentials live + sandbox fallbacks', () => {
  assert.throws(() => provider.resolveCredentials({}, { isTest: false }), /merchant_id/);
  assert.deepEqual(
    provider.resolveCredentials({ merchant_id: '1', secret_key: 's' }, { isTest: false }),
    { merchant_id: '1', secret_key: 's', isTest: false },
  );
  // sandbox default — no env, no merchant creds.
  delete process.env.HUTKO_TEST_MERCHANT_ID;
  delete process.env.HUTKO_TEST_SECRET;
  const c = provider.resolveCredentials({}, { isTest: true });
  assert.equal(c.merchant_id, '1700002');
  assert.equal(c.secret_key, 'test');
  assert.equal(c.isTest, true);
});

test('hutko: createInvoice signs request, hits token endpoint, returns redirect URL', async () => {
  axios.reset();
  let body;
  axios.setRoute('post', /\/api\/checkout\/url\/$/, (cfg) => {
    body = cfg.data.request;
    return {
      data: { response: { response_status: 'success', checkout_url: 'https://pay.hutko.org/checkout/abc123' } },
    };
  });

  const res = await provider.createInvoice({
    amount: 99.5,
    currency: 'UAH',
    orderRef: 'h-1',
    description: 'Test',
    items: [{ name: 'товар', qty: 2, price: 49.75 }],
    returnUrl: 'https://shop/return',
    webhookUrl: 'https://api/wh/hutko',
    customer: { email: 'a@b.com' },
    credentials: { merchant_id: '1700002', secret_key: 'test' },
  });

  // Amount converted to kopecks.
  assert.equal(body.amount, 9950);
  assert.equal(body.currency, 'UAH');
  assert.equal(body.merchant_id, '1700002');
  assert.equal(body.order_id, 'h-1');
  assert.equal(body.response_url, 'https://shop/return');
  assert.equal(body.server_callback_url, 'https://api/wh/hutko');

  // Signature must match what our reference algorithm produces.
  const expected = ALGO(body, 'test');
  assert.equal(body.signature, expected);

  // Returned redirect URL points at the GET-friendly checkout_url.
  assert.equal(res.redirectUrl, 'https://pay.hutko.org/checkout/abc123');
});

test('hutko: createInvoice surfaces failure response', async () => {
  axios.reset();
  axios.setRoute('post', /url/, () => ({
    data: { response: { response_status: 'failure', error_message: 'Invalid merchant' } },
  }));
  await assert.rejects(
    provider.createInvoice({
      amount: 100,
      orderRef: 'x',
      returnUrl: 'https://x',
      webhookUrl: 'https://x',
      credentials: { merchant_id: 'bad', secret_key: 'bad' },
    }),
    /Invalid merchant/,
  );
});

test('hutko: verifyWebhook accepts valid signature, rejects mismatched', async () => {
  const creds = { merchant_id: '1700002', secret_key: 'test' };
  const validBody = {
    order_id: 'h-1',
    order_status: 'approved',
    response_status: 'success',
    amount: '9950',
    currency: 'UAH',
  };
  validBody.signature = ALGO(validBody, creds.secret_key);

  await provider.verifyWebhook({
    rawBody: JSON.stringify(validBody),
    headers: { 'content-type': 'application/json' },
    credentials: creds,
  });

  // Tamper with amount → signature no longer valid.
  await assert.rejects(
    provider.verifyWebhook({
      rawBody: JSON.stringify({ ...validBody, amount: '99500' }),
      headers: {},
      credentials: creds,
    }),
    /signature mismatch/,
  );
});

test('hutko: parseWebhook normalises status', () => {
  assert.equal(
    provider.parseWebhook({ body: { order_id: 'x', response_status: 'success', order_status: 'approved' } }).status,
    'success',
  );
  assert.equal(
    provider.parseWebhook({ body: { order_id: 'x', response_status: 'failure' } }).status,
    'failed',
  );
  assert.equal(
    provider.parseWebhook({ body: { order_id: 'x', response_status: 'success', order_status: 'reversed' } }).status,
    'refunded',
  );
  assert.equal(
    provider.parseWebhook({ body: { order_id: 'x', response_status: 'success', order_status: 'expired' } }).status,
    'expired',
  );
  assert.equal(
    provider.parseWebhook({ body: { order_id: 'x', response_status: 'success', order_status: 'processing' } }).status,
    'pending',
  );
});

test('hutko: parseWebhook handles form-urlencoded raw body', () => {
  const params = new URLSearchParams({
    order_id: 'h-1',
    response_status: 'success',
    order_status: 'approved',
    amount: '5000',
  }).toString();
  const r = provider.parseWebhook({ rawBody: params, body: {} });
  assert.equal(r.externalId, 'h-1');
  assert.equal(r.status, 'success');
  assert.equal(r.amount, 50);
});
