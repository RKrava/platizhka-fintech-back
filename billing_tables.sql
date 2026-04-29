-- ─── Billing / Subscription tables ───────────────────────────────────────────
-- Run this once in Supabase SQL editor.

-- 1. Active subscription per shop (one row per shop, upserted).
CREATE TABLE IF NOT EXISTS shop_subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               integer NOT NULL UNIQUE,
  plan_code             text    NOT NULL DEFAULT 'free',   -- free | growth | scale
  status                text    NOT NULL DEFAULT 'active', -- active | past_due | cancelled
  billing_period        text    NOT NULL DEFAULT 'monthly',-- monthly | annual
  current_period_start  date,
  current_period_end    date,
  next_billing_at       date,
  cancel_at_period_end  boolean NOT NULL DEFAULT false,
  card_token            text,   -- Monobank walletData.cardToken (for recurring)
  card_mask             text,   -- e.g. "444403******1902"
  card_brand            text,   -- "Visa" / "Mastercard"
  payment_retry_count   integer NOT NULL DEFAULT 0,
  last_payment_attempt  timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 2. Monthly order counter per shop (calendar month).
CREATE TABLE IF NOT EXISTS shop_order_counts (
  shop_id      integer NOT NULL,
  period_start date    NOT NULL,  -- always first of month, e.g. 2025-04-01
  order_count  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, period_start)
);

-- 3. Billing invoices (subscription fees + overage charges).
CREATE TABLE IF NOT EXISTS subscription_invoices (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id              integer NOT NULL,
  type                 text    NOT NULL,           -- subscription | overage
  amount               integer NOT NULL,           -- UAH (integer kopecks ×100 handled in code)
  status               text    NOT NULL DEFAULT 'pending', -- pending | paid | failed | void
  mono_invoice_id      text,                       -- for initial subscription payment (pageUrl flow)
  mono_wallet_response jsonb,                      -- raw response from wallet/payment (recurring)
  billing_month        text,                       -- YYYY-MM, the month this covers
  overage_orders       integer,                    -- how many orders triggered overage
  meta                 jsonb,                      -- extra data (plan_code, billing_period for initial payment)
  failure_reason       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  paid_at              timestamptz
);

-- 4. RPC for atomic order count increment (avoids race conditions).
CREATE OR REPLACE FUNCTION increment_order_count(p_shop_id integer, p_period_start date)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO shop_order_counts (shop_id, period_start, order_count)
  VALUES (p_shop_id, p_period_start, 1)
  ON CONFLICT (shop_id, period_start)
  DO UPDATE SET order_count = shop_order_counts.order_count + 1;
END;
$$;

-- 5. Audit log for debugging billing events.
CREATE TABLE IF NOT EXISTS subscription_events (
  id         bigserial PRIMARY KEY,
  shop_id    integer   NOT NULL,
  event      text      NOT NULL,
  data       jsonb     NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
