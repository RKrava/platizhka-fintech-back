/**
 * POST /auth-events/signup
 *
 * Supabase Database Webhook — fires when a new row is inserted in auth.users.
 * Configure in: Supabase Dashboard → Database → Webhooks → Create webhook
 *   Table:  users  (schema: auth)
 *   Events: INSERT
 *   URL:    https://api.platizhka.com/auth-events/signup
 */

const express = require('express');
const { notifyNewUser } = require('../telegram/notify');

const router = express.Router();
router.use(express.json());

router.post('/signup', async (req, res) => {
  try {
    const body = req.body;

    // Supabase webhook payload: { type, table, schema, record, old_record }
    const record = body.record || body.user || body;

    await notifyNewUser({
      email:     record.email || record.new_email,
      id:        record.id,
      createdAt: record.created_at,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error('[auth-events/signup]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
