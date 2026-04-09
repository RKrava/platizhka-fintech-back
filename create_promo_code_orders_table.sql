-- Таблица для отслеживания заказов с промокодами (статистика для інфлюенсерів)
-- Не трогаем старую promo_code_usage — эта таблица отдельно

CREATE TABLE IF NOT EXISTS promo_code_orders (
    id SERIAL PRIMARY KEY,
    store_id INTEGER NOT NULL,
    promo_code VARCHAR(50) NOT NULL,
    promo_code_id INTEGER REFERENCES promo_codes(id) ON DELETE SET NULL,
    order_id VARCHAR(255),
    order_total DECIMAL(10,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    discount_type VARCHAR(20),
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(50),
    payment_method VARCHAR(50),
    cart_data TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индексы для быстрых запросов статистики
CREATE INDEX IF NOT EXISTS idx_pco_store_id ON promo_code_orders(store_id);
CREATE INDEX IF NOT EXISTS idx_pco_promo_code ON promo_code_orders(promo_code);
CREATE INDEX IF NOT EXISTS idx_pco_created_at ON promo_code_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_pco_store_code ON promo_code_orders(store_id, promo_code);
