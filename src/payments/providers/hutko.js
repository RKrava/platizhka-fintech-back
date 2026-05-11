/**
 * Hutko payment provider — Ukrainian acquiring service.
 * Docs: https://docs.hutko.org/uk/docs/page/2/
 *
 * Endpoint:
 *   POST  https://pay.hutko.org/api/checkout/token/
 *   Body: { request: <signed params> }
 *
 * Signature algorithm:
 *   1. Take all params EXCEPT `signature`.
 *   2. Drop empty values (BUT keep "0").
 *   3. Sort entries by key.
 *   4. Take the values only (in sorted order).
 *   5. Prepend the merchant secret_key.
 *   6. Join with "|".
 *   7. SHA1 hex of the result.
 *
 * Test credentials (public sandbox, from docs):
 *   merchant_id: 1700002
 *   secret_key:  test
 */

const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'https://pay.hutko.org';
const PUBLIC_SANDBOX_MERCHANT_ID = '1700002';
const PUBLIC_SANDBOX_SECRET = 'test';

/** Substitute localhost → public placeholder so the CloudFront/WAF lets us through. */
function publicizeUrl(url) {
  if (!url) return url;
  return url
    .replace(/^http:\/\/localhost(:\d+)?/i, 'https://example.com')
    .replace(/^http:\/\/127\.0\.0\.1(:\d+)?/i, 'https://example.com');
}

function generateSignature(params, secretKey) {
  const filtered = {};
  for (const [k, v] of Object.entries(params)) {
    // Docs say to exclude both 'signature' and 'response_signature_string' when verifying.
    if (k === 'signature' || k === 'response_signature_string') continue;
    if (v === '' || v === null || v === undefined) continue; // keep "0"
    filtered[k] = v;
  }
  const sortedKeys = Object.keys(filtered).sort();
  const values = sortedKeys.map((k) => String(filtered[k]));
  const payload = [String(secretKey), ...values].join('|');
  return crypto.createHash('sha1').update(payload).digest('hex');
}

const provider = {
  code: 'hutko',
  name: 'Hutko',

  resolveCredentials(merchantCreds = {}, { isTest } = {}) {
    if (isTest) {
      return {
        merchant_id: process.env.HUTKO_TEST_MERCHANT_ID || merchantCreds.test_merchant_id || PUBLIC_SANDBOX_MERCHANT_ID,
        secret_key: process.env.HUTKO_TEST_SECRET || merchantCreds.test_secret_key || PUBLIC_SANDBOX_SECRET,
        isTest: true,
      };
    }
    if (!merchantCreds.merchant_id || !merchantCreds.secret_key) {
      throw new Error('Hutko merchant_id and secret_key are required.');
    }
    return {
      merchant_id: merchantCreds.merchant_id,
      secret_key: merchantCreds.secret_key,
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

    // Hutko/Fondy expect amount in MINOR units (kopecks for UAH).
    const amountMinor = Math.round(Number(amount) * 100);
    const orderDesc =
      description ||
      items.map((i) => `${i.name} x${i.qty || 1}`).join(', ').slice(0, 255) ||
      `Замовлення ${orderRef}`;

    const params = {
      merchant_id: String(credentials.merchant_id),
      order_id: orderRef,
      order_desc: orderDesc.slice(0, 255),
      currency,
      amount: amountMinor,
      response_url: publicizeUrl(returnUrl),
      server_callback_url: publicizeUrl(webhookUrl),
      // Pre-fill customer if provided.
      sender_email: customer.email || undefined,
    };
    // Drop undefined keys before signing.
    for (const k of Object.keys(params)) if (params[k] === undefined) delete params[k];

    params.signature = generateSignature(params, credentials.secret_key);

    // /checkout/url/ returns a ready-to-redirect checkout_url (GET-friendly).
    // The older /checkout/token/ endpoint returned only a token whose redirect
    // helper is POST-only — useless from a server-side redirect.
    const r = await axios.post(
      `${BASE_URL}/api/checkout/url/`,
      { request: params },
      {
        headers: {
          'Content-Type': 'application/json',
          // CloudFront in front of Hutko/Fondy blocks empty/default UA.
          'User-Agent':
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        },
        validateStatus: (s) => s < 500,
      },
    );

    const body = r.data?.response || {};
    if (body.response_status === 'failure' || !body.checkout_url) {
      throw new Error(
        `Hutko checkout/url failed: ${body.error_message || body.error_code || JSON.stringify(r.data)}`,
      );
    }

    return {
      externalId: orderRef,
      redirectUrl: body.checkout_url,
      raw: body,
    };
  },

  /**
   * Hutko/Fondy webhook: sends application/x-www-form-urlencoded OR JSON
   * with all transaction params + a `signature` field. Verify by recomputing
   * the SHA1 over all other fields with secret_key.
   */
  async verifyWebhook({ rawBody, headers, credentials }) {
    let body;
    try {
      // try JSON
      body = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
    } catch {
      // form-urlencoded
      body = Object.fromEntries(new URLSearchParams(rawBody.toString()));
    }
    if (!body || !body.signature) throw new Error('Hutko webhook missing signature');
    const expected = generateSignature(body, credentials.secret_key);
    if (expected !== body.signature) {
      throw new Error('Hutko webhook signature mismatch');
    }
    return true;
  },

  parseWebhook({ rawBody, body }) {
    let payload = body;
    if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
      // raw body parser case
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        payload = Object.fromEntries(new URLSearchParams(rawBody.toString()));
      }
    }
    const status = mapStatus(payload.response_status, payload.order_status);
    return {
      externalId: payload.order_id,
      orderRef: payload.order_id,
      status,
      amount: payload.amount != null ? Number(payload.amount) / 100 : undefined,
      raw: payload,
    };
  },
};

/**
 * Verify credentials by issuing a CreateInvoice with a deliberately bad
 * order_id so we don't actually create a payable invoice. If our merchant_id
 * exists and our signature is valid, Hutko answers with a structured error
 * (response_status:'failure', error_code != INVALID_SIGN). If the signature
 * is wrong → INVALID_SIGN. If merchant_id is wrong → MERCHANT_NOT_FOUND.
 */
provider.verifyCredentials = async function verifyCredentials(credentials) {
  const params = {
    merchant_id: String(credentials.merchant_id),
    order_id: `verify-${Date.now()}`,
    order_desc: 'Credentials verification (no charge)',
    currency: 'UAH',
    amount: 100, // 1 UAH in kopecks
  };
  params.signature = (function sign() {
    const filtered = {};
    for (const [k, v] of Object.entries(params)) {
      if (k === 'signature' || v === '' || v === null || v === undefined) continue;
      filtered[k] = v;
    }
    const sortedValues = Object.keys(filtered).sort().map((k) => String(filtered[k]));
    return crypto.createHash('sha1').update([credentials.secret_key, ...sortedValues].join('|')).digest('hex');
  })();

  const r = await axios.post(
    `${BASE_URL}/api/checkout/url/`,
    { request: params },
    {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      },
      validateStatus: (s) => s < 500,
    },
  );
  const body = r.data?.response || {};
  if (body.checkout_url) return { ok: true, info: { note: 'Hutko reachable' } };
  // Auth-related failure codes — wrong creds.
  const code = String(body.error_code || '').toLowerCase();
  if (code.includes('sign') || code.includes('merchant') || body.error_code === 1014) {
    return { ok: false, error: body.error_message || `error_code ${body.error_code}` };
  }
  return { ok: true, info: { note: 'Hutko reachable' } };
};

function mapStatus(responseStatus, orderStatus) {
  if (responseStatus === 'failure') return 'failed';
  switch (orderStatus) {
    case 'approved':
      return 'success';
    case 'declined':
      return 'failed';
    case 'reversed':
      return 'refunded';
    case 'expired':
      return 'expired';
    case 'created':
    case 'processing':
    default:
      return 'pending';
  }
}

module.exports = provider;
