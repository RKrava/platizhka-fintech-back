CREATE TABLE IF NOT EXISTS notification_log (
  id SERIAL PRIMARY KEY,
  abandoned_checkout_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  step INTEGER NOT NULL,
  channel VARCHAR(20) NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  message_id VARCHAR(255),
  status VARCHAR(20) DEFAULT 'sent',
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_checkout ON notification_log(abandoned_checkout_id, step);
CREATE INDEX IF NOT EXISTS idx_notif_store ON notification_log(store_id);
