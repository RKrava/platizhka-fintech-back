/**
 * Creates an order in Shopify via the Admin REST API.
 *
 * Uses "custom" line items (no variant IDs required) so it works regardless
 * of whether the customer came through the Shopify storefront.
 *
 * @param {object} order  - Row from the `orders` Supabase table
 * @param {object} shop   - Must contain `shopify_url` and `admin_api_token`
 * @returns {object}      - The created Shopify order object
 */
async function createShopifyOrder(order, shop) {
  const { admin_api_token, shopify_url } = shop;
  if (!admin_api_token || !shopify_url) {
    throw new Error('Shop is missing admin_api_token or shopify_url — cannot create Shopify order');
  }

  const customer   = (order.customer  ?? {});
  const delivery   = (order.delivery  ?? {});
  const items      = Array.isArray(order.items) ? order.items : [];
  const isCOD      = order.payment?.provider === 'cash_on_delivery';

  // ─── Line items ─────────────────────────────────────────────────────────────
  const lineItems = items.map((item) => ({
    title:    item.name || 'Товар',
    price:    Number(item.price || 0).toFixed(2),
    quantity: Number(item.qty)  || 1,
    requires_shipping: true,
    taxable:  false,
  }));

  if (lineItems.length === 0) {
    // Fallback so Shopify doesn't reject the request
    lineItems.push({
      title:    'Замовлення',
      price:    Number(order.amount_total || 0).toFixed(2),
      quantity: 1,
      requires_shipping: true,
      taxable:  false,
    });
  }

  // ─── Shipping address ────────────────────────────────────────────────────────
  const shippingAddress = buildShippingAddress(customer, delivery, order.recipient);

  // ─── Note ───────────────────────────────────────────────────────────────────
  const noteParts = [];
  if (order.comment)          noteParts.push(`Коментар: ${order.comment}`);
  if (delivery.carrier)       noteParts.push(`Доставка: ${formatDelivery(delivery)}`);
  if (order.needs_callback)   noteParts.push('⚠️ Потрібен дзвінок від менеджера');
  if (order.is_gift && order.recipient) {
    const r = order.recipient;
    noteParts.push(`🎁 Подарунок для: ${[r.firstName, r.lastName].filter(Boolean).join(' ')}${r.phone ? ` (${r.phone})` : ''}`);
  }

  // ─── Discount ───────────────────────────────────────────────────────────────
  const discountCodes = [];
  if (order.promo_code && order.promo_discount) {
    discountCodes.push({
      code:   order.promo_code,
      amount: Number(order.promo_discount).toFixed(2),
      type:   'fixed_amount',
    });
  }

  // ─── Shipping line ───────────────────────────────────────────────────────────
  const shippingLines = [];
  if (order.amount_shipping && Number(order.amount_shipping) > 0) {
    shippingLines.push({
      title: formatDelivery(delivery) || 'Доставка',
      price: Number(order.amount_shipping).toFixed(2),
      code:  delivery.carrier || 'shipping',
    });
  }

  // ─── Customer: find existing by phone/email, or create new ──────────────────
  const domain = shopify_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const customerPayload = await findOrBuildCustomer(domain, admin_api_token, customer);

  // ─── Payload ─────────────────────────────────────────────────────────────────
  const payload = {
    order: {
      financial_status:           isCOD ? 'pending' : 'paid',
      send_receipt:                false,
      send_fulfillment_receipt:    false,
      currency:                   order.currency || 'UAH',
      line_items:                 lineItems,
      customer:                   customerPayload,
      shipping_address:           shippingAddress,
      ...(noteParts.length  ? { note:           noteParts.join('\n')  } : {}),
      ...(discountCodes.length ? { discount_codes: discountCodes } : {}),
      ...(shippingLines.length ? { shipping_lines: shippingLines } : {}),
      // Tag so it's easy to filter in Shopify admin
      tags: ['platizhka', isCOD ? 'cod' : 'paid-online'].join(', '),
    },
  };

  const url    = `https://${domain}/admin/api/2024-10/orders.json`;

  const resp = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':            'application/json',
      'X-Shopify-Access-Token':  admin_api_token,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Shopify order create failed ${resp.status}: ${text.slice(0, 300)}`);
  }

  const json = await resp.json();
  return json.order;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Search Shopify for an existing customer by phone then email.
 * Returns { id } if found (Shopify links the order to them without re-creating),
 * or a full new-customer object if not found.
 * This avoids the "phone has already been taken" 422 error.
 */
async function findOrBuildCustomer(domain, token, customer) {
  const headers = { 'X-Shopify-Access-Token': token };
  const base    = `https://${domain}/admin/api/2024-10/customers/search.json`;

  const trySearch = async (query) => {
    try {
      const r = await fetch(`${base}?query=${encodeURIComponent(query)}&limit=1&fields=id`, { headers });
      if (!r.ok) return null;
      const json = await r.json();
      return json.customers?.[0]?.id ?? null;
    } catch {
      return null;
    }
  };

  // Search by phone first, then email.
  const phone = customer.phone?.trim();
  const email = customer.email?.trim();

  let existingId = phone ? await trySearch(`phone:${phone}`) : null;
  if (!existingId && email) existingId = await trySearch(`email:${email}`);

  if (existingId) return { id: existingId };

  // Brand-new customer.
  return {
    first_name: customer.firstName || '',
    last_name:  customer.lastName  || '',
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
  };
}

function buildShippingAddress(customer, delivery, recipient) {
  const person    = recipient || customer;
  const firstName = person.firstName || customer.firstName || '';
  const lastName  = person.lastName  || customer.lastName  || '';
  const phone     = person.phone     || customer.phone     || undefined;

  let address1 = '';
  let city     = '';
  let country  = 'Ukraine';

  const carrier = delivery.carrier;

  if (carrier === 'nova-poshta') {
    address1 = delivery.warehouse || 'Нова Пошта';
    city     = delivery.deliveryCityName || '';
  } else if (carrier === 'np_courier') {
    const npc = delivery.npCourier || {};
    address1  = [npc.street, npc.building, npc.apartment].filter(Boolean).join(', ') || 'Кур\'єр НП';
    city      = npc.city || delivery.deliveryCityName || '';
  } else if (carrier === 'ukrposhta') {
    address1 = delivery.warehouse || 'Укрпошта';
    city     = '';
  } else if (carrier === 'meest') {
    address1 = delivery.warehouse || 'Meest';
    city     = '';
  } else if (carrier === 'rozetka') {
    address1 = delivery.warehouse || 'Rozetka Delivery';
    city     = '';
  } else if (carrier === 'pickup') {
    address1 = (delivery.pickup || {}).address || 'Самовивіз';
    city     = '';
  } else if (carrier === 'international') {
    const intl = delivery.intl || {};
    address1   = intl.address1 || '';
    city       = intl.city     || '';
    country    = intl.country  || 'Ukraine';
  } else {
    address1 = delivery.warehouse || carrier || 'Україна';
  }

  return {
    first_name:   firstName,
    last_name:    lastName,
    address1:     address1 || 'Адреса не вказана',
    city:         city     || address1 || 'Україна',
    country,
    country_code: country === 'Ukraine' ? 'UA' : undefined,
    ...(phone ? { phone } : {}),
  };
}

function formatDelivery(delivery) {
  const names = {
    'nova-poshta':  'Нова Пошта',
    'np_courier':   'НП Кур\'єр',
    'ukrposhta':    'Укрпошта',
    'meest':        'Meest',
    'rozetka':      'Rozetka Delivery',
    'pickup':       'Самовивіз',
    'international':'Міжнародна доставка',
    'cash_on_delivery': 'Накладений платіж',
  };
  const name  = names[delivery.carrier] || delivery.carrier || '';
  const where = delivery.warehouse || '';
  return where ? `${name}: ${where}` : name;
}

/**
 * Clears a Shopify cart via the Storefront API.
 * cartToken — the plain token from /cart.js (e.g. "abc123…")
 * shop      — must contain shopify_url and storefront_api_token
 */
async function clearShopifyCart(shop, cartToken) {
  const { shopify_url, storefront_api_token } = shop;
  if (!shopify_url || !storefront_api_token || !cartToken) return;

  const domain   = shopify_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const endpoint = `https://${domain}/api/2024-10/graphql.json`;
  const cartId   = `gid://shopify/Cart/${cartToken}`;

  // 1) Fetch current line IDs
  const queryResp = await fetch(endpoint, {
    method:  'POST',
    headers: {
      'Content-Type':                    'application/json',
      'X-Shopify-Storefront-Access-Token': storefront_api_token,
    },
    body: JSON.stringify({
      query: `query GetCartLines($cartId: ID!) {
        cart(id: $cartId) { lines(first: 100) { edges { node { id } } } }
      }`,
      variables: { cartId },
    }),
  });

  if (!queryResp.ok) return;
  const queryJson = await queryResp.json();
  const edges = queryJson?.data?.cart?.lines?.edges ?? [];
  if (edges.length === 0) return; // already empty

  const lineIds = edges.map((e) => e.node.id);

  // 2) Remove all lines
  await fetch(endpoint, {
    method:  'POST',
    headers: {
      'Content-Type':                    'application/json',
      'X-Shopify-Storefront-Access-Token': storefront_api_token,
    },
    body: JSON.stringify({
      query: `mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
        cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
          userErrors { field message }
        }
      }`,
      variables: { cartId, lineIds },
    }),
  });
}

module.exports = { createShopifyOrder, clearShopifyCart };
