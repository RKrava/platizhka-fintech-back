/**
 * Monobank Acquiring — platform billing payments.
 *
 * Two flows:
 *   1. Initial subscription  → createSubscriptionInvoice()
 *      Creates a regular invoice with saveCardData so user pays and card gets tokenised.
 *
 *   2. Recurring charge      → chargeWallet()
 *      Charges a previously saved cardToken directly (no user interaction).
 *
 * Uses BILLING_MONO_TOKEN (platform's own merchant token), not per-shop tokens.
 */

const axios = require('axios');

const BASE_URL = 'https://api.monobank.ua';

function getBillingToken() {
  const t = process.env.BILLING_MONO_TOKEN;
  if (!t) throw new Error('BILLING_MONO_TOKEN is not configured');
  return t;
}

/**
 * Create a Monobank invoice for the initial subscription payment.
 * Includes saveCardData so the card is tokenised on success.
 * Returns { invoiceId, pageUrl }.
 */
async function createSubscriptionInvoice({ shopId, amount, description, orderRef, returnUrl, webhookUrl }) {
  const token = getBillingToken();
  const amountKopecks = Math.round(amount * 100);

  const body = {
    amount: amountKopecks,
    ccy: 980,
    merchantPaymInfo: {
      reference: orderRef,
      destination: description,
    },
    redirectUrl: returnUrl,
    webHookUrl: webhookUrl,
    validity: 3600,
    paymentType: 'debit',
    saveCardData: {
      walletId: `shop_${shopId}`,
      saveCard: true,
    },
  };

  const r = await axios.post(`${BASE_URL}/api/merchant/invoice/create`, body, {
    headers: { 'X-Token': token, 'Content-Type': 'application/json' },
    validateStatus: (s) => s < 500,
  });

  if (r.status >= 400) {
    throw new Error(`Monobank invoice/create failed (${r.status}): ${r.data?.errText || JSON.stringify(r.data)}`);
  }
  if (!r.data?.invoiceId || !r.data?.pageUrl) {
    throw new Error(`Monobank invoice/create unexpected payload: ${JSON.stringify(r.data)}`);
  }
  return { invoiceId: r.data.invoiceId, pageUrl: r.data.pageUrl };
}

/**
 * Charge a saved card via Monobank wallet.
 * Returns { status, invoiceId, failureReason? }
 * Monobank processes it synchronously and also fires a webhook.
 */
async function chargeWallet({ cardToken, amount, description, orderRef, webhookUrl }) {
  const token = getBillingToken();
  const amountKopecks = Math.round(amount * 100);

  const body = {
    cardToken,
    amount: amountKopecks,
    ccy: 980,
    merchantPaymInfo: {
      reference: orderRef,
      destination: description,
    },
    webHookUrl: webhookUrl,
    initiationKind: 'merchant', // platform-initiated recurring
  };

  const r = await axios.post(`${BASE_URL}/api/merchant/wallet/payment`, body, {
    headers: { 'X-Token': token, 'Content-Type': 'application/json' },
    validateStatus: (s) => s < 500,
  });

  if (r.status >= 400) {
    return {
      status: 'failed',
      failureReason: r.data?.errText || `HTTP ${r.status}`,
      raw: r.data,
    };
  }

  return {
    status: r.data?.status === 'success' ? 'success' : 'processing',
    invoiceId: r.data?.invoiceId,
    raw: r.data,
  };
}

/** Get invoice status (used to poll after createSubscriptionInvoice if webhook is delayed). */
async function getInvoiceStatus(invoiceId) {
  const token = getBillingToken();
  const r = await axios.get(`${BASE_URL}/api/merchant/invoice/status`, {
    params: { invoiceId },
    headers: { 'X-Token': token },
  });
  return r.data;
}

module.exports = { createSubscriptionInvoice, chargeWallet, getInvoiceStatus };
