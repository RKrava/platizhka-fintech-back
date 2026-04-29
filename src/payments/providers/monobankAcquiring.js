/**
 * Monobank Acquiring provider.
 * Docs: https://api.monobank.ua/docs/acquiring.html
 *
 * Single endpoint we use:
 *   POST   /api/merchant/invoice/create     — issue an invoice, get pageUrl
 *   GET    /api/merchant/invoice/status     — poll status (fallback)
 *   POST   /api/merchant/invoice/cancel     — refund (future)
 *
 * Auth header:  X-Token: <merchant_token>
 *
 * Webhook signature:
 *   Monobank signs the raw body with ECDSA. The merchant fetches the public key
 *   once via GET /api/merchant/pubkey (also requires X-Token) and verifies
 *   `X-Sign` (base64) of the raw body. We cache the pubkey per token.
 */

const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'https://api.monobank.ua';

/**
 * Monobank Acquiring public sandbox token.
 * https://api.monobank.ua/docs/acquiring.html#section/Test-token
 *
 * Used as last-resort fallback when test mode is on and the platform has not
 * configured `MONO_TEST_TOKEN` and the merchant has no `test_token` of their
 * own. This token is intentionally public; transactions are sandbox only.
 */
const PUBLIC_SANDBOX_TOKEN = 'uev-3VIVqzTiwhMI3BIMhlOicdKZqheSxingzQhd4V_Q';

/* ─── Pubkey cache (in-process, per token) ─── */
const pubkeyCache = new Map(); // token -> { keyObj, fetchedAt }

/**
 * Normalise whatever Monobank returns into a crypto.KeyObject that OpenSSL 3.x
 * (Node 18+) can use:
 *
 * - Strip any EC PARAMETERS block (explicit params → rejected by OpenSSL 3.x).
 * - If the header is "BEGIN EC PUBLIC KEY" (SEC1), convert to SPKI by wrapping
 *   the raw EC point with the P-256 algorithm identifier prefix.
 * - If it looks like raw base64 (no PEM headers at all), wrap it as SPKI.
 */
function buildKeyObject(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('Invalid key value from Monobank');

  // Normalise line endings.
  let pem = raw.replace(/\r\n/g, '\n').trim();

  // Strip standalone EC PARAMETERS block (explicit params).
  pem = pem.replace(/-----BEGIN EC PARAMETERS-----[\s\S]*?-----END EC PARAMETERS-----\n?/g, '').trim();

  // If there are no PEM headers at all → treat as raw base64 SPKI.
  if (!pem.includes('-----BEGIN')) {
    const b64 = pem.replace(/\s/g, '');
    const lines = (b64.match(/.{1,64}/g) || []).join('\n');
    pem = `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
  }

  // If it's a SEC1 EC PUBLIC KEY (not SPKI), convert to SPKI manually.
  // The SPKI prefix for P-256 (secp256r1) in DER is a fixed 27-byte header:
  //   SEQUENCE { SEQUENCE { OID ecPublicKey, OID prime256v1 }, BIT STRING }
  if (pem.includes('BEGIN EC PUBLIC KEY')) {
    const b64 = pem
      .replace(/-----BEGIN EC PUBLIC KEY-----/, '')
      .replace(/-----END EC PUBLIC KEY-----/, '')
      .replace(/\s/g, '');
    const ecPoint = Buffer.from(b64, 'base64'); // 04 || x || y (65 bytes for P-256)
    // SPKI DER for P-256:
    const p256Prefix = Buffer.from(
      '3059301306072a8648ce3d020106082a8648ce3d030107034200',
      'hex',
    );
    const spkiDer = Buffer.concat([p256Prefix, ecPoint]);
    const spkiB64 = spkiDer.toString('base64').match(/.{1,64}/g).join('\n');
    pem = `-----BEGIN PUBLIC KEY-----\n${spkiB64}\n-----END PUBLIC KEY-----`;
  }

  try {
    return crypto.createPublicKey({ key: pem, format: 'pem' });
  } catch (e) {
    console.error('[mono/pubkey] Failed to parse key. Header line:', pem.split('\n')[0]);
    throw new Error(`Cannot parse Monobank public key: ${e.message}`);
  }
}

async function getPubkey(token) {
  const cached = pubkeyCache.get(token);
  // Refresh every 24h — Monobank rotates rarely.
  if (cached && Date.now() - cached.fetchedAt < 24 * 60 * 60 * 1000) {
    return cached.keyObj;
  }
  const r = await axios.get(`${BASE_URL}/api/merchant/pubkey`, {
    headers: { 'X-Token': token },
  });
  const raw = r.data?.key;
  if (!raw) throw new Error('Monobank pubkey response missing `key`');
  const keyObj = buildKeyObject(raw);
  pubkeyCache.set(token, { keyObj, fetchedAt: Date.now() });
  return keyObj;
}

/* ─── Provider ─── */
const provider = {
  code: 'mono',
  name: 'Monobank Acquiring',

  /**
   * Resolve merchant token. In test mode, prefer platform-wide test token
   * (env MONO_TEST_TOKEN). If that's not set, fall back to merchant's own
   * token (Monobank doesn't have a shared sandbox — merchants enable a
   * test merchant inside their own account).
   */
  resolveCredentials(merchantCreds = {}, { isTest } = {}) {
    if (isTest) {
      // Priority: env override → merchant's own test_token → public sandbox.
      // Public sandbox guarantees test mode "just works" out of the box.
      const token =
        process.env.MONO_TEST_TOKEN ||
        merchantCreds.test_token ||
        PUBLIC_SANDBOX_TOKEN;
      return { token, isTest: true };
    }
    if (!merchantCreds.merchant_token) {
      throw new Error('Monobank merchant_token is not configured for this shop.');
    }
    return { token: merchantCreds.merchant_token, isTest: false };
  },

  /**
   * Create an invoice. Returns { externalId, redirectUrl, raw }.
   */
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
    if (currency !== 'UAH') {
      // Monobank supports UAH only.
      throw new Error(`Monobank Acquiring supports UAH only (got ${currency})`);
    }
    if (!amount || amount <= 0) throw new Error('Invoice amount must be > 0');

    // Monobank expects amount in coins (UAH * 100), integer.
    const amountKopecks = Math.round(Number(amount) * 100);

    // Build basket order — kopecks too, integer
    const basketOrder = items.map((i) => ({
      name: String(i.name).slice(0, 128),
      qty: Math.max(1, Number(i.qty) || 1),
      sum: Math.round(Number(i.price) * 100),
      icon: i.image || undefined,
      unit: i.unit || 'шт.',
    }));

    const requestBody = {
      amount: amountKopecks,
      ccy: 980, // UAH ISO 4217
      merchantPaymInfo: {
        reference: orderRef,
        destination: description || `Замовлення ${orderRef}`,
        comment: description || undefined,
        basketOrder: basketOrder.length > 0 ? basketOrder : undefined,
        customerEmails: customer.email ? [customer.email] : undefined,
      },
      redirectUrl: returnUrl,
      webHookUrl: webhookUrl,
      validity: 3600, // seconds — invoice expires in 1 hour
      paymentType: 'debit',
    };

    // Strip undefined keys (Monobank rejects null in nested objects)
    pruneUndefined(requestBody);

    const r = await axios.post(`${BASE_URL}/api/merchant/invoice/create`, requestBody, {
      headers: {
        'X-Token': credentials.token,
        'Content-Type': 'application/json',
      },
      // Monobank sometimes returns 400 with structured error — keep response.
      validateStatus: (s) => s < 500,
    });

    if (r.status >= 400) {
      const err = r.data?.errText || JSON.stringify(r.data);
      throw new Error(`Monobank invoice/create failed (${r.status}): ${err}`);
    }
    if (!r.data?.invoiceId || !r.data?.pageUrl) {
      throw new Error(`Monobank invoice/create returned unexpected payload: ${JSON.stringify(r.data)}`);
    }

    return {
      externalId: r.data.invoiceId,
      redirectUrl: r.data.pageUrl,
      raw: r.data,
    };
  },

  /**
   * Verify webhook signature.
   * Monobank signs the RAW request body with ECDSA SHA256.
   * Header: X-Sign (base64-encoded signature).
   * Public key is fetched from /api/merchant/pubkey.
   */
  async verifyWebhook({ rawBody, headers, credentials }) {
    const sigB64 = headers['x-sign'] || headers['X-Sign'];
    if (!sigB64) throw new Error('Missing X-Sign header');
    if (!rawBody) throw new Error('Webhook verification requires raw body');

    const keyObj = await getPubkey(credentials.token);
    const data = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : Buffer.from(rawBody);
    const sig = Buffer.from(sigB64, 'base64');

    // Try DER-encoded signature first (standard ECDSA), then IEEE P1363 (r||s)
    // as a fallback — Monobank has used both in different environments.
    let ok = false;
    try {
      ok = crypto.verify('SHA256', data, keyObj, sig);
    } catch {
      try {
        ok = crypto.verify('SHA256', data, { key: keyObj, dsaEncoding: 'ieee-p1363' }, sig);
      } catch (e) {
        throw new Error(`Signature verification failed: ${e.message}`);
      }
    }
    if (!ok) throw new Error('Monobank webhook signature is invalid');
    return true;
  },

  /**
   * Normalise webhook payload to { externalId, status, amount, raw }.
   * Monobank statuses: created, processing, hold, success, failure, reversed, expired.
   */
  parseWebhook({ body }) {
    if (!body || !body.invoiceId) {
      throw new Error('Monobank webhook missing invoiceId');
    }
    const status = mapStatus(body.status);
    return {
      externalId: body.invoiceId,
      status,
      amount: body.amount != null ? body.amount / 100 : undefined, // kopecks → UAH
      orderRef: body.reference,
      raw: body,
    };
  },

  /**
   * Lightweight credentials check. Mono Acquiring exposes
   * GET /api/merchant/details which returns merchant info for a valid X-Token
   * and 403/401 with structured errText otherwise.
   */
  async verifyCredentials(credentials) {
    const r = await axios.get(`${BASE_URL}/api/merchant/details`, {
      headers: { 'X-Token': credentials.token },
      validateStatus: (s) => s < 500,
    });
    if (r.status === 200 && r.data?.merchantId) {
      return {
        ok: true,
        info: { merchantId: r.data.merchantId, merchantName: r.data.merchantName, edrpou: r.data.edrpou },
      };
    }
    return { ok: false, error: r.data?.errText || `HTTP ${r.status}` };
  },

  /**
   * Optional poll fallback.
   */
  async getInvoice(externalId, credentials) {
    const r = await axios.get(`${BASE_URL}/api/merchant/invoice/status`, {
      params: { invoiceId: externalId },
      headers: { 'X-Token': credentials.token },
    });
    return {
      status: mapStatus(r.data?.status),
      raw: r.data,
    };
  },
};

/* ─── helpers ─── */

function mapStatus(monoStatus) {
  switch (monoStatus) {
    case 'success':
    case 'hold':
      return 'success';
    case 'failure':
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

function pruneUndefined(obj) {
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) delete obj[k];
    else if (obj[k] && typeof obj[k] === 'object') pruneUndefined(obj[k]);
  }
}

module.exports = provider;
