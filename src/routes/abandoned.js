const express = require('express');
const AbandonedCheckout = require('../models/AbandonedCheckout');
const Shop = require('../models/Shop');
const { getStoreFrontClient } = require('../config/shopifyConfig');
const router = express.Router();
router.use(express.json());

// Трекінг чекауту — фронт викликає при зміні phone/email
router.post('/track', async (req, res) => {
    try {
        const {
            storeId, cartToken, sessionId,
            firstName, lastName, phone, email,
            city, warehouse, novaPoshtaType,
            paymentMethod, marketingConsent, cartData
        } = req.body;

        if (!sessionId || !storeId) {
            return res.status(400).json({ error: 'sessionId and storeId are required' });
        }

        const checkout = new AbandonedCheckout({
            storeId: Number(storeId),
            cartToken,
            sessionId,
            firstName,
            lastName,
            phone,
            email,
            city,
            warehouse,
            novaPoshtaType,
            paymentMethod,
            marketingConsent: marketingConsent || false,
            cartData: cartData || null
        });

        const result = await checkout.upsert();
        res.json({ success: true, recoveryToken: result.recovery_token });
    } catch (error) {
        console.error('Error tracking checkout:', error);
        res.status(500).json({ error: 'Failed to track checkout' });
    }
});

// Відновлення чекауту за recovery token
router.get('/recover/:token', async (req, res) => {
    try {
        const checkout = await AbandonedCheckout.findByRecoveryToken(req.params.token);
        if (!checkout) {
            return res.status(404).json({ error: 'Checkout not found' });
        }

        // Отримуємо дані магазину
        let shop = null;
        try {
            shop = await Shop.findById(checkout.store_id);
        } catch (e) {
            console.error('Error fetching shop for recovery:', e);
        }

        const rawDomain = shop?.domain_url || shop?.name || '';
        const cleanStoreName = rawDomain.replace(/^https?:\/\//, '');

        // Спробуємо створити новий кошик Shopify з збережених товарів
        let newCartToken = checkout.cart_token; // fallback на старий токен
        if (checkout.cart_data && shop) {
            try {
                const cartItems = JSON.parse(checkout.cart_data);
                // cartItems — масив { variantId, quantity, attributes }
                if (cartItems.length > 0) {
                    const shopData = {
                        apiSecretKey: shop.storefront_api_token,
                        hostName: shop.shopify_url,
                        adminApiAccessToken: shop.admin_api_token
                    };
                    const storefrontClient = await getStoreFrontClient(checkout.store_id, shopData);

                    const lines = cartItems.map(item => ({
                        merchandiseId: item.variantId,
                        quantity: item.quantity,
                        ...(item.attributes && item.attributes.length > 0
                            ? { attributes: item.attributes }
                            : {})
                    }));

                    const result = await storefrontClient.request(
                        `mutation cartCreate($input: CartInput!) {
                            cartCreate(input: $input) {
                                cart { id }
                                userErrors { field message }
                            }
                        }`,
                        { variables: { input: { lines } } }
                    );

                    const newCartId = result?.data?.cartCreate?.cart?.id;
                    if (newCartId) {
                        // cartId формат: gid://shopify/Cart/TOKEN — витягуємо токен
                        newCartToken = newCartId.replace('gid://shopify/Cart/', '');
                        console.log('Created new cart for recovery:', newCartToken);
                    }
                }
            } catch (e) {
                console.error('Error creating recovery cart:', e);
                // Продовжуємо зі старим токеном
            }
        }

        res.json({
            cartToken: newCartToken,
            storeId: checkout.store_id,
            storeName: cleanStoreName,
            shopifyDomain: shop?.shopify_url || '',
            firstName: checkout.first_name,
            lastName: checkout.last_name,
            phone: checkout.phone,
            email: checkout.email,
            city: checkout.city,
            warehouse: checkout.warehouse,
            novaPoshtaType: checkout.nova_poshta_type,
            paymentMethod: checkout.payment_method,
            marketingConsent: checkout.marketing_consent
        });
    } catch (error) {
        console.error('Error recovering checkout:', error);
        res.status(500).json({ error: 'Failed to recover checkout' });
    }
});

// Список покинутих кошиків для магазину
router.get('/list', async (req, res) => {
    try {
        const { storeId } = req.query;
        if (!storeId) {
            return res.status(400).json({ error: 'storeId is required' });
        }

        const checkouts = await AbandonedCheckout.findAbandoned(Number(storeId));
        res.json({ checkouts });
    } catch (error) {
        console.error('Error listing abandoned checkouts:', error);
        res.status(500).json({ error: 'Failed to list abandoned checkouts' });
    }
});

// Notification step counts для дашборду
router.get('/notifications', async (req, res) => {
    try {
        const { checkoutIds } = req.query;
        if (!checkoutIds) {
            return res.json({ counts: {} });
        }
        const ids = checkoutIds.split(',').map(Number).filter(n => !isNaN(n));
        const NotificationLog = require('../models/NotificationLog');
        const counts = await NotificationLog.getStepCounts(ids);
        res.json({ counts });
    } catch (error) {
        console.error('Error fetching notification counts:', error);
        res.status(500).json({ error: 'Failed to fetch notification counts' });
    }
});

module.exports = router;
