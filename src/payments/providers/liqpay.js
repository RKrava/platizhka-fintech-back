/**
 * LiqPay provider.
 * Docs: https://www.liqpay.ua/documentation/en
 *
 * Hosted-checkout flow:
 *   1. Build params object (action: "pay", amount, ...).
 *   2. data      = base64( JSON.stringify(params) ).
 *   3. signature = base64( sha1_binary(private_key + data + private_key) ).
 *   4. Redirect user to:
 *        https://www.liqpay.ua/api/3/checkout?data=<data>&signature=<signature>
 *
 * Webhook:
 *   LiqPay POSTs application/x-www-form-urlencoded with `data` and `signature`.
 *   Verify by recomputing the same signature with private_key.
 *
 * Test mode:
 *   - Merchant gets sandbox_pub_/sandbox_pri_ keys for full sandbox.
 *   - Or pass `sandbox: 1` with live keys to bypass real charging.
 *   We support both: when isTest=true we set `sandbox: 1` AND prefer
 *   `test_public_key` / `test_private_key` if the merchant pasted them.
 */

const axios = require('axios');
const crypto = require('crypto');

const CHECKOUT_URL = 'https://www.liqpay.ua/api/3/checkout';
const REQUEST_URL = 'https://www.liqpay.ua/api/request';

function encodeBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

function sign(privateKey, data) {
  return crypto
    .createHash('sha1')
    .update(privateKey + data + privateKey)
    .digest('base64');
}

const provider = {
  code: 'liqpay',
  name: 'LiqPay',

  resolveCredentials(merchantCreds = {}, { isTest } = {}) {
    if (isTest) {
      // Prefer dedicated sandbox keys if the merchant set them.
      const pub = merchantCreds.test_public_key || merchantCreds.public_key;
      const priv = merchantCreds.test_private_key || merchantCreds.private_key;
      if (!pub || !priv) {
        throw new Error('LiqPay test mode requires public_key and private_key in shop settings.');
      }
      return { public_key: pub, private_key: priv, sandbox: 1, isTest: true };
    }
    if (!merchantCreds.public_key || !merchantCreds.private_key) {
      throw new Error('LiqPay public_key and private_key are required.');
    }
    return {
      public_key: merchantCreds.public_key,
      private_key: merchantCreds.private_key,
      sandbox: 0,
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
    if (!amount || amount <= 0) throw new Error('Invoice amount must be > 0');

    const params = {
      version: 3,
      public_key: credentials.public_key,
      action: 'pay',
      amount: Number(Number(amount).toFixed(2)),
      currency,
      description:
        description ||
        items.map((i) => `${i.name} x${i.qty || 1}`).join(', ').slice(0, 255) ||
        `Замовлення ${orderRef}`,
      order_id: orderRef,
      result_url: returnUrl,
      server_url: webhookUrl,
    };
    if (credentials.sandbox === 1) params.sandbox = 1;
    if (customer.email) params.customer = customer.email;

    const data = encodeBase64(JSON.stringify(params));
    const signature = sign(credentials.private_key, data);

    // Hosted page — user gets redirected here, sees LiqPay's UI, picks card,
    // completes 3DS, and is redirected back to result_url.
    const pageUrl =
      `${CHECKOUT_URL}?data=${encodeURIComponent(data)}&signature=${encodeURIComponent(signature)}`;

    return {
      externalId: orderRef, // LiqPay assigns its own payment_id only after the user pays
      redirectUrl: pageUrl,
      raw: { data, signature, params },
    };
  },

  /**
   * Verify webhook signature. LiqPay sends `data` and `signature` form fields.
   */
  async verifyWebhook({ rawBody, headers, credentials }) {
    void headers;
    const body = parseWebhookBody(rawBody);
    if (!body.data || !body.signature) throw new Error('LiqPay webhook missing data/signature');
    const expected = sign(credentials.private_key, body.data);
    if (expected !== body.signature) throw new Error('LiqPay webhook signature mismatch');
    return true;
  },

  parseWebhook({ rawBody, body }) {
    const wrapper = body && body.data ? body : parseWebhookBody(rawBody);
    let payload = {};
    try {
      payload = JSON.parse(Buffer.from(wrapper.data, 'base64').toString('utf8'));
    } catch {
      // leave payload empty — caller will see externalId undefined
    }
    return {
      externalId: payload.order_id,
      orderRef: payload.order_id,
      status: mapStatus(payload.status),
      amount: payload.amount != null ? Number(payload.amount) : undefined,
      raw: payload,
    };
  },

  /**
   * Verify creds by issuing a `status` request for a non-existent order_id.
   * - Wrong private_key → "invalid signature"
   * - Wrong public_key  → "public_key not found"
   * - Valid creds       → "payment not found" (which we treat as ok).
   */
  async verifyCredentials(credentials) {
    const params = {
      version: 3,
      public_key: credentials.public_key,
      action: 'status',
      order_id: `verify-${Date.now()}`,
    };
    if (credentials.sandbox === 1) params.sandbox = 1;
    const data = encodeBase64(JSON.stringify(params));
    const signature = sign(credentials.private_key, data);
    const r = await axios.post(
      REQUEST_URL,
      new URLSearchParams({ data, signature }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: (s) => s < 500 },
    );
    const errCode = r.data?.err_code || r.data?.code;
    const errDesc = r.data?.err_description || r.data?.message;
    if (errCode === 'public_key_not_found' || errCode === 'invalid_signature') {
      return { ok: false, error: errDesc || errCode };
    }
    return { ok: true, info: { note: 'LiqPay reachable' } };
  },

  /** Optional poll using LiqPay's "status" action. */
  async getInvoice(externalId, credentials) {
    const params = {
      version: 3,
      public_key: credentials.public_key,
      action: 'status',
      order_id: externalId,
    };
    if (credentials.sandbox === 1) params.sandbox = 1;
    const data = encodeBase64(JSON.stringify(params));
    const signature = sign(credentials.private_key, data);
    const r = await axios.post(
      REQUEST_URL,
      new URLSearchParams({ data, signature }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: (s) => s < 500,
      },
    );
    return { status: mapStatus(r.data?.status), raw: r.data };
  },
};

function parseWebhookBody(rawBody) {
  if (!rawBody) return {};
  const str = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  // form-urlencoded is the default for LiqPay webhooks
  if (str.includes('=') && !str.startsWith('{')) {
    return Object.fromEntries(new URLSearchParams(str));
  }
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

function mapStatus(s) {
  switch (s) {
    case 'success':
    case 'sandbox':
    case 'subscribed':
      return 'success';
    case 'reversed':
    case 'refunded':
      return 'refunded';
    case 'failure':
    case 'error':
      return 'failed';
    case 'expired':
      return 'expired';
    case 'wait_secure':
    case 'wait_accept':
    case 'processing':
    case 'wait_3ds':
    case 'wait_card':
    case '3ds_verify':
    default:
      return 'pending';
  }
}

// Expose helpers for tests.
provider._test = { sign, encodeBase64, mapStatus, parseWebhookBody };

module.exports = provider;
