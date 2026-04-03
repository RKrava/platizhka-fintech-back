-- Run this if the table already exists
ALTER TABLE abandoned_checkouts ADD COLUMN IF NOT EXISTS cart_data TEXT;
