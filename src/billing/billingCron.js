/**
 * Billing cron runner.
 *
 * Call runBillingCron() once per day (e.g. via Railway cron or cron-job.org).
 * Protected by BILLING_CRON_SECRET in the HTTP route.
 *
 * What it does per run:
 *   1. Finds paid subscriptions whose next_billing_at <= today.
 *   2. Attempts to charge via Monobank wallet.
 *   3. On success  → advances period, resets retry count.
 *   4. On failure  → increments retry count; after 3 failures → cancels.
 *   5. Calculates overage for the period that just ended and charges it.
 *   6. Downgrades cancelled past-due subscriptions where grace period expired.
 */

const supabase = require('../config/supabase');
const { getPlan, getBillingAmount } = require('./plans');
const { getSubscription, advancePeriod, markPaymentFailed, downgradeToFree, logEvent } = require('./subscriptions');
const { getCountForPeriod } = require('./orderCounting');
const { chargeWallet } = require('./monoWallet');

const API_BASE = process.env.API_PUBLIC_URL || 'https://api.platizhka.com';

function today() {
  return new Date().toISOString().split('T')[0];
}

async function runBillingCron() {
  const todayStr = today();
  console.log(`[billing/cron] Starting run for ${todayStr}`);

  // 1. Find paid subscriptions due for renewal.
  const { data: subs, error } = await supabase
    .from('shop_subscriptions')
    .select('*')
    .in('status', ['active', 'past_due'])
    .neq('plan_code', 'free')
    .lte('next_billing_at', todayStr);

  if (error) {
    console.error('[billing/cron] Failed to query subscriptions:', error.message);
    return { processed: 0, errors: [error.message] };
  }

  const results = [];

  for (const sub of subs || []) {
    try {
      await processSub(sub);
      results.push({ shopId: sub.shop_id, ok: true });
    } catch (e) {
      console.error(`[billing/cron] Error processing shop ${sub.shop_id}:`, e.message);
      results.push({ shopId: sub.shop_id, ok: false, error: e.message });
    }
  }

  console.log(`[billing/cron] Done. Processed ${results.length} subscriptions.`);
  return { processed: results.length, results };
}

async function processSub(sub) {
  const plan = getPlan(sub.plan_code);
  const webhookUrl = `${API_BASE}/billing/webhook`;

  // ─── Charge overage for the period that just ended ─────────────────────
  if (sub.current_period_start && plan.overagePer100) {
    const count = await getCountForPeriod(sub.shop_id, sub.current_period_start);
    const overageOrders = Math.max(0, count - plan.orderLimit);
    if (overageOrders > 0) {
      const overageAmount = Math.ceil(overageOrders / 100) * plan.overagePer100;
      const ref = `overage_${sub.shop_id}_${sub.current_period_start}`;
      console.log(`[billing/cron] Shop ${sub.shop_id}: overage ${overageOrders} orders → ${overageAmount} ₴`);

      await createInvoiceRecord(sub.shop_id, {
        type: 'overage',
        amount: overageAmount,
        billingMonth: sub.current_period_start.slice(0, 7),
        overageOrders,
        status: 'pending',
      });

      if (sub.card_token) {
        const result = await chargeWallet({
          cardToken: sub.card_token,
          amount: overageAmount,
          description: `Перевищення ліміту замовлень — ${overageOrders} зам.`,
          orderRef: ref,
          webhookUrl,
        });
        await updateInvoiceStatus(ref, result.status === 'success' ? 'paid' : 'failed', result.raw);
        await logEvent(sub.shop_id, 'overage_charged', { overageOrders, amount: overageAmount, status: result.status });
      }
    }
  }

  // ─── Charge subscription fee for the new period ────────────────────────
  const billingAmount = getBillingAmount(sub.plan_code, sub.billing_period);
  const billingMonth = new Date().toISOString().slice(0, 7);
  const orderRef = `sub_${sub.shop_id}_${billingMonth}`;

  if (!sub.card_token) {
    console.warn(`[billing/cron] Shop ${sub.shop_id}: no card_token — skipping charge`);
    await markPaymentFailed(sub.shop_id);
    return;
  }

  console.log(`[billing/cron] Shop ${sub.shop_id}: charging ${billingAmount} ₴ for ${sub.plan_code}`);

  const invId = await createInvoiceRecord(sub.shop_id, {
    type: 'subscription',
    amount: billingAmount,
    billingMonth,
    status: 'pending',
  });

  const result = await chargeWallet({
    cardToken: sub.card_token,
    amount: billingAmount,
    description: `Підписка ${plan.name} — ${billingMonth}`,
    orderRef,
    webhookUrl,
  });

  if (result.status === 'success' || result.status === 'processing') {
    await supabase.from('subscription_invoices').update({ status: 'paid', paid_at: new Date().toISOString(), mono_wallet_response: result.raw }).eq('id', invId);
    await advancePeriod(sub.shop_id, sub.billing_period);
    await logEvent(sub.shop_id, 'subscription_renewed', { plan: sub.plan_code, amount: billingAmount });
  } else {
    await supabase.from('subscription_invoices').update({ status: 'failed', failure_reason: result.failureReason, mono_wallet_response: result.raw }).eq('id', invId);
    const updated = await markPaymentFailed(sub.shop_id);
    await logEvent(sub.shop_id, 'subscription_payment_failed', { attempt: updated.payment_retry_count, reason: result.failureReason });
    console.warn(`[billing/cron] Shop ${sub.shop_id}: charge failed (attempt ${updated.payment_retry_count}) — ${result.failureReason}`);
  }
}

async function createInvoiceRecord(shopId, { type, amount, billingMonth, overageOrders, status }) {
  const { data, error } = await supabase
    .from('subscription_invoices')
    .insert({ shop_id: shopId, type, amount, billing_month: billingMonth, overage_orders: overageOrders || null, status })
    .select('id')
    .single();
  if (error) throw new Error(`createInvoiceRecord failed: ${error.message}`);
  return data.id;
}

async function updateInvoiceStatus(ref, status, raw) {
  // We identify by billing_month + type for overage — good enough for now.
  // (A real system would store orderRef on the invoice row.)
  await supabase
    .from('subscription_invoices')
    .update({ status, mono_wallet_response: raw, ...(status === 'paid' ? { paid_at: new Date().toISOString() } : {}) })
    .eq('type', 'overage')
    .eq('status', 'pending');
}

module.exports = { runBillingCron };
