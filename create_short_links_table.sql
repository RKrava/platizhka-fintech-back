CREATE TABLE IF NOT EXISTS short_links (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) UNIQUE NOT NULL,
  target_url TEXT NOT NULL,
  store_id INTEGER,
  abandoned_checkout_id INTEGER,
  step INTEGER,                     -- which notification step generated this link
  clicks INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_short_code ON short_links(code);
