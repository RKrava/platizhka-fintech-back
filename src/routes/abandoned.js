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
        console.error('Error tracking checkout:', error.message, error.stack);
        res.status(500).json({ error: 'Failed to track checkout', details: error.message });
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

// Тестова SMS/Viber
router.post('/test-sms', async (req, res) => {
    try {
        const { phone, message, storeId } = req.body;
        if (!phone || !storeId) {
            return res.status(400).json({ error: 'phone and storeId required' });
        }

        const shop = await Shop.findById(storeId);
        if (!shop) return res.status(404).json({ error: 'Shop not found' });

        const token = shop.turbosms_token;
        const sender = shop.turbosms_sender;
        if (!token || !sender) {
            return res.status(400).json({ error: 'TurboSMS not configured for this shop. Set token and sender in Settings.' });
        }

        const { sendViberWithSmsFallback, sendSms } = require('../services/turbosms');
        const text = message || 'Тестове повідомлення від abandoned cart системи';
        const mode = req.body.mode || 'sms'; // 'sms', 'viber', 'hybrid'

        let result;
        if (mode === 'hybrid') {
            result = await sendViberWithSmsFallback(phone, text, text, sender, token);
        } else {
            result = await sendSms(phone, text, sender, token);
        }

        res.json({ success: result.success, messageId: result.messageId, error: result.error });
    } catch (error) {
        console.error('Test SMS error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Тестовий email
router.post('/test-email', async (req, res) => {
    try {
        const { email, storeId } = req.body;
        if (!email || !storeId) {
            return res.status(400).json({ error: 'email and storeId required' });
        }

        const shop = await Shop.findById(storeId);
        if (!shop) return res.status(404).json({ error: 'Shop not found' });

        const smtpConfig = (shop.smtp_host && shop.smtp_user) ? {
            host: shop.smtp_host, port: shop.smtp_port || 587,
            user: shop.smtp_user, pass: shop.smtp_pass, from: shop.smtp_from
        } : null;

        if (!smtpConfig) {
            return res.status(400).json({ error: 'SMTP not configured for this shop. Set SMTP settings in Settings.' });
        }

        const { sendAbandonedCartEmail } = require('../services/emailService');
        const result = await sendAbandonedCartEmail({
            email,
            firstName: 'Тест',
            cartItems: [{ title: 'Тестовий товар', quantity: 1, price: '999', image: '' }],
            recoveryLink: 'https://bricktopia.store',
            storeName: (shop.domain_url || shop.name || '').replace(/^https?:\/\//, ''),
            smtpConfig
        });

        res.json({ success: result.success, messageId: result.messageId, error: result.error });
    } catch (error) {
        console.error('Test email error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ручна відправка SMS або Email по конкретному checkout
router.post('/send-manual', async (req, res) => {
    try {
        const { checkoutId, channel } = req.body; // channel: 'sms' або 'email'
        if (!checkoutId || !channel) {
            return res.status(400).json({ error: 'checkoutId and channel required' });
        }

        const db = require('../config/db');
        const result = await db.query('SELECT * FROM abandoned_checkouts WHERE id = $1', [checkoutId]);
        const checkout = result.rows[0];
        if (!checkout) return res.status(404).json({ error: 'Checkout not found' });

        const shop = await Shop.findById(checkout.store_id);
        if (!shop) return res.status(404).json({ error: 'Shop not found' });

        const storeName = (shop.domain_url || shop.name || '').replace(/^https?:\/\//, '');
        const fullUrl = `https://platizhka.vercel.app/${storeName}/checkout?recover=${checkout.recovery_token}`;

        // Спробувати скоротити посилання
        let recoveryLink = fullUrl;
        let shortLinkDebug = { configured: false };
        const SHORT_LINK_API = process.env.SHORT_LINK_API;
        const SHORT_LINK_TOKEN = process.env.SHORT_LINK_TOKEN;
        if (SHORT_LINK_API && SHORT_LINK_TOKEN) {
            shortLinkDebug = { configured: true, api: SHORT_LINK_API };
            try {
                const axios = require('axios');
                const resp = await axios.post(SHORT_LINK_API, {
                    url: fullUrl, storeId: checkout.store_id, checkoutId: checkout.id, step: 0
                }, { headers: { 'Authorization': `Bearer ${SHORT_LINK_TOKEN}` } });
                if (resp.data.success && resp.data.shortUrl) {
                    recoveryLink = resp.data.shortUrl;
                    shortLinkDebug.result = 'ok';
                    shortLinkDebug.shortUrl = resp.data.shortUrl;
                } else {
                    shortLinkDebug.result = 'api_error';
                    shortLinkDebug.response = resp.data;
                }
            } catch (e) {
                shortLinkDebug.result = 'exception';
                shortLinkDebug.error = e.message;
                console.error('Short link error:', e.message);
            }
        }

        if (channel === 'sms') {
            if (!checkout.phone) return res.status(400).json({ error: 'No phone number' });
            if (!shop.turbosms_token || !shop.turbosms_sender) return res.status(400).json({ error: 'TurboSMS not configured' });

            const { sendSms } = require('../services/turbosms');
            const text = `${checkout.first_name ? checkout.first_name + ', в' : 'В'}и не завершили замовлення. Повернутися: ${recoveryLink}`;
            const sendResult = await sendSms(checkout.phone, text, shop.turbosms_sender, shop.turbosms_token);

            const NotificationLog = require('../models/NotificationLog');
            await NotificationLog.save({ abandonedCheckoutId: checkout.id, storeId: checkout.store_id, step: 0, channel: 'manual_sms', recipient: checkout.phone, messageId: sendResult.messageId });

            return res.json({ success: sendResult.success, messageId: sendResult.messageId, error: sendResult.error, link: recoveryLink, shortLinkDebug });
        }

        if (channel === 'email') {
            if (!checkout.email) return res.status(400).json({ error: 'No email' });

            const smtpConfig = (shop.smtp_host && shop.smtp_user) ? {
                host: shop.smtp_host, port: shop.smtp_port || 587,
                user: shop.smtp_user, pass: shop.smtp_pass, from: shop.smtp_from
            } : null;
            if (!smtpConfig) return res.status(400).json({ error: 'SMTP not configured' });

            let cartItems = [];
            try { cartItems = JSON.parse(checkout.cart_data || '[]'); } catch {}

            const { sendAbandonedCartEmail } = require('../services/emailService');
            const sendResult = await sendAbandonedCartEmail({
                email: checkout.email, firstName: checkout.first_name, cartItems,
                recoveryLink, storeName, smtpConfig
            });

            const NotificationLog = require('../models/NotificationLog');
            await NotificationLog.save({ abandonedCheckoutId: checkout.id, storeId: checkout.store_id, step: 0, channel: 'manual_email', recipient: checkout.email, messageId: sendResult.messageId });

            return res.json({ success: sendResult.success, messageId: sendResult.messageId, error: sendResult.error, link: recoveryLink, shortLinkDebug });
        }

        res.status(400).json({ error: 'Invalid channel. Use sms or email.' });
    } catch (error) {
        console.error('Manual send error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Превʼю email для abandoned checkout
router.get('/email-preview/:id', async (req, res) => {
    try {
        const db = require('../config/db');
        const result = await db.query('SELECT * FROM abandoned_checkouts WHERE id = $1', [req.params.id]);
        const checkout = result.rows[0];
        if (!checkout) return res.status(404).send('Not found');

        let shop = null;
        try { shop = await Shop.findById(checkout.store_id); } catch {}
        const storeName = (shop?.domain_url || shop?.name || '').replace(/^https?:\/\//, '');
        const link = `https://platizhka.vercel.app/${storeName}/checkout?recover=${checkout.recovery_token}`;

        let cartItems = [];
        try { cartItems = JSON.parse(checkout.cart_data || '[]'); } catch {}

        const { getEmailPreviewHtml } = require('../services/emailService');
        const html = getEmailPreviewHtml({
            firstName: checkout.first_name,
            cartItems,
            recoveryLink: link,
            storeName
        });

        res.type('html').send(html);
    } catch (error) {
        console.error('Email preview error:', error);
        res.status(500).send('Error generating preview');
    }
});

// Діагностика конфігурації
router.get('/debug-config', async (req, res) => {
    res.json({
        SHORT_LINK_API: process.env.SHORT_LINK_API ? 'SET (' + process.env.SHORT_LINK_API + ')' : 'NOT SET',
        SHORT_LINK_TOKEN: process.env.SHORT_LINK_TOKEN ? 'SET (hidden)' : 'NOT SET',
        POSTGRES_URL: process.env.POSTGRES_URL ? 'SET' : 'NOT SET',
    });
});

module.exports = router;
