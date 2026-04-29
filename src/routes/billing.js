/**
 * Billing routes.
 *
 *   GET  /billing/status          — shop billing status (auth required)
 *   POST /billing/subscribe       — initiate subscription payment (auth required)
 *   POST /billing/cancel          — cancel subscription (auth required)
 *   GET  /billing/invoices        — invoice history (auth required)
 *   POST /billing/webhook         — Monobank callback for billing payments (no auth)
 *   POST /billing/cron            — cron trigger (BILLING_CRON_SECRET header)
 */

const express = require('express');
const crypto = require('crypto');
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth');
const { getPlan, getBillingAmount } = require('../billing/plans');
const { getSubscription, activateSubscription, downgradeToFree, logEvent } = require('../billing/subscriptions');
const { getCurrentCount, checkLimit } = require('../billing/orderCounting');
const { createSubscriptionInvoice } = require('../billing/monoWallet');
const { runBillingCron } = require('../billing/billingCron');

const router = express.Router();

// ─── Public billing webhook (raw body already set by index.js) ────────────────
router.post('/webhook', async (req, res) => {
  try {
    const rawBody = req.body;
    let body;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const { invoiceId, status, walletData } = body;
    if (!invoiceId) return res.status(400).json({ error: 'Missing invoiceId' });

    // Verify Monobank signature using the billing token.
    const sigB64 = req.headers['x-sign'] || req.headers['X-Sign'];
    if (sigB64) {
      try {
        await verifyBillingSignature(rawBody, sigB64);
      } catch (e) {
        console.warn('[billing/webhook] Signature verification failed:', e.message);
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    console.log(`[billing/webhook] invoiceId=${invoiceId} status=${status}`);

    // Find the pending subscription invoice by mono_invoice_id.
    const { data: inv } = await supabase
      .from('subscription_invoices')
      .select('*')
      .eq('mono_invoice_id', invoiceId)
      .maybeSingle();

    if (!inv) {
      console.warn('[billing/webhook] Invoice not found:', invoiceId);
      return res.status(200).json({ ok: true }); // Acknowledge to avoid retries.
    }

    if (status === 'success') {
      // Activate subscription and save card token.
      await supabase
        .from('subscription_invoices')
        .update({ status: 'paid', paid_at: new Date().toISOString(), mono_wallet_response: body })
        .eq('id', inv.id);

      // Extract card token from walletData if present.
      const cardToken = walletData?.cardToken || null;
      const cardMask = walletData?.cardMask || null;
      const cardBrand = walletData?.status === 'created' ? detectBrand(cardMask) : null;

      if (inv.type === 'subscription') {
        const meta = inv.meta || {};
        await activateSubscription(inv.shop_id, {
          planCode: meta.plan_code,
          billingPeriod: meta.billing_period,
          cardToken,
          cardMask,
          cardBrand,
        });
        await logEvent(inv.shop_id, 'subscription_activated', { plan: meta.plan_code, cardMask });
        console.log(`[billing/webhook] Shop ${inv.shop_id}: subscription activated (${meta.plan_code})`);
      }
    } else if (status === 'failure' || status === 'expired') {
      await supabase
        .from('subscription_invoices')
        .update({ status: 'failed', failure_reason: body.failureReason || status, mono_wallet_response: body })
        .eq('id', inv.id);
      await logEvent(inv.shop_id, 'subscription_payment_failed', { status, invoiceId });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[billing/webhook] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ─── Auth-protected routes ────────────────────────────────────────────────────
router.use(express.json());

/** GET /billing/status?shopId=X — returns plan, usage, subscription info */
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const shopId = parseInt(req.query.shopId, 10);
    if (!shopId) return res.status(400).json({ error: 'shopId required' });

    await assertShopOwner(shopId, req.user.id);

    const sub = await getSubscription(shopId);
    const plan = getPlan(sub.plan_code);
    const count = await getCurrentCount(shopId);
    const limit = plan.orderLimit;

    const { data: invoices } = await supabase
      .from('subscription_invoices')
      .select('id, type, amount, status, billing_month, overage_orders, created_at, paid_at')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .limit(20);

    return res.json({
      subscription: sub,
      plan,
      usage: { count, limit, pct: Math.min(100, Math.round((count / limit) * 100)) },
      invoices: invoices || [],
    });
  } catch (e) {
    console.error('[billing/status]', e.message);
    return res.status(e.status || 500).json({ error: e.message });
  }
});

/** POST /billing/subscribe — initiate first subscription payment */
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { shopId, planCode, billingPeriod = 'monthly' } = req.body;
    if (!shopId || !planCode) return res.status(400).json({ error: 'shopId and planCode required' });
    if (!['growth', 'scale'].includes(planCode)) return res.status(400).json({ error: 'Invalid plan' });
    if (!['monthly', 'annual'].includes(billingPeriod)) return res.status(400).json({ error: 'Invalid billingPeriod' });

    await assertShopOwner(shopId, req.user.id);

    const plan = getPlan(planCode);
    const amount = getBillingAmount(planCode, billingPeriod);
    const billingMonth = new Date().toISOString().slice(0, 7);
    const orderRef = `sub_${shopId}_${billingMonth}_${Date.now()}`;

    const apiBase = process.env.API_PUBLIC_URL || 'https://api.platizhka.com';
    const frontendBase = process.env.FRONTEND_URL || 'https://www.platizhka.com';
    const webhookUrl = `${apiBase}/billing/webhook`;
    const returnUrl = `${frontendBase}/user?section=subscription&subscribed=1`;

    const { invoiceId, pageUrl } = await createSubscriptionInvoice({
      shopId,
      amount,
      description: `Підписка ${plan.name} (${billingPeriod === 'annual' ? 'рік' : 'місяць'})`,
      orderRef,
      returnUrl,
      webhookUrl,
    });

    // Save pending subscription invoice so webhook can find it.
    await supabase.from('subscription_invoices').insert({
      shop_id: shopId,
      type: 'subscription',
      amount,
      status: 'pending',
      mono_invoice_id: invoiceId,
      billing_month: billingMonth,
      meta: { plan_code: planCode, billing_period: billingPeriod },
    });

    await logEvent(shopId, 'subscription_initiated', { planCode, billingPeriod, amount, invoiceId });

    return res.json({ redirectUrl: pageUrl, invoiceId });
  } catch (e) {
    console.error('[billing/subscribe]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/** POST /billing/cancel — cancel at end of current period */
router.post('/cancel', authMiddleware, async (req, res) => {
  try {
    const { shopId } = req.body;
    if (!shopId) return res.status(400).json({ error: 'shopId required' });
    await assertShopOwner(shopId, req.user.id);

    const sub = await getSubscription(shopId);
    if (sub.plan_code === 'free') return res.json({ ok: true, message: 'Already on free plan' });

    // Mark cancel_at_period_end — cron will downgrade when period expires.
    const { error } = await supabase
      .from('shop_subscriptions')
      .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
      .eq('shop_id', shopId);
    if (error) throw new Error(error.message);

    await logEvent(shopId, 'subscription_cancel_requested', { planCode: sub.plan_code });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[billing/cancel]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/** GET /billing/invoices?shopId=X */
router.get('/invoices', authMiddleware, async (req, res) => {
  try {
    const shopId = parseInt(req.query.shopId, 10);
    if (!shopId) return res.status(400).json({ error: 'shopId required' });
    await assertShopOwner(shopId, req.user.id);

    const { data, error } = await supabase
      .from('subscription_invoices')
      .select('id, type, amount, status, billing_month, overage_orders, created_at, paid_at, failure_reason')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    return res.json({ invoices: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** POST /billing/cron — daily billing runner; requires BILLING_CRON_SECRET */
router.post('/cron', async (req, res) => {
  const secret = process.env.BILLING_CRON_SECRET;
  const provided = req.headers['x-cron-secret'] || req.body?.cronSecret;
  if (!secret || provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await runBillingCron();
    return res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[billing/cron]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function assertShopOwner(shopId, userId) {
  const { data } = await supabase
    .from('shops')
    .select('user_id')
    .eq('id', shopId)
    .maybeSingle();
  if (!data || data.user_id !== userId) {
    const err = new Error('Access denied');
    err.status = 403;
    throw err;
  }
}

function detectBrand(mask) {
  if (!mask) return null;
  if (mask.startsWith('4')) return 'Visa';
  if (mask.startsWith('5') || mask.startsWith('2')) return 'Mastercard';
  return null;
}

// In-process pubkey cache for billing webhook verification (mirrors monobankAcquiring.js).
const pubkeyCache = new Map();
const axios = require('axios');

async function verifyBillingSignature(rawBody, sigB64) {
  const token = process.env.BILLING_MONO_TOKEN;
  if (!token) return; // Skip if not configured.

  let keyObj = pubkeyCache.get(token)?.keyObj;
  if (!keyObj || Date.now() - pubkeyCache.get(token).fetchedAt > 24 * 3600 * 1000) {
    const r = await axios.get('https://api.monobank.ua/api/merchant/pubkey', { headers: { 'X-Token': token } });
    const raw = r.data?.key;
    if (!raw) throw new Error('Missing pubkey from Monobank');
    const pem = Buffer.from(raw, 'base64').toString('utf8');
    keyObj = crypto.createPublicKey(pem);
    pubkeyCache.set(token, { keyObj, fetchedAt: Date.now() });
  }

  const data = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : Buffer.from(rawBody);
  const sig = Buffer.from(sigB64, 'base64');
  let ok = false;
  try { ok = crypto.verify('SHA256', data, keyObj, sig); } catch {
    try { ok = crypto.verify('SHA256', data, { key: keyObj, dsaEncoding: 'ieee-p1363' }, sig); } catch {}
  }
  if (!ok) throw new Error('Billing webhook signature invalid');
}

module.exports = router;
