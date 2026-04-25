/**
 * Abandoned-cart tracking endpoint (separate from the legacy `/abandoned`
 * routes, which handle Shopify-coupled recovery emails).
 *
 *   POST /abandoned-track/upsert
 *
 * Called by the live checkout while the customer is filling fields. We
 * persist a single row per (shop_id, session_id) — every subsequent call
 * with the same session_id updates the row in place, so we always have
 * the most-recent snapshot of the cart and the contact info the customer
 * has typed so far.
 *
 * If the customer eventually completes the order, the order-creation
 * endpoint marks `recovered=true` and links `recovered_order_id`.
 */

const express = require('express');
const supabase = require('../config/supabase');

const router = express.Router();
router.use(express.json({ limit: '256kb' }));

/**
 * Body shape (everything is optional except shopId + sessionId):
 *   {
 *     shopId, sessionId,
 *     email?, phone?,
 *     cart?: { items, amount, currency },
 *     delivery?: { ... },
 *     isTest?: boolean
 *   }
 */
router.post('/upsert', async (req, res) => {
  try {
    const {
      shopId,
      sessionId,
      email = null,
      phone = null,
      cart = null,
      delivery = null,
      isTest = false,
    } = req.body;

    if (!shopId || !sessionId) {
      return res.status(400).json({ error: 'shopId and sessionId are required' });
    }

    const row = {
      shop_id: shopId,
      session_id: sessionId,
      email: email || null,
      phone: phone || null,
      cart_data: cart,
      delivery_data: delivery,
      is_test: !!isTest,
      // recovered defaults to false; webhook for paid order will flip it
    };

    const { data, error } = await supabase
      .from('abandoned_checkouts')
      .upsert(row, { onConflict: 'shop_id,session_id' })
      .select('id, recovered')
      .single();
    if (error) throw new Error(error.message);

    return res.json({ ok: true, id: data.id, recovered: data.recovered });
  } catch (e) {
    console.error('[abandoned-track/upsert] error', e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
