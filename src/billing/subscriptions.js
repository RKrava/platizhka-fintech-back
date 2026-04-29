/**
 * CRUD helpers for shop_subscriptions table.
 */
const supabase = require('../config/supabase');

/** Get subscription for a shop; returns FREE defaults if none exists. */
async function getSubscription(shopId) {
  const { data, error } = await supabase
    .from('shop_subscriptions')
    .select('*')
    .eq('shop_id', shopId)
    .maybeSingle();
  if (error) throw new Error(`getSubscription failed: ${error.message}`);
  if (!data) {
    return {
      shop_id: shopId,
      plan_code: 'free',
      status: 'active',
      billing_period: 'monthly',
      current_period_start: null,
      current_period_end: null,
      next_billing_at: null,
      card_token: null,
      card_mask: null,
      card_brand: null,
      payment_retry_count: 0,
    };
  }
  return data;
}

/** Upsert a subscription row. */
async function upsertSubscription(shopId, patch) {
  const { data, error } = await supabase
    .from('shop_subscriptions')
    .upsert({ shop_id: shopId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'shop_id' })
    .select()
    .single();
  if (error) throw new Error(`upsertSubscription failed: ${error.message}`);
  return data;
}

/** Calculate period dates starting from today. */
function calcPeriod(billingPeriod) {
  const now = new Date();
  const start = toDateStr(now);
  const end = new Date(now);
  if (billingPeriod === 'annual') {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  end.setDate(end.getDate() - 1);
  const nextBilling = new Date(end);
  nextBilling.setDate(nextBilling.getDate() + 1);
  return { start, end: toDateStr(end), nextBilling: toDateStr(nextBilling) };
}

/** Advance subscription to next billing period. */
async function advancePeriod(shopId, billingPeriod) {
  const period = calcPeriod(billingPeriod);
  return upsertSubscription(shopId, {
    status: 'active',
    current_period_start: period.start,
    current_period_end: period.end,
    next_billing_at: period.nextBilling,
    payment_retry_count: 0,
    last_payment_attempt: new Date().toISOString(),
  });
}

/** Activate a new paid subscription (called from billing webhook). */
async function activateSubscription(shopId, { planCode, billingPeriod, cardToken, cardMask, cardBrand }) {
  const period = calcPeriod(billingPeriod);
  return upsertSubscription(shopId, {
    plan_code: planCode,
    status: 'active',
    billing_period: billingPeriod,
    current_period_start: period.start,
    current_period_end: period.end,
    next_billing_at: period.nextBilling,
    card_token: cardToken || null,
    card_mask: cardMask || null,
    card_brand: cardBrand || null,
    payment_retry_count: 0,
    last_payment_attempt: new Date().toISOString(),
  });
}

/** Mark subscription as past_due; after maxRetries → cancelled. */
async function markPaymentFailed(shopId, { maxRetries = 3 } = {}) {
  const sub = await getSubscription(shopId);
  const retries = (sub.payment_retry_count || 0) + 1;
  const newStatus = retries >= maxRetries ? 'cancelled' : 'past_due';
  return upsertSubscription(shopId, {
    status: newStatus,
    payment_retry_count: retries,
    last_payment_attempt: new Date().toISOString(),
  });
}

/** Downgrade to FREE (used when cancellation takes effect). */
async function downgradeToFree(shopId) {
  return upsertSubscription(shopId, {
    plan_code: 'free',
    status: 'active',
    billing_period: 'monthly',
    current_period_start: null,
    current_period_end: null,
    next_billing_at: null,
    card_token: null,
    card_mask: null,
    cancel_at_period_end: false,
    payment_retry_count: 0,
  });
}

/** Log a billing event for debugging. */
async function logEvent(shopId, event, data = {}) {
  await supabase.from('subscription_events').insert({ shop_id: shopId, event, data });
}

function toDateStr(d) {
  return d.toISOString().split('T')[0];
}

module.exports = {
  getSubscription,
  upsertSubscription,
  activateSubscription,
  advancePeriod,
  markPaymentFailed,
  downgradeToFree,
  logEvent,
};
