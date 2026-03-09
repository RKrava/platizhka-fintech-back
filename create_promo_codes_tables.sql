-- Таблица промокодов
CREATE TABLE IF NOT EXISTS promo_codes (
    id SERIAL PRIMARY KEY,
    store_id INTEGER NOT NULL,
    code VARCHAR(50) NOT NULL,
    discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'fixed_amount', 'free_delivery')),
    discount_value DECIMAL(10,2) DEFAULT 0,
    min_order_amount DECIMAL(10,2) DEFAULT 0,
    max_uses INTEGER DEFAULT NULL,
    used_count INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    starts_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(store_id, code)
);

-- Таблица использований промокодов
CREATE TABLE IF NOT EXISTS promo_code_usage (
    id SERIAL PRIMARY KEY,
    promo_code_id INTEGER NOT NULL REFERENCES promo_codes(id),
    order_id VARCHAR(255),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(50),
    discount_applied DECIMAL(10,2),
    used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_store_code ON promo_codes(store_id, code);
CREATE INDEX IF NOT EXISTS idx_promo_code_usage_code_id ON promo_code_usage(promo_code_id);
