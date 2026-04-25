const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { installAxiosMock, freshRequire } = require('./helpers');

const axios = installAxiosMock();
const provider = freshRequire('../src/payments/providers/liqpay');

function refSign(privateKey, data) {
  return crypto.createHash('sha1').update(privateKey + data + privateKey).digest('base64');
}

test('liqpay: signature matches LiqPay docs algorithm', () => {
  const data = Buffer.from(JSON.stringify({ x: 1 })).toString('base64');
  const sig = provider._test.sign('PRIV_KEY', data);
  assert.equal(sig, refSign('PRIV_KEY', data));
});

test('liqpay: live mode requires both keys', () => {
  assert.throws(() => provider.resolveCredentials({}, { isTest: false }), /public_key/);
  assert.throws(
    () => provider.resolveCredentials({ public_key: 'pub_x' }, { isTest: false }),
    /private_key/,
  );
  const c = provider.resolveCredentials(
    { public_key: 'pub_x', private_key: 'pri_x' },
    { isTest: false },
  );
  assert.equal(c.sandbox, 0);
});

test('liqpay: test mode sets sandbox=1', () => {
  const c = provider.resolveCredentials(
    { public_key: 'pub_x', private_key: 'pri_x' },
    { isTest: true },
  );
  assert.equal(c.sandbox, 1);
  assert.equal(c.isTest, true);
});

test('liqpay: createInvoice produces signed checkout URL', async () => {
  const credentials = { public_key: 'sandbox_pub_X', private_key: 'sandbox_pri_X', sandbox: 1 };
  const res = await provider.createInvoice({
    amount: 199.5,
    currency: 'UAH',
    orderRef: 'lp-1',
    description: 'Test',
    items: [{ name: 'x', qty: 1, price: 199.5 }],
    returnUrl: 'https://shop/return',
    webhookUrl: 'https://api/wh/liqpay',
    customer: { email: 'x@y.z' },
    credentials,
  });

  // Redirect URL: https://www.liqpay.ua/api/3/checkout?data=...&signature=...
  const u = new URL(res.redirectUrl);
  assert.equal(u.origin + u.pathname, 'https://www.liqpay.ua/api/3/checkout');

  const data = u.searchParams.get('data');
  const signature = u.searchParams.get('signature');
  assert.ok(data && signature, 'must have data + signature query params');

  // Decoded params must contain order_id, amount, currency, sandbox=1.
  const decoded = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  assert.equal(decoded.order_id, 'lp-1');
  assert.equal(decoded.amount, 199.5);
  assert.equal(decoded.currency, 'UAH');
  assert.equal(decoded.sandbox, 1);
  assert.equal(decoded.public_key, 'sandbox_pub_X');

  // Signature must verify with the SAME private key.
  assert.equal(signature, refSign('sandbox_pri_X', data));
});

test('liqpay: verifyWebhook accepts valid signed body', async () => {
  const creds = { public_key: 'pub_x', private_key: 'pri_x', sandbox: 0 };
  const data = Buffer.from(JSON.stringify({ order_id: 'lp-1', status: 'success' })).toString('base64');
  const signature = refSign(creds.private_key, data);

  // Form-urlencoded payload (LiqPay default).
  const rawBody = new URLSearchParams({ data, signature }).toString();
  await provider.verifyWebhook({
    rawBody,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    credentials: creds,
  });

  // Tampered signature must throw.
  await assert.rejects(
    provider.verifyWebhook({
      rawBody: new URLSearchParams({ data, signature: 'evil' }).toString(),
      headers: {},
      credentials: creds,
    }),
    /signature mismatch/,
  );
});

test('liqpay: parseWebhook decodes data, normalises status', () => {
  const data = Buffer.from(
    JSON.stringify({ order_id: 'lp-1', status: 'success', amount: 199.5 }),
  ).toString('base64');
  const r = provider.parseWebhook({
    rawBody: new URLSearchParams({ data, signature: 'whatever' }).toString(),
    body: {},
  });
  assert.equal(r.externalId, 'lp-1');
  assert.equal(r.status, 'success');
  assert.equal(r.amount, 199.5);

  // Sandbox status should also be considered success.
  const sandboxData = Buffer.from(JSON.stringify({ order_id: 'lp-1', status: 'sandbox' })).toString('base64');
  const r2 = provider.parseWebhook({
    rawBody: new URLSearchParams({ data: sandboxData, signature: 'x' }).toString(),
    body: {},
  });
  assert.equal(r2.status, 'success');
});

test('liqpay: status mapping covers all known LiqPay statuses', () => {
  const m = provider._test.mapStatus;
  assert.equal(m('success'), 'success');
  assert.equal(m('sandbox'), 'success');
  assert.equal(m('subscribed'), 'success');
  assert.equal(m('failure'), 'failed');
  assert.equal(m('error'), 'failed');
  assert.equal(m('reversed'), 'refunded');
  assert.equal(m('refunded'), 'refunded');
  assert.equal(m('expired'), 'expired');
  assert.equal(m('wait_secure'), 'pending');
  assert.equal(m('wait_3ds'), 'pending');
  assert.equal(m('processing'), 'pending');
  assert.equal(m('unknown_xyz'), 'pending');
});
