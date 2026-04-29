/**
 * Hardcoded subscription plan definitions.
 * Prices in UAH (integers). annualMonthlyPrice = price per month when paid annually.
 */
const PLANS = {
  free: {
    code: 'free',
    name: 'FREE',
    monthlyPrice: 0,
    annualMonthlyPrice: null,
    orderLimit: 30,
    overagePer100: null,   // null = checkout is blocked when limit exceeded
  },
  growth: {
    code: 'growth',
    name: 'GROWTH',
    monthlyPrice: 990,
    annualMonthlyPrice: 832,
    orderLimit: 300,
    overagePer100: 290,
  },
  scale: {
    code: 'scale',
    name: 'SCALE',
    monthlyPrice: 2990,
    annualMonthlyPrice: 2490,
    orderLimit: 1500,
    overagePer100: 250,
  },
};

function getPlan(code) {
  return PLANS[code] || PLANS.free;
}

/** Price for one billing cycle: monthly or the full annual payment. */
function getBillingAmount(planCode, billingPeriod) {
  const plan = getPlan(planCode);
  if (plan.monthlyPrice === 0) return 0;
  if (billingPeriod === 'annual') {
    return (plan.annualMonthlyPrice || plan.monthlyPrice) * 12;
  }
  return plan.monthlyPrice;
}

module.exports = { PLANS, getPlan, getBillingAmount };
