const express = require('express');
const Analytics = require('../models/Analytics');
const supabase = require('../config/supabase');
const router = express.Router();

/**
 * POST /analytics/event
 * Body: { shopId, eventType, sessionId?, payload? }
 * Inserts a row into analytics_events (checkout funnel tracking).
 * No auth required — public tracking endpoint.
 */
router.post('/event', async (req, res) => {
  try {
    const { shopId, eventType, sessionId = null, payload = {} } = req.body;
    if (!shopId || !eventType) {
      return res.status(400).json({ error: 'shopId and eventType are required' });
    }
    const { error } = await supabase.from('analytics_events').insert({
      shop_id: String(shopId),
      event_type: eventType,
      session_id: sessionId,
      payload,
    });
    if (error) {
      console.warn('[analytics/event] insert error:', error.message);
      return res.status(500).json({ error: error.message });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[analytics/event]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

router.post('/log-analytics', async (req, res) => {
    try {
        const { transaction_id, value } = req.body;

        if (!transaction_id || !value) {
            return res.status(400).json({ message: 'Необходимы transaction_id и value' });
        }

        const analytics = new Analytics({ transaction_id, value });
        await analytics.save();

        res.status(201).json({ message: 'Событие успешно залогировано' });
    } catch (error) {
        console.error('Ошибка при логировании события:', error);
        res.status(500).json({ message: 'Ошибка сервера', error: error.message });
    }
});

router.get('/analytics/:transaction_id', async (req, res) => {
    try {
        const { transaction_id } = req.params;
        const event = await Analytics.findByTransactionId(transaction_id);
        
        if (!event) {
            return res.status(404).json({ message: 'Событие не найдено' });
        }

        res.json(event);
    } catch (error) {
        console.error('Ошибка при получении события:', error);
        res.status(500).json({ message: 'Ошибка сервера', error: error.message });
    }
});





module.exports = router;