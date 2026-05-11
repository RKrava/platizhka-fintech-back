/**
 * WayForPay provider.
 * Docs: https://wiki.wayforpay.com/en/view/852042
 *
 * Single endpoint for everything: POST https://api.wayforpay.com/api
 * (JSON body with `transactionType` field).
 *
 * For our hosted checkout:
 *   transactionType: "CREATE_INVOICE"
 *   merchantSignature = HMAC_MD5( secret, fields.join(';') )
 *   signed fields (in order):
 *     merchantAccount;
 *     merchantDomainName;
 *     orderReference;
 *     orderDate;
 *     amount;
 *     currency;
 *     productName[1..N];   (each item)
 *     productCount[1..N];
 *     productPrice[1..N];
 *
 * Response: { reason, reasonCode, invoiceUrl }
 *   → redirect customer to invoiceUrl.
 *
 * Webhook (Service Callback):
 *   WayForPay POSTs JSON to serviceUrl with transactionStatus etc.
 *   Sign of incoming = HMAC_MD5( secret,
 *     merchantAccount;orderReference;amount;currency;authCode;cardPan;transactionStatus;reasonCode )
 *
 *   Response we MUST return (also signed) — otherwise WFP keeps retrying:
 *     {
 *       orderReference, status: "accept", time: <unix>,
 *       signature: HMAC_MD5( secret, "orderReference;status;time" )
 *     }
 *
 * Test mode:
 *   Public sandbox merchant: test_merch_n1 / flk3409refn54t54t*FNJRET.
 */

const axios = require('axios');
const crypto = require('crypto');

const API_URL = 'https://api.wayforpay.com/api';

function hmacMd5(secret, str) {
  return crypto.createHmac('md5', secret).update(str).digest('hex');
}

function signCreateInvoice(secret, p) {
  // p.productName/Count/Price — arrays
  const fields = [
    p.merchantAccount,
    p.merchantDomainName,
    p.orderReference,
    p.orderDate,
    p.amount,
    p.currency,
    ...(p.productName || []),
    ...(p.productCount || []),
    ...(p.productPrice || []),
  ].map(String);
  return hmacMd5(secret, fields.join(';'));
}

function signWebhookIncoming(secret, p) {
  const fields = [
    p.merchantAccount,
    p.orderReference,
    p.amount,
    p.currency,
    p.authCode ?? '',
    p.cardPan ?? '',
    p.transactionStatus,
    p.reasonCode,
  ].map(String);
  return hmacMd5(secret, fields.join(';'));
}

function signWebhookAck(secret, orderReference, status, time) {
  return hmacMd5(secret, [orderReference, status, time].join(';'));
}

const provider = {
  code: 'wayforpay',
  name: 'WayForPay',

  resolveCredentials(merchantCreds = {}, { isTest } = {}) {
    if (isTest) {
      const merchantAccount =
        process.env.WAYFORPAY_TEST_MERCHANT ||
        merchantCreds.test_merchant_account ||
        'test_merch_n1';
      const secretKey =
        process.env.WAYFORPAY_TEST_SECRET ||
        merchantCreds.test_secret_key ||
        'flk3409refn54t54t*FNJRET';
      return { merchantAccount, secretKey, isTest: true };
    }
    if (!merchantCreds.merchant_login || !merchantCreds.secret_key) {
      throw new Error('WayForPay merchant_login and secret_key are required.');
    }
    return {
      merchantAccount: merchantCreds.merchant_login,
      secretKey: merchantCreds.secret_key,
      isTest: false,
    };
  },

  async createInvoice({
    amount,
    currency = 'UAH',
    orderRef,
    description,
    items = [],
    returnUrl,
    webhookUrl,
    customer = {},
    credentials,
  }) {
    void description;
    if (!amount || amount <= 0) throw new Error('Invoice amount must be > 0');

    // WFP expects parallel arrays. If no items, fall back to a single line.
    const productName = items.length > 0
      ? items.map((i) => String(i.name).slice(0, 100))
      : [`Замовлення ${orderRef}`];
    const productCount = items.length > 0
      ? items.map((i) => Number(i.qty) || 1)
      : [1];
    const productPrice = items.length > 0
      ? items.map((i) => Number(Number(i.price).toFixed(2)))
      : [Number(Number(amount).toFixed(2))];

    const orderDate = Math.floor(Date.now() / 1000);
    const merchantDomainName = safeHostname(returnUrl) || 'platizhka.com';

    const fields = {
      merchantAccount: credentials.merchantAccount,
      merchantDomainName,
      orderReference: orderRef,
      orderDate,
      amount: Number(Number(amount).toFixed(2)),
      currency,
      productName,
      productCount,
      productPrice,
    };

    const merchantSignature = signCreateInvoice(credentials.secretKey, fields);

    const body = {
      transactionType: 'CREATE_INVOICE',
      apiVersion: 1,
      language: 'UA',
      serviceUrl: webhookUrl,
      returnUrl,
      ...fields,
      merchantSignature,
      // optional — pre-fill at the WFP page
      clientEmail: customer.email,
      clientPhone: customer.phone,
      clientFirstName: customer.firstName,
      clientLastName: customer.lastName,
    };
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];

    const r = await axios.post(API_URL, body, {
      headers: { 'Content-Type': 'application/json' },
      validateStatus: (s) => s < 500,
    });

    if (r.data?.reasonCode !== 1100 || !r.data?.invoiceUrl) {
      throw new Error(
        `WayForPay CREATE_INVOICE failed: ${r.data?.reason || JSON.stringify(r.data)}`,
      );
    }

    return {
      externalId: orderRef,
      redirectUrl: r.data.invoiceUrl,
      raw: r.data,
    };
  },

  async verifyWebhook({ rawBody, headers, credentials }) {
    void headers;
    const body = parseWebhookBody(rawBody);
    if (!body.merchantSignature) throw new Error('WayForPay webhook missing merchantSignature');
    const expected = signWebhookIncoming(credentials.secretKey, body);
    if (expected !== body.merchantSignature) {
      throw new Error('WayForPay webhook signature mismatch');
    }
    return true;
  },

  parseWebhook({ rawBody, body }) {
    const payload = body && body.orderReference ? body : parseWebhookBody(rawBody);
    return {
      externalId: payload.orderReference,
      orderRef: payload.orderReference,
      status: mapStatus(payload.transactionStatus),
      amount: payload.amount != null ? Number(payload.amount) : undefined,
      raw: payload,
    };
  },
};

/**
 * WFP CHECK_STATUS for a non-existent orderReference.
 *   - Valid creds + unknown order → reasonCode 1115 ("Order not found")
 *   - Wrong signature             → reasonCode 4106
 *   - Wrong merchantAccount       → reasonCode different / generic auth error
 */
provider.verifyCredentials = async function verifyCredentials(credentials) {
  const orderReference = `verify-${Date.now()}`;
  // CHECK_STATUS uses a different signed-fields list:
  //   merchantAccount;orderReference
  const merchantSignature = hmacMd5(
    credentials.secretKey,
    [credentials.merchantAccount, orderReference].join(';'),
  );
  const r = await axios.post(
    API_URL,
    {
      transactionType: 'CHECK_STATUS',
      merchantAccount: credentials.merchantAccount,
      orderReference,
      apiVersion: 1,
      merchantSignature,
    },
    { headers: { 'Content-Type': 'application/json' }, validateStatus: (s) => s < 500 },
  );
  // Auth went through if WFP just says "no such order" or "ok".
  const reason = String(r.data?.reason || '').toLowerCase();
  if (
    r.data?.reasonCode === 1100 ||
    r.data?.reasonCode === 1115 ||
    reason.includes('not found') ||
    reason.includes('no such')
  ) {
    return { ok: true, info: { note: 'WayForPay reachable' } };
  }
  // Auth-failure codes (1101 = invalid signature, 4106 = invalid merchant…).
  return { ok: false, error: r.data?.reason || `reasonCode ${r.data?.reasonCode}` };
};

function parseWebhookBody(rawBody) {
  if (!rawBody) return {};
  const str = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  try {
    return JSON.parse(str);
  } catch {
    return Object.fromEntries(new URLSearchParams(str));
  }
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function mapStatus(s) {
  switch (s) {
    case 'Approved':
      return 'success';
    case 'Refunded':
    case 'Voided':
      return 'refunded';
    case 'Declined':
    case 'Expired':
      return 'failed';
    case 'Pending':
    case 'InProcessing':
    case 'WaitingAuthComplete':
    case 'RefundInProcessing':
    default:
      return 'pending';
  }
}

/**
 * Returns the signed ACK body that WayForPay requires in response to every
 * webhook notification. Without this exact JSON (including the signature),
 * WayForPay treats the webhook as unacknowledged and keeps retrying.
 */
provider.buildWebhookAck = function buildWebhookAck(orderReference, credentials) {
  const time = Math.floor(Date.now() / 1000);
  const status = 'accept';
  const signature = signWebhookAck(credentials.secretKey, orderReference, status, time);
  return { orderReference, status, time, signature };
};

provider._test = {
  hmacMd5,
  signCreateInvoice,
  signWebhookIncoming,
  signWebhookAck,
  mapStatus,
  parseWebhookBody,
  safeHostname,
};

module.exports = provider;
