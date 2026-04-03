const AbandonedCheckout = require('../models/AbandonedCheckout');
const NotificationLog = require('../models/NotificationLog');
const Shop = require('../models/Shop');
const axios = require('axios');
const { sendViberWithSmsFallback } = require('./turbosms');
const { sendAbandonedCartEmail } = require('./emailService');

// Таймінги (в мілісекундах)
const STEP1_DELAY = 30 * 60 * 1000;        // 30 хв після покидання
const STEP2_DELAY = 24 * 60 * 60 * 1000;   // 24 год після step 1
const STEP3_DELAY = 48 * 60 * 60 * 1000;   // 48 год після step 2 (72 год від покидання)

// URL сервісу коротких посилань
const SHORT_LINK_API = process.env.SHORT_LINK_API; // напр. https://bk.link/api/create
const SHORT_LINK_TOKEN = process.env.SHORT_LINK_TOKEN;

function getRecoveryUrl(storeName, recoveryToken, promoCode, step) {
    const clean = (storeName || '').replace(/^https?:\/\//, '');
    let url = `https://platizhka.vercel.app/${clean}/checkout?recover=${recoveryToken}`;
    if (promoCode) url += `&promo=${encodeURIComponent(promoCode)}`;
    if (step) url += `&step=${step}`;
    return url;
}

// Створити коротке посилання через окремий сервіс
async function createShortRecoveryLink(storeName, recoveryToken, promoCode, step, storeId, checkoutId) {
    const fullUrl = getRecoveryUrl(storeName, recoveryToken, promoCode, step);

    // Якщо сервіс коротких посилань не налаштований — повертаємо повну URL
    if (!SHORT_LINK_API || !SHORT_LINK_TOKEN) {
        return fullUrl;
    }

    try {
        const response = await axios.post(SHORT_LINK_API, {
            url: fullUrl,
            storeId,
            checkoutId,
            step
        }, {
            headers: { 'Authorization': `Bearer ${SHORT_LINK_TOKEN}` }
        });

        if (response.data.success && response.data.shortUrl) {
            return response.data.shortUrl;
        }
        return fullUrl;
    } catch (err) {
        console.error('[ShortLink] Error creating short link:', err.message);
        return fullUrl;
    }
}

function parseCartItems(cartDataStr) {
    if (!cartDataStr) return [];
    try {
        return JSON.parse(cartDataStr);
    } catch {
        return [];
    }
}

async function processStore(shop) {
    const storeId = shop.id;
    const sender = shop.turbosms_sender;
    const promoCode = shop.abandoned_promo_code;
    const storeName = shop.domain_url || shop.name || '';

    if (!sender) {
        console.log(`[Notifier] Store ${storeId}: no turbosms_sender configured, skipping Viber/SMS`);
    }

    const checkouts = await AbandonedCheckout.findForNotification(storeId);

    for (const checkout of checkouts) {
        const now = Date.now();
        const updatedAt = new Date(checkout.updated_at).getTime();
        const lastStep = checkout.last_step || 0;
        const lastSentAt = checkout.last_sent_at ? new Date(checkout.last_sent_at).getTime() : 0;

        try {
            // Step 1: Viber/SMS через 30 хв
            if (lastStep === 0 && (now - updatedAt) >= STEP1_DELAY) {
                if (checkout.phone && sender) {
                    const link = await createShortRecoveryLink(storeName, checkout.recovery_token, null, 1, storeId, checkout.id);
                    const viberText = `Ви не завершили замовлення. Ваші товари ще чекають на вас! Повернутися: ${link}`;
                    const smsText = `Ви не завершили замовлення. Повернутися: ${link}`;

                    const result = await sendViberWithSmsFallback(checkout.phone, viberText, smsText, sender);

                    await NotificationLog.save({
                        abandonedCheckoutId: checkout.id,
                        storeId,
                        step: 1,
                        channel: 'viber_sms',
                        recipient: checkout.phone,
                        messageId: result.messageId
                    });

                    console.log(`[Notifier] Step 1 sent to ${checkout.phone} (checkout #${checkout.id})`);
                }
            }

            // Step 2: Email через 24 год після step 1
            if (lastStep === 1 && (now - lastSentAt) >= STEP2_DELAY) {
                if (checkout.email) {
                    const cartItems = parseCartItems(checkout.cart_data);
                    const link = await createShortRecoveryLink(storeName, checkout.recovery_token, null, 2, storeId, checkout.id);

                    const result = await sendAbandonedCartEmail({
                        email: checkout.email,
                        firstName: checkout.first_name,
                        cartItems,
                        recoveryLink: link,
                        storeName: storeName.replace(/^https?:\/\//, '')
                    });

                    await NotificationLog.save({
                        abandonedCheckoutId: checkout.id,
                        storeId,
                        step: 2,
                        channel: 'email',
                        recipient: checkout.email,
                        messageId: result.messageId
                    });

                    console.log(`[Notifier] Step 2 email sent to ${checkout.email} (checkout #${checkout.id})`);
                }
            }

            // Step 3: Viber/SMS зі знижкою через 48 год після step 2
            if (lastStep === 2 && (now - lastSentAt) >= STEP3_DELAY) {
                if (checkout.phone && sender) {
                    const link = await createShortRecoveryLink(storeName, checkout.recovery_token, promoCode, 3, storeId, checkout.id);
                    const discount = promoCode ? ` зі знижкою (промокод ${promoCode})` : '';

                    const viberText = `Спеціально для вас! Завершіть замовлення${discount}: ${link}`;
                    const smsText = `Знижка на ваше замовлення${discount}! ${link}`;

                    const result = await sendViberWithSmsFallback(checkout.phone, viberText, smsText, sender);

                    await NotificationLog.save({
                        abandonedCheckoutId: checkout.id,
                        storeId,
                        step: 3,
                        channel: 'viber_sms',
                        recipient: checkout.phone,
                        messageId: result.messageId
                    });

                    console.log(`[Notifier] Step 3 promo sent to ${checkout.phone} (checkout #${checkout.id})`);
                }
            }
        } catch (error) {
            console.error(`[Notifier] Error processing checkout #${checkout.id}:`, error.message);
        }
    }
}

async function processAbandonedCarts() {
    try {
        // Отримуємо всі магазини з увімкненими нотифікаціями
        const shops = await Shop.findAll ? await Shop.findAll() : [];

        // Якщо findAll не існує, використовуємо пряму query
        const db = require('../config/db');
        const { rows } = await db.query(
            `SELECT * FROM shops WHERE abandoned_notifications_enabled = true`
        );

        for (const shop of rows) {
            try {
                await processStore(shop);
            } catch (error) {
                console.error(`[Notifier] Error processing store ${shop.id}:`, error.message);
            }
        }
    } catch (error) {
        console.error('[Notifier] Fatal error:', error.message);
    }
}

module.exports = { processAbandonedCarts };
