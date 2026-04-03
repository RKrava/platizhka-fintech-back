const express = require('express');
const AbandonedCheckout = require('../models/AbandonedCheckout');
const Shop = require('../models/Shop');
const router = express.Router();
router.use(express.json());

// Трекінг чекауту — фронт викликає при зміні phone/email
router.post('/track', async (req, res) => {
    try {
        const {
            storeId, cartToken, sessionId,
            firstName, lastName, phone, email,
            city, warehouse, novaPoshtaType,
            paymentMethod, marketingConsent
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
            marketingConsent: marketingConsent || false
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

        // Отримуємо дані магазину для відновлення сесії
        let shopData = null;
        try {
            shopData = await Shop.findById(checkout.store_id);
        } catch (e) {
            console.error('Error fetching shop for recovery:', e);
        }

        res.json({
            cartToken: checkout.cart_token,
            storeId: checkout.store_id,
            storeName: shopData?.domain_url || shopData?.name || '',
            shopifyDomain: shopData?.shopify_url || '',
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

module.exports = router;
