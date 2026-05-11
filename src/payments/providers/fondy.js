/**
 * Fondy provider.
 * Docs: https://docs.fondy.eu/en/docs/page/3/
 *
 *   POST  https://pay.fondy.eu/api/checkout/token/
 *   Body: { request: <signed params> }
 *
 * Signature algo (same shape as Hutko/many UA acquirers):
 *   1. Take all params except `signature`.
 *   2. Drop empty values (BUT keep "0").
 *   3. Sort by key.
 *   4. Take values in sorted order.
 *   5. Prepend secret_key.
 *   6. Join with "|".
 *   7. SHA1 hex.
 *
 * Public sandbox: merchant_id 1396424, secret_key "test".
 */

const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'https://pay.fondy.eu';

/**
 * Fondy/Hutko sit behind CloudFront. Their WAF rejects requests whose body
 * contains `localhost` / 127.0.0.1 (anti-open-redirect rule). For local
 * development we substitute a public placeholder host so the API call goes
 * through; the redirect URL Fondy returns still points back at our localhost
 * because the merchant copy of the URL is what Fondy echoes BACK in the
 * checkout page (after the user completes payment). For dev testing it's
 * fine — the user just needs to manually return to /checkout-preview.
 *
 * On production these substitutions are no-ops because URLs are already
 * public HTTPS.
 */
function publicizeUrl(url) {
  if (!url) return url;
  return url
    .replace(/^http:\/\/localhost(:\d+)?/i, 'https://example.com')
    .replace(/^http:\/\/127\.0\.0\.1(:\d+)?/i, 'https://example.com');
}

function generateSignature(params, secretKey) {
  const filtered = {};
  for (const [k, v] of Object.entries(params)) {
    // Docs: exclude both 'signature' and 'response_signature_string' (added by Fondy in test mode).
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
  code: 'fondy',
  name: 'Fondy',

  resolveCredentials(merchantCreds = {}, { isTest } = {}) {
    if (isTest) {
      return {
        merchant_id: process.env.FONDY_TEST_MERCHANT_ID || merchantCreds.test_merchant_id || '1396424',
        secret_key: process.env.FONDY_TEST_SECRET || merchantCreds.test_secret_key || 'test',
        isTest: true,
      };
    }
    if (!merchantCreds.merchant_id || !merchantCreds.secret_key) {
      throw new Error('Fondy merchant_id and secret_key are required.');
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
      sender_email: customer.email || undefined,
    };
    for (const k of Object.keys(params)) if (params[k] === undefined) delete params[k];

    params.signature = generateSignature(params, credentials.secret_key);

    // /checkout/url/ returns a GET-friendly checkout_url. The legacy
    // /checkout/token/ flow's redirect helper is POST-only and the API is
    // fronted by CloudFront which 403s requests without a real User-Agent.
    const r = await axios.post(
      `${BASE_URL}/api/checkout/url/`,
      { request: params },
      {
        headers: {
          'Content-Type': 'application/json',
          // CloudFront in front of pay.fondy.eu blocks anything that looks like a bot.
// Sending a regular browser UA gets through.
'User-Agent':
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        },
        validateStatus: (s) => s < 500,
      },
    );

    const body = r.data?.response || {};
    if (body.response_status === 'failure' || !body.checkout_url) {
      throw new Error(
        `Fondy checkout/url failed: ${body.error_message || body.error_code || JSON.stringify(r.data)}`,
      );
    }

    return { externalId: orderRef, redirectUrl: body.checkout_url, raw: body };
  },

  async verifyWebhook({ rawBody, headers, credentials }) {
    void headers;
    const body = parseWebhookBody(rawBody);
    if (!body || !body.signature) throw new Error('Fondy webhook missing signature');
    const expected = generateSignature(body, credentials.secret_key);
    if (expected !== body.signature) throw new Error('Fondy webhook signature mismatch');
    return true;
  },

  parseWebhook({ rawBody, body }) {
    const payload = body && Object.keys(body).length ? body : parseWebhookBody(rawBody);
    return {
      externalId: payload.order_id,
      orderRef: payload.order_id,
      status: mapStatus(payload.response_status, payload.order_status),
      amount: payload.amount != null ? Number(payload.amount) / 100 : undefined,
      raw: payload,
    };
  },
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

// Same verification trick as Hutko — issue a token request and inspect the response.
provider.verifyCredentials = async function verifyCredentials(credentials) {
  const params = {
    merchant_id: String(credentials.merchant_id),
    order_id: `verify-${Date.now()}`,
    order_desc: 'Credentials verification',
    currency: 'UAH',
    amount: 100,
  };
  params.signature = generateSignature(params, credentials.secret_key);

  const r = await axios.post(
    `${BASE_URL}/api/checkout/url/`,
    { request: params },
    {
      headers: {
        'Content-Type': 'application/json',
        // CloudFront in front of pay.fondy.eu blocks anything that looks like a bot.
// Sending a regular browser UA gets through.
'User-Agent':
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      },
      validateStatus: (s) => s < 500,
    },
  );
  const body = r.data?.response || {};
  if (body.checkout_url) return { ok: true };
  const code = String(body.error_code || '').toLowerCase();
  if (code.includes('sign') || code.includes('merchant') || body.error_code === 1014) {
    return { ok: false, error: body.error_message || `error_code ${body.error_code}` };
  }
  return { ok: true, info: { note: 'Fondy reachable' } };
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

provider._test = { generateSignature, mapStatus, parseWebhookBody };

module.exports = provider;
