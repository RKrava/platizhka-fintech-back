-- SQL скрипт для создания таблицы invoice_connectors в Neon
-- Таблица для связывания внутренних UUID с UUID от Monobank и Shopify

CREATE TABLE IF NOT EXISTS invoice_connectors (
    id UUID PRIMARY KEY,
    mono_id UUID UNIQUE,
    order_shopify_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Создаем индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_invoice_connectors_id ON invoice_connectors(id);
CREATE INDEX IF NOT EXISTS idx_invoice_connectors_mono_id ON invoice_connectors(mono_id);
CREATE INDEX IF NOT EXISTS idx_invoice_connectors_order_shopify_id ON invoice_connectors(order_shopify_id);
CREATE INDEX IF NOT EXISTS idx_invoice_connectors_created_at ON invoice_connectors(created_at);

-- Комментарии к таблице и полям
COMMENT ON TABLE invoice_connectors IS 'Таблица для связывания внутренних UUID с UUID от Monobank и Shopify';
COMMENT ON COLUMN invoice_connectors.id IS 'Внутренний UUID (генерируется автоматически)';
COMMENT ON COLUMN invoice_connectors.mono_id IS 'UUID от Monobank (может быть NULL до связывания)';
COMMENT ON COLUMN invoice_connectors.order_shopify_id IS 'ID заказа от Shopify (может быть NULL до связывания)';
COMMENT ON COLUMN invoice_connectors.created_at IS 'Время создания записи';
