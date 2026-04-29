/**
 * Generic payments router. Provider-agnostic.
 * Uses Supabase service-role client (REST) — no direct Postgres connection.
 *
 *   POST   /payments/invoices                — create order + invoice
 *   POST   /payments/webhook/:providerCode   — receive provider webhook
 *   GET    /payments/invoices/:id            — get invoice status (poll-friendly)
 */

const express = require('express');
const supabase = require('../config/supabase');
const { getProvider } = require('../payments/registry');
const PaymentInvoice = require('../models/PaymentInvoice');
const { checkLimit, incrementCount } = require('../billing/orderCounting');

const router = express.Router();

// NOTE: raw body parser is mounted globally for /payments/webhook in index.js.
// `req.body` here is a Buffer.
router.post(
  '/webhook/:providerCode',
  async (req, res) => {
    const { providerCode } = req.params;
    let provider;
    try {
      provider = getProvider(providerCode);
    } catch (e) {
      return res.status(404).json({ error: e.message });
    }

    try {
      const rawBody = req.body; // Buffer
      let body;
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        body = {};
      }

      const externalId =
        body.invoiceId ||
        body.order_id ||
        body.orderId ||
        body.order_reference ||
        body.payment_id ||
        body.id;

      if (!externalId) {
        console.warn('[payments/webhook] No external id in body', body);
        return res.status(400).json({ error: 'Cannot identify invoice' });
      }

      const invoice = await PaymentInvoice.findByExternalId(providerCode, externalId);
      if (!invoice) {
        console.warn(`[payments/webhook] Unknown invoice ${providerCode}:${externalId}`);
        return res.status(404).json({ error: 'Invoice not found' });
      }

      const { data: methodRow, error: methodErr } = await supabase
        .from('shop_payment_methods')
        .select('credentials, is_test')
        .eq('shop_id', invoice.shop_id)
        .eq('provider_code', providerCode)
        .maybeSingle();
      if (methodErr) throw new Error(methodErr.message);
      const merchantCreds = methodRow?.credentials ?? {};
      const isTest = !!methodRow?.is_test; // use payment method sandbox flag for signature verification
      const credentials = provider.resolveCredentials(merchantCreds, { isTest });

      try {
        await provider.verifyWebhook({
          rawBody: rawBody.toString('utf8'),
          headers: req.headers,
          credentials,
          isTest,
        });
      } catch (e) {
        console.warn(`[payments/webhook] Signature verification failed: ${e.message}`);
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const event = provider.parseWebhook({
        rawBody: rawBody.toString('utf8'),
        body,
        headers: req.headers,
      });

      await invoice.setStatus(event.status, {
        webhook: event.raw,
        failureReason:
          event.status === 'failed'
            ? event.raw?.errorReason || event.raw?.failureReason
            : null,
      });

      // Update linked order status.
      if (invoice.order_id) {
        const orderStatus =
          event.status === 'success'
            ? 'paid'
            : event.status === 'failed'
            ? 'failed'
            : event.status === 'refunded'
            ? 'refunded'
            : null;
        if (orderStatus) {
          await supabase
            .from('orders')
            .update({ status: orderStatus })
            .eq('id', invoice.order_id);
        }
        // Increment monthly order counter on successful payment.
        if (event.status === 'success' && !invoice.is_test) {
          await incrementCount(invoice.shop_id).catch((e) =>
            console.warn('[payments/webhook] incrementCount failed:', e.message),
          );
          // Mark abandoned checkout as recovered.
          const { data: orderForSession } = await supabase
            .from('orders')
            .select('metadata')
            .eq('id', invoice.order_id)
            .maybeSingle();
          const sessionId = orderForSession?.metadata?.sessionId;
          if (sessionId) {
            await supabase
              .from('abandoned_checkouts')
              .update({ recovered: true })
              .eq('shop_id', invoice.shop_id)
              .eq('session_id', sessionId)
              .catch((e) => console.warn('[payments/webhook] abandoned recovery failed:', e.message));
          }
        }
      }

      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('[payments/webhook] error', error);
      return res.status(500).json({ error: error.message });
    }
  },
);

router.use(express.json());

/**
 * POST /payments/verify
 * Body: { providerCode, credentials, isTest? }
 *
 * Pings the provider with the given creds (without creating a real charge)
 * and returns { ok: true } if it accepts our keys, or { ok: false, error }.
 *
 * Used by the admin "Перевірити" button so a merchant knows immediately
 * whether their pasted token is right.
 */
router.post('/verify', async (req, res) => {
  try {
    const { providerCode, credentials = {}, isTest = false } = req.body;
    if (!providerCode) return res.status(400).json({ error: 'providerCode is required' });

    const provider = getProvider(providerCode);
    if (typeof provider.verifyCredentials !== 'function') {
      return res.json({ ok: true, info: { note: 'Provider has no verify endpoint — assumed valid.' } });
    }

    const resolved = provider.resolveCredentials(credentials, { isTest });
    const result = await provider.verifyCredentials(resolved);
    return res.json(result);
  } catch (error) {
    console.error('[payments/verify] error', error);
    return res.status(400).json({ ok: false, error: error.message });
  }
});

router.post('/invoices', async (req, res) => {
  try {
    const {
      shopId,
      providerCode,
      orderRef: clientOrderRef,
      amount,
      currency = 'UAH',
      description,
      items = [],
      amountShipping = null,
      customer = {},
      recipient = null,
      isGift = false,
      delivery = null,
      promoCode = null,
      promoDiscount = null,
      comment = null,
      needsCallback = false,
      marketingConsent = false,
      metadata = {},
      returnUrl,
      isTestCheckout = false,
    } = req.body;

    if (!shopId || !providerCode || !amount || !returnUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check billing limit (skip for test checkouts).
    if (!isTestCheckout) {
      const billing = await checkLimit(shopId);
      if (billing.blocked) {
        return res.status(402).json({
          error: 'checkout_disabled',
          reason: 'limit_exceeded',
          count: billing.count,
          limit: billing.limit,
          planCode: billing.planCode,
        });
      }
    }

    const isCOD = providerCode === 'cash_on_delivery';
    const provider = isCOD ? null : getProvider(providerCode);

    const { data: methodRow, error: methodErr } = await supabase
      .from('shop_payment_methods')
      .select('credentials, is_test, enabled')
      .eq('shop_id', shopId)
      .eq('provider_code', providerCode)
      .maybeSingle();
    if (methodErr) throw new Error(methodErr.message);
    if (!methodRow || !methodRow.enabled) {
      return res.status(400).json({ error: 'Payment method is not enabled for this shop' });
    }

    const merchantCreds = methodRow.credentials ?? {};
    const providerIsTest = !!methodRow.is_test;
    const isTest = isTestCheckout || providerIsTest;
    const credentials = isCOD ? null : provider.resolveCredentials(merchantCreds, { isTest });

    // 1) Insert order.
    const { data: orderRow, error: orderErr } = await supabase
      .from('orders')
      .insert({
        shop_id: shopId,
        customer,
        recipient,
        is_gift: !!isGift,
        delivery,
        payment: { provider: providerCode },
        amount_total: amount,
        amount_shipping: amountShipping,
        currency,
        items,
        promo_code: promoCode,
        promo_discount: promoDiscount,
        comment,
        needs_callback: !!needsCallback,
        marketing_consent: !!marketingConsent,
        status: 'pending',
        metadata: { ...metadata, isTestCheckout: !!isTestCheckout, providerIsTest },
        // Order is_test only when the checkout itself is test (dev panel / test page).
        // providerIsTest (payment method using sandbox creds) does NOT mark the order
        // as test — real customers can pay via a sandbox-configured provider during staging.
        is_test: !!isTestCheckout,
      })
      .select('id')
      .single();
    if (orderErr) throw new Error(`order insert failed: ${orderErr.message}`);
    const orderId = orderRow.id;

    const orderRef = clientOrderRef || `o_${orderId}_${Date.now()}`;

    // Append our internal orderId to the returnUrl so the post-payment page
    // can render details of THIS specific order (without trusting the user to
    // round-trip it via the provider).
    const returnUrlWithOrder = appendQuery(returnUrl, { orderId });
    const codReturnUrl = appendQuery(returnUrl, { orderId, paid: 'cod' });

    // Cash on delivery short-circuit.
    if (isCOD) {
      if (!isTest) {
        await incrementCount(shopId).catch((e) =>
          console.warn('[payments/invoices] COD incrementCount failed:', e.message),
        );
        // Mark abandoned checkout as recovered for COD orders.
        const sessionId = (metadata || {}).sessionId;
        if (sessionId) {
          await supabase
            .from('abandoned_checkouts')
            .update({ recovered: true })
            .eq('shop_id', shopId)
            .eq('session_id', sessionId)
            .catch((e) => console.warn('[payments/invoices] COD abandoned recovery failed:', e.message));
        }
      }
      return res.json({
        orderId,
        invoiceId: null,
        externalId: null,
        redirectUrl: codReturnUrl,
        orderRef,
        isTest,
        cashOnDelivery: true,
      });
    }

    const apiBase = process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const webhookUrl = `${apiBase}/payments/webhook/${providerCode}`;

    let result;
    try {
      result = await provider.createInvoice({
        amount,
        currency,
        orderRef,
        description: description || `Замовлення ${orderRef}`,
        items,
        returnUrl: returnUrlWithOrder,
        webhookUrl,
        customer: { ...customer, ...(recipient || {}) },
        credentials,
      });
    } catch (e) {
      // Roll back the order so we don't leave orphaned pending orders.
      await supabase.from('orders').delete().eq('id', orderId);
      throw e;
    }

    const invoice = await PaymentInvoice.create({
      shopId,
      orderId,
      providerCode,
      externalId: result.externalId,
      orderRef,
      amount,
      currency,
      isTest: !!isTestCheckout,
      redirectUrl: result.redirectUrl,
      payload: { request: { amount, currency, orderRef, items, customer }, response: result.raw },
    });

    return res.json({
      orderId,
      invoiceId: invoice.id,
      externalId: invoice.external_id,
      redirectUrl: invoice.redirect_url,
      orderRef,
      isTest,
    });
  } catch (error) {
    console.error('[payments/invoices] error', error);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/invoices/:id', async (req, res) => {
  try {
    const invoice = await PaymentInvoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Not found' });

    if (invoice.status === 'pending') {
      const provider = getProvider(invoice.provider_code);
      if (provider.getInvoice) {
        const { data: methodRow } = await supabase
          .from('shop_payment_methods')
          .select('credentials')
          .eq('shop_id', invoice.shop_id)
          .eq('provider_code', invoice.provider_code)
          .maybeSingle();
        const merchantCreds = methodRow?.credentials ?? {};
        const credentials = provider.resolveCredentials(merchantCreds, { isTest: invoice.is_test });
        try {
          const live = await provider.getInvoice(invoice.external_id, credentials);
          if (live.status && live.status !== 'pending') {
            await invoice.setStatus(live.status, { webhook: live.raw });
          }
        } catch (e) {
          console.warn(`[payments] poll ${invoice.id} failed: ${e.message}`);
        }
      }
    }

    return res.json({
      id: invoice.id,
      status: invoice.status,
      amount: Number(invoice.amount),
      currency: invoice.currency,
      providerCode: invoice.provider_code,
      isTest: invoice.is_test,
      redirectUrl: invoice.redirect_url,
      externalId: invoice.external_id,
      orderRef: invoice.order_ref,
    });
  } catch (error) {
    console.error('[payments/invoices/:id] error', error);
    return res.status(500).json({ error: error.message });
  }
});

/** Add or replace query parameters on a URL, preserving existing ones. */
function appendQuery(url, params) {
  try {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    return u.toString();
  } catch {
    // Fallback for relative URLs — naive concatenation.
    const sep = url.includes('?') ? '&' : '?';
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    return `${url}${sep}${qs}`;
  }
}

module.exports = router;
