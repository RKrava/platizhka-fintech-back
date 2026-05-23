const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const supabaseAdmin = require('../config/supabase');

const DEFAULT_SHOPIFY_SCOPES = [
  'read_customers',
  'write_customers',
  'read_discounts',
  'write_discounts',
  'write_draft_orders',
  'read_draft_orders',
  'read_fulfillments',
  'write_fulfillments',
  'read_gift_cards',
  'write_gift_cards',
  'write_inventory',
  'read_inventory',
  'read_markets',
  'write_markets',
  'write_order_edits',
  'read_order_edits',
  'read_orders',
  'write_orders',
  'read_products',
  'write_products',
  'read_themes',
  'write_themes',
  'unauthenticated_write_bulk_operations',
  'unauthenticated_read_bulk_operations',
  'unauthenticated_read_bundles',
  'unauthenticated_write_checkouts',
  'unauthenticated_read_checkouts',
  'unauthenticated_write_customers',
  'unauthenticated_read_customers',
  'unauthenticated_read_customer_tags',
  'unauthenticated_read_metaobjects',
  'unauthenticated_read_product_pickup_locations',
  'unauthenticated_read_product_inventory',
  'unauthenticated_read_product_listings',
  'unauthenticated_read_product_tags',
  'unauthenticated_read_selling_plans',
  'unauthenticated_read_shop_pay_installments_pricing',
  'unauthenticated_read_content',
].join(',');

const router = express.Router();
router.use(express.json());

function parseSettings(settings) {
  if (!settings) return {};
  if (typeof settings === 'object') return settings;
  try {
    return JSON.parse(settings);
  } catch {
    return {};
  }
}

function verifyShopifyHmac(query, receivedHmac, apiSecret) {
  if (!apiSecret || !receivedHmac) {
    return false;
  }

  const message = Object.entries(query)
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const computed = crypto
    .createHmac('sha256', apiSecret)
    .update(message, 'utf8')
    .digest('hex');

  const computedBuffer = Buffer.from(computed, 'hex');
  const receivedBuffer = Buffer.from(receivedHmac, 'hex');

  return (
    computedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(computedBuffer, receivedBuffer)
  );
}

function getPublicBaseUrl(req) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol;
  const host = forwardedHost || req.get('host');

  return (
    process.env.SHOPIFY_APP_PUBLIC_URL ||
    process.env.API_PUBLIC_URL ||
    `${proto}://${host}`
  ).replace(/\/$/, '');
}

function getFrontendBaseUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function getWidgetUrl() {
  return process.env.SHOPIFY_WIDGET_URL || `${getFrontendBaseUrl()}/widget.js`;
}

function summarizeAxiosError(error) {
  if (!error?.isAxiosError) {
    return { message: error?.message || 'Unknown error' };
  }

  const body = typeof error.response?.data === 'string'
    ? error.response.data.replace(/\s+/g, ' ').slice(0, 500)
    : error.response?.data;

  return {
    message: error.message,
    status: error.response?.status,
    statusText: error.response?.statusText,
    body,
  };
}

async function getShopCredentials(shopDomain) {
  // Normalize: strip protocol, trailing slash, lowercase — Shopify passes bare domain.
  const normalized = String(shopDomain || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');

  const { data: shop, error } = await supabaseAdmin
    .from('shops')
    .select('*')
    .or(`shopify_url.eq.${normalized},shopify_url.eq.https://${normalized}`)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const settings = parseSettings(shop?.settings);
  const shopify = settings.shopify || {};

  return {
    shop,
    settings,
    clientId: shopify.client_id,
    clientSecret: shopify.client_secret,
  };
}

async function updateShopOAuth(shopId, updates) {
  const { error } = await supabaseAdmin
    .from('shops')
    .update(updates)
    .eq('id', shopId);

  if (error) {
    throw error;
  }
}

async function getShopByDomain(shopDomain) {
  const { data: shop, error } = await supabaseAdmin
    .from('shops')
    .select('*')
    .eq('shopify_url', shopDomain)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return shop;
}

/**
 * GET /shopify-oauth/authorize
 * Redirects to Shopify OAuth authorization URL
 */
router.get('/authorize', async (req, res) => {
  try {
    const { shop, host, hmac } = req.query;

    if (!shop || !host) {
      return res.status(400).json({ error: 'Missing shop or host parameter' });
    }

    const {
      shop: existingShop,
      settings,
      clientId,
      clientSecret,
    } = await getShopCredentials(shop);

    if (!existingShop) {
      return res.status(400).json({
        error: `Shop not found: no Platizhka account is linked to domain "${shop}". Check that the Shopify URL was saved correctly in the dashboard.`,
      });
    }
    if (!clientId || !clientSecret) {
      return res.status(400).json({
        error: 'Shopify app credentials not configured for this shop (client_id or client_secret missing in shop settings)',
      });
    }

    if (hmac && !verifyShopifyHmac(req.query, hmac, clientSecret)) {
      return res.status(401).json({ error: 'Invalid HMAC' });
    }

    const scopes = process.env.SHOPIFY_SCOPES || DEFAULT_SHOPIFY_SCOPES;
    
    // Generate a state parameter for CSRF protection
    const state = crypto.randomBytes(16).toString('hex');

    await updateShopOAuth(existingShop.id, {
      settings: {
        ...settings,
        shopify: {
          ...(settings.shopify || {}),
          oauth_state: state,
          oauth_started_at: new Date().toISOString(),
        },
      },
    });
    
    const redirectUri = `${getPublicBaseUrl(req)}/shopify-oauth/callback-handler`;

    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    res.redirect(authUrl);
  } catch (error) {
    console.error('Shopify authorize error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /shopify-oauth/callback-handler
 * Handles OAuth callback from Shopify (called AFTER user approves the app)
 * Query params: code, hmac, host, shop, state, timestamp
 */
router.get('/callback-handler', async (req, res) => {
  try {
    const { code, hmac, host, shop, state, timestamp } = req.query;

    if (!code || !shop) {
      return res.status(400).json({ error: 'Missing code or shop' });
    }

    const {
      shop: existingShop,
      settings,
      clientId,
      clientSecret,
    } = await getShopCredentials(shop);

    if (!existingShop) {
      return res.status(400).json({
        error: `Shop not found: no Platizhka account is linked to domain "${shop}". Check that the Shopify URL was saved correctly in the dashboard.`,
      });
    }
    if (!clientId || !clientSecret) {
      return res.status(400).json({
        error: 'Shopify app credentials not configured for this shop (client_id or client_secret missing in shop settings)',
      });
    }

    if (!verifyShopifyHmac(req.query, hmac, clientSecret)) {
      return res.status(401).json({ error: 'Invalid HMAC' });
    }

    if (settings.shopify?.oauth_state && settings.shopify.oauth_state !== state) {
      return res.status(401).json({ error: 'Invalid OAuth state' });
    }

    const tokenResponse = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }
    );

    const accessToken = tokenResponse.data.access_token;

    if (!accessToken) {
      return res.status(400).json({ error: 'Failed to obtain access token' });
    }

    const shopifySettingsWithToken = {
      ...(settings.shopify || {}),
      access_token: accessToken,
      granted_scopes: tokenResponse.data.scope || null,
      installed_at: new Date().toISOString(),
      oauth_state: null,
    };

    await updateShopOAuth(existingShop.id, {
      admin_api_token: accessToken,
      settings: {
        ...settings,
        shopify: shopifySettingsWithToken,
      },
    });

    // Install script to theme
    try {
      await installPaymentScript(shop, accessToken);
      await updateShopOAuth(existingShop.id, {
        settings: {
          ...settings,
          shopify: {
            ...shopifySettingsWithToken,
            script_installed_at: new Date().toISOString(),
            script_install_error: null,
          },
        },
      });
    } catch (scriptErr) {
      console.warn('Failed to install payment script:', scriptErr.message);
      await updateShopOAuth(existingShop.id, {
        settings: {
          ...settings,
          shopify: {
            ...shopifySettingsWithToken,
            script_install_error: scriptErr.message,
          },
        },
      });
    }

    res.redirect(
      `${getFrontendBaseUrl()}/user?shopify=connected&shop=${encodeURIComponent(shop)}`
    );
  } catch (error) {
    const summary = summarizeAxiosError(error);
    console.error('Shopify OAuth callback error:', summary);
    res.status(500).json({
      error: 'Shopify OAuth callback failed',
      details: summary,
    });
  }
});

router.post('/install-script', async (req, res) => {
  try {
    const shop = req.body?.shop || req.query.shop;

    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    const existingShop = await getShopByDomain(shop);
    if (!existingShop?.admin_api_token) {
      return res.status(400).json({ error: 'Shopify access token not found for this shop' });
    }

    const settings = parseSettings(existingShop.settings);

    await installPaymentScript(shop, existingShop.admin_api_token);
    await updateShopOAuth(existingShop.id, {
      settings: {
        ...settings,
        shopify: {
          ...(settings.shopify || {}),
          script_installed_at: new Date().toISOString(),
          script_install_error: null,
        },
      },
    });

    res.json({ ok: true, shop });
  } catch (error) {
    const summary = summarizeAxiosError(error);
    console.error('Shopify install script error:', summary);
    res.status(500).json({
      error: 'Failed to install Shopify script',
      details: summary,
    });
  }
});

/**
 * Helper function to install payment script to Shopify theme
 */
async function installPaymentScript(shop, accessToken) {
  // Get the current theme
  const themesResponse = await axios.get(`https://${shop}/admin/api/2024-01/themes.json`, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
    },
  });

  const themes = themesResponse.data.themes;
  const mainTheme = themes.find((t) => t.role === 'main');

  if (!mainTheme) {
    throw new Error('No main theme found');
  }

  // Create script content
  const scriptContent = `
<!-- Platizhka Payment Integration (Auto-installed) -->
<script src="${getWidgetUrl()}"></script>
<script>
  window.addEventListener('load', function() {
    if (window.Platizhka) {
      window.Platizhka.init({
        shop: '${shop}'
      });
    }
  });
</script>
<!-- End Platizhka Integration -->
`;

  // Get current theme file
  const assetResponse = await axios.get(
    `https://${shop}/admin/api/2024-01/themes/${mainTheme.id}/assets.json?asset[key]=layout/theme.liquid`,
    {
      headers: {
        'X-Shopify-Access-Token': accessToken,
      },
    }
  );

  const currentContent = assetResponse.data.asset?.value || '';

  const existingBlockRe = /\n?<!-- Platizhka Payment Integration \(Auto-installed\) -->[\s\S]*?<!-- End Platizhka Integration -->/;
  const updatedContent = existingBlockRe.test(currentContent)
    ? currentContent.replace(existingBlockRe, '\n' + scriptContent)
    : currentContent + '\n' + scriptContent;

  // Update theme file
  await axios.put(
    `https://${shop}/admin/api/2024-01/themes/${mainTheme.id}/assets.json`,
    {
      asset: {
        key: 'layout/theme.liquid',
        value: updatedContent,
      },
    },
    {
      headers: {
        'X-Shopify-Access-Token': accessToken,
      },
    }
  );
}

/**
 * POST /shopify-oauth/install
 * Legacy endpoint - kept for backwards compatibility
 */
router.post('/install', async (req, res) => {
  try {
    const { shop, host } = req.body;

    if (!shop || !host) {
      return res.status(400).json({ error: 'Missing shop or host parameter' });
    }

    const { shop: existingShop, clientId } = await getShopCredentials(shop);
    if (!existingShop) {
      return res.status(400).json({
        error: `Shop not found: domain "${shop}" is not linked to any Platizhka account.`,
      });
    }
    if (!clientId) {
      return res.status(400).json({
        error: 'Shopify app credentials not configured for this shop (client_id missing)',
      });
    }

    const scopes = process.env.SHOPIFY_SCOPES || DEFAULT_SHOPIFY_SCOPES;
    const redirectUri = `${getPublicBaseUrl(req)}/shopify-oauth/callback-handler`;

    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    res.json({
      authUrl,
      shop,
      host,
    });
  } catch (error) {
    console.error('Shopify install error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /shopify-oauth/update-mode
 * Updates the checkout mode (data-mode attribute) in the shop's active Shopify theme.
 * Body: { shopId, mode: 'replace' | 'ukraine_only' }
 */
const supabaseAuth = require('../middleware/supabaseAuth');
const { updateCheckoutMode } = require('../shopify/shopify');

router.post('/update-mode', supabaseAuth, async (req, res) => {
  try {
    const { shopId, mode } = req.body;
    if (!shopId || !['replace', 'ukraine_only'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid shopId or mode' });
    }

    // Fetch shop, verify ownership
    const { data: shop, error: shopErr } = await supabaseAdmin
      .from('shops')
      .select('id, shopify_url, admin_api_token, settings')
      .eq('id', shopId)
      .eq('user_id', req.supabaseUser.id)
      .maybeSingle();

    if (shopErr || !shop) {
      return res.status(404).json({ error: 'Shop not found or access denied' });
    }
    if (!shop.admin_api_token || !shop.shopify_url) {
      return res.status(400).json({ error: 'Shop not connected to Shopify' });
    }

    const hostName = shop.shopify_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    await updateCheckoutMode({ hostName, adminApiAccessToken: shop.admin_api_token }, mode);

    res.json({ ok: true });
  } catch (error) {
    const summary = error?.response?.data ?? error.message;
    console.error('[update-mode]', summary);
    res.status(500).json({ error: 'Failed to update checkout mode', details: String(summary).slice(0, 500) });
  }
});

module.exports = router;
