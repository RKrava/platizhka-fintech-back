/**
 * Upsell routes
 *
 *   GET /upsell/products?shopId=X  — fetch active products from Shopify Admin API
 *   PUT /upsell/config             — save upsell config to shops.settings.upsell
 */

const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const supabaseAuth = require('../middleware/supabaseAuth');

router.use(express.json());

/**
 * GET /upsell/products?shopId=X
 * Returns up to 50 active Shopify products for the given shop.
 * Protected: only the shop owner can call this.
 */
router.get('/products', supabaseAuth, async (req, res) => {
  try {
    const { shopId } = req.query;
    if (!shopId) return res.status(400).json({ error: 'shopId required' });

    const { data: shop, error: shopErr } = await supabase
      .from('shops')
      .select('id, user_id, shopify_url, admin_api_token')
      .eq('id', shopId)
      .maybeSingle();

    if (shopErr || !shop) return res.status(404).json({ error: 'Shop not found' });
    if (shop.user_id !== req.supabaseUser.id) return res.status(403).json({ error: 'Access denied' });

    if (!shop.shopify_url || !shop.admin_api_token) {
      return res.json({ products: [] });
    }

    const domain = shop.shopify_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const resp = await fetch(
      `https://${domain}/admin/api/2024-10/products.json?limit=50&status=active&fields=id,title,variants,images`,
      { headers: { 'X-Shopify-Access-Token': shop.admin_api_token } },
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`[upsell/products] Shopify error ${resp.status}: ${text.slice(0, 200)}`);
      return res.json({ products: [], shopifyError: resp.status });
    }

    const data = await resp.json();
    const products = (data.products || []).map((p) => ({
      id: String(p.id),
      title: p.title,
      image: p.images?.[0]?.src || null,
      price: Number(p.variants?.[0]?.price || 0),
      variantId: String(p.variants?.[0]?.id || ''),
    }));

    return res.json({ products });
  } catch (e) {
    console.error('[upsell/products]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * PUT /upsell/config
 * Body: { shopId, upsell: { enabled, strategy, topProduct, randomProducts } }
 * Saves upsell config into shops.settings.upsell without touching other settings.
 */
router.put('/config', supabaseAuth, async (req, res) => {
  try {
    const { shopId, upsell } = req.body;
    if (!shopId) return res.status(400).json({ error: 'shopId required' });

    const { data: shop, error: shopErr } = await supabase
      .from('shops')
      .select('id, user_id, settings')
      .eq('id', shopId)
      .maybeSingle();

    if (shopErr || !shop) return res.status(404).json({ error: 'Shop not found' });
    if (shop.user_id !== req.supabaseUser.id) return res.status(403).json({ error: 'Access denied' });

    const existing = shop.settings ?? {};
    const { error: updErr } = await supabase
      .from('shops')
      .update({ settings: { ...existing, upsell } })
      .eq('id', shopId);

    if (updErr) throw new Error(updErr.message);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[upsell/config PUT]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
