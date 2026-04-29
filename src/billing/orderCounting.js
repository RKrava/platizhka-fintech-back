/**
 * Per-shop monthly order counter.
 * `period_start` is always the 1st of the current calendar month (UTC).
 */
const supabase = require('../config/supabase');
const { getPlan } = require('./plans');
const { getSubscription } = require('./subscriptions');

function currentPeriodStart() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** Get order count for shop in the current calendar month. */
async function getCurrentCount(shopId) {
  const period = currentPeriodStart();
  const { data } = await supabase
    .from('shop_order_counts')
    .select('order_count')
    .eq('shop_id', shopId)
    .eq('period_start', period)
    .maybeSingle();
  return data?.order_count ?? 0;
}

/** Get order count for a specific month (YYYY-MM-DD period_start). */
async function getCountForPeriod(shopId, periodStart) {
  const { data } = await supabase
    .from('shop_order_counts')
    .select('order_count')
    .eq('shop_id', shopId)
    .eq('period_start', periodStart)
    .maybeSingle();
  return data?.order_count ?? 0;
}

/** Atomically increment the order counter for the current month. */
async function incrementCount(shopId) {
  const period = currentPeriodStart();
  // Upsert: insert 1 or increment existing.
  const { error } = await supabase.rpc('increment_order_count', {
    p_shop_id: shopId,
    p_period_start: period,
  });
  if (error) {
    // Fallback: manual upsert if RPC not yet created.
    const count = await getCurrentCount(shopId);
    await supabase
      .from('shop_order_counts')
      .upsert(
        { shop_id: shopId, period_start: period, order_count: count + 1 },
        { onConflict: 'shop_id,period_start' },
      );
  }
}

/**
 * Check if this shop is allowed to create a new order.
 * Returns { allowed: bool, count: number, limit: number, planCode: string, blocked: bool }
 */
async function checkLimit(shopId) {
  const sub = await getSubscription(shopId);
  const plan = getPlan(sub.plan_code);
  const count = await getCurrentCount(shopId);

  // Cancelled subscription → treat as FREE limit behaviour.
  const effectivePlan = sub.status === 'cancelled' ? getPlan('free') : plan;
  const limit = effectivePlan.orderLimit;

  if (count >= limit && effectivePlan.overagePer100 === null) {
    // FREE (or cancelled) plan: hard block.
    return { allowed: false, blocked: true, count, limit, planCode: sub.plan_code, status: sub.status };
  }

  return { allowed: true, blocked: false, count, limit, planCode: sub.plan_code, status: sub.status };
}

module.exports = { getCurrentCount, getCountForPeriod, incrementCount, checkLimit, currentPeriodStart };
