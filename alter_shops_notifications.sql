-- Notification settings per shop
ALTER TABLE shops ADD COLUMN IF NOT EXISTS turbosms_sender VARCHAR(50);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS abandoned_promo_code VARCHAR(50);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS abandoned_notifications_enabled BOOLEAN DEFAULT false;
