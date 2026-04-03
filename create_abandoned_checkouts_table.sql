CREATE TABLE IF NOT EXISTS abandoned_checkouts (
  id SERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL,
  cart_token VARCHAR(500),
  session_id VARCHAR(100) NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(255),
  city VARCHAR(255),
  warehouse VARCHAR(500),
  nova_poshta_type VARCHAR(50),
  payment_method VARCHAR(50),
  marketing_consent BOOLEAN DEFAULT false,
  recovery_token UUID UNIQUE DEFAULT gen_random_uuid(),
  status VARCHAR(20) DEFAULT 'abandoned',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_abandoned_session_store ON abandoned_checkouts(session_id, store_id);
CREATE INDEX IF NOT EXISTS idx_abandoned_store_status ON abandoned_checkouts(store_id, status);
CREATE INDEX IF NOT EXISTS idx_abandoned_recovery ON abandoned_checkouts(recovery_token);
