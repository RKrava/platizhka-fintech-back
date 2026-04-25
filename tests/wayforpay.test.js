const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { installAxiosMock, freshRequire } = require('./helpers');

const axios = installAxiosMock();
const provider = freshRequire('../src/payments/providers/wayforpay');

function refHmacMd5(secret, str) {
  return crypto.createHmac('md5', secret).update(str).digest('hex');
}

test('wayforpay: signCreateInvoice matches HMAC_MD5 of joined fields', () => {
  const params = {
    merchantAccount: 'test_merch_n1',
    merchantDomainName: 'shop.example',
    orderReference: 'wfp-1',
    orderDate: 1700000000,
    amount: 250,
    currency: 'UAH',
    productName: ['товар A', 'товар B'],
    productCount: [1, 2],
    productPrice: [100, 75],
  };
  const expectedStr = [
    'test_merch_n1', 'shop.example', 'wfp-1', '1700000000', '250', 'UAH',
    'товар A', 'товар B',
    '1', '2',
    '100', '75',
  ].join(';');
  assert.equal(
    provider._test.signCreateInvoice('SECRET', params),
    refHmacMd5('SECRET', expectedStr),
  );
});

test('wayforpay: signWebhookIncoming joins 8 specific fields', () => {
  const data = {
    merchantAccount: 'test_merch_n1',
    orderReference: 'wfp-1',
    amount: 100,
    currency: 'UAH',
    authCode: '123456',
    cardPan: '4444****1111',
    transactionStatus: 'Approved',
    reasonCode: 1100,
  };
  const expectedStr = [
    'test_merch_n1', 'wfp-1', '100', 'UAH', '123456', '4444****1111', 'Approved', '1100',
  ].join(';');
  assert.equal(
    provider._test.signWebhookIncoming('SECRET', data),
    refHmacMd5('SECRET', expectedStr),
  );
});

test('wayforpay: test mode uses public sandbox merchant', () => {
  delete process.env.WAYFORPAY_TEST_MERCHANT;
  delete process.env.WAYFORPAY_TEST_SECRET;
  const c = provider.resolveCredentials({}, { isTest: true });
  assert.equal(c.merchantAccount, 'test_merch_n1');
  assert.match(c.secretKey, /flk3409refn54t54t/);
});

test('wayforpay: live mode requires merchant_login + secret_key', () => {
  assert.throws(() => provider.resolveCredentials({}, { isTest: false }), /merchant_login/);
  const c = provider.resolveCredentials(
    { merchant_login: 'shop_xyz', secret_key: 'secret_xyz' },
    { isTest: false },
  );
  assert.equal(c.merchantAccount, 'shop_xyz');
  assert.equal(c.secretKey, 'secret_xyz');
});

test('wayforpay: createInvoice posts CREATE_INVOICE with correct signature', async () => {
  axios.reset();
  let body;
  axios.setRoute('post', /api\.wayforpay\.com\/api$/, (cfg) => {
    body = cfg.data;
    return { data: { reason: 'Ok', reasonCode: 1100, invoiceUrl: 'https://secure.wayforpay.com/invoice/abc' } };
  });

  const res = await provider.createInvoice({
    amount: 250,
    currency: 'UAH',
    orderRef: 'wfp-1',
    items: [{ name: 'A', qty: 1, price: 100 }, { name: 'B', qty: 2, price: 75 }],
    returnUrl: 'https://shop.example/done',
    webhookUrl: 'https://api.example/wh/wayforpay',
    customer: { email: 'x@y.z', firstName: 'Іван' },
    credentials: { merchantAccount: 'test_merch_n1', secretKey: 'SECRET' },
  });

  assert.equal(body.transactionType, 'CREATE_INVOICE');
  assert.equal(body.amount, 250);
  assert.deepEqual(body.productCount, [1, 2]);
  assert.deepEqual(body.productName, ['A', 'B']);
  assert.equal(body.merchantDomainName, 'shop.example');
  assert.equal(body.serviceUrl, 'https://api.example/wh/wayforpay');

  // Signature must match.
  const expected = provider._test.signCreateInvoice('SECRET', body);
  assert.equal(body.merchantSignature, expected);

  assert.equal(res.redirectUrl, 'https://secure.wayforpay.com/invoice/abc');
});

test('wayforpay: createInvoice surfaces non-1100 reasonCode as error', async () => {
  axios.reset();
  axios.setRoute('post', /wayforpay\.com\/api$/, () => ({
    data: { reason: 'Invalid signature', reasonCode: 1101 },
  }));
  await assert.rejects(
    provider.createInvoice({
      amount: 100,
      orderRef: 'x',
      returnUrl: 'https://shop.example',
      webhookUrl: 'https://api.example',
      credentials: { merchantAccount: 'a', secretKey: 'b' },
    }),
    /Invalid signature/,
  );
});

test('wayforpay: verifyWebhook validates merchantSignature', async () => {
  const creds = { merchantAccount: 'test_merch_n1', secretKey: 'SECRET' };
  const body = {
    merchantAccount: creds.merchantAccount,
    orderReference: 'wfp-1',
    amount: 100,
    currency: 'UAH',
    authCode: '123',
    cardPan: '****1111',
    transactionStatus: 'Approved',
    reasonCode: 1100,
  };
  body.merchantSignature = provider._test.signWebhookIncoming(creds.secretKey, body);

  await provider.verifyWebhook({
    rawBody: JSON.stringify(body),
    headers: {},
    credentials: creds,
  });

  await assert.rejects(
    provider.verifyWebhook({
      rawBody: JSON.stringify({ ...body, merchantSignature: 'bad' }),
      headers: {},
      credentials: creds,
    }),
    /signature mismatch/,
  );
});

test('wayforpay: parseWebhook normalises status + extracts orderReference', () => {
  const r = provider.parseWebhook({
    body: {
      orderReference: 'wfp-1',
      transactionStatus: 'Approved',
      amount: 100,
      currency: 'UAH',
    },
  });
  assert.equal(r.externalId, 'wfp-1');
  assert.equal(r.status, 'success');
  assert.equal(r.amount, 100);

  assert.equal(provider._test.mapStatus('Declined'), 'failed');
  assert.equal(provider._test.mapStatus('Refunded'), 'refunded');
  assert.equal(provider._test.mapStatus('Voided'), 'refunded');
  assert.equal(provider._test.mapStatus('Pending'), 'pending');
  assert.equal(provider._test.mapStatus('InProcessing'), 'pending');
  assert.equal(provider._test.mapStatus('UnknownStatus'), 'pending');
});

test('wayforpay: signWebhookAck signs orderReference;status;time', () => {
  const sig = provider._test.signWebhookAck('SECRET', 'wfp-1', 'accept', 1700000000);
  assert.equal(sig, refHmacMd5('SECRET', 'wfp-1;accept;1700000000'));
});

test('wayforpay: safeHostname extracts host from URL', () => {
  assert.equal(provider._test.safeHostname('https://shop.example/return'), 'shop.example');
  assert.equal(provider._test.safeHostname('not a url'), null);
});
