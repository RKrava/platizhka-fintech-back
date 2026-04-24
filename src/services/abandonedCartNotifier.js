const AbandonedCheckout = require('../models/AbandonedCheckout');
const NotificationLog = require('../models/NotificationLog');
const Shop = require('../models/Shop');
const axios = require('axios');
const { sendViberWithSmsFallback, sendSms } = require('./turbosms');
const { sendAbandonedCartEmail } = require('./emailService');

// Дефолтні таймінги (використовуються якщо в shop не задано)
const DEFAULT_STEP1_MINUTES = 30;
const DEFAULT_STEP2_MINUTES = 1440;  // 24 год
const DEFAULT_STEP3_MINUTES = 2880;  // 48 год після step 2

// Дозволений проміжок відправки (година за Києвом, 0..23)
// Дефолт: з 9:00 до 22:00 (відправляємо якщо hour >= QUIET_END і hour < QUIET_START)
const QUIET_START = parseInt(process.env.NOTIF_QUIET_START_HOUR || '22', 10); // з 22:00 — тиша
const QUIET_END = parseInt(process.env.NOTIF_QUIET_END_HOUR || '9', 10);       // до 9:00 — тиша

function isQuietHours(date = new Date()) {
    // Час у часовому поясі Києва (Europe/Kyiv = UTC+2 або UTC+3 взимку/влітку)
    const kyivHourStr = date.toLocaleString('en-US', { timeZone: 'Europe/Kyiv', hour: '2-digit', hour12: false });
    const hour = parseInt(kyivHourStr, 10);
    if (isNaN(hour)) return false;
    // "Тихі години" — коли НЕ слати
    if (QUIET_START > QUIET_END) {
        // нормальний випадок: 22..23 або 0..8 → тиша
        return hour >= QUIET_START || hour < QUIET_END;
    }
    // якщо someone inverted — QUIET_START < QUIET_END, тиша між ними
    return hour >= QUIET_START && hour < QUIET_END;
}

// URL сервісу коротких посилань (brikl.ink)
const SHORT_LINK_API = process.env.SHORT_LINK_API; // https://brikl.ink/api/create
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

// Mint a unique single-use promo code with a 24-hour expiry, used by
// the Step-3 "last chance" message. Each customer gets their own code,
// so the deadline is genuinely personal (expiring 24h from when we
// actually send) rather than a shared static code. Returns the code
// string on success or null if we can't mint (no %, repeated UNIQUE
// collisions, or a DB error).
async function mintUrgentPromoCode(storeId, percent, hoursValid = 24) {
    if (!percent || percent < 1 || percent > 99) return null;
    const db = require('../config/db');
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const expiresAt = new Date(Date.now() + hoursValid * 60 * 60 * 1000).toISOString();

    for (let attempt = 0; attempt < 4; attempt++) {
        let tail = '';
        for (let i = 0; i < 8; i++) tail += alphabet[Math.floor(Math.random() * alphabet.length)];
        const code = `RUSH-${tail}`;
        try {
            const res = await db.query(
                `INSERT INTO promo_codes
                    (store_id, code, discount_type, discount_value, min_order_amount,
                     max_uses, used_count, active, code_type, starts_at, expires_at)
                 VALUES ($1, $2, 'percentage', $3, 0, 1, 0, true, 'system', NOW(), $4)
                 RETURNING code`,
                [storeId, code, percent, expiresAt]
            );
            if (res.rows[0]) return res.rows[0].code;
        } catch (err) {
            // 23505 = unique_violation on (store_id, code) — try another random tail
            if (err.code === '23505') continue;
            console.error('[mintUrgentPromoCode] insert error:', err.message);
            return null;
        }
    }
    return null;
}

async function processStore(shop) {
    const storeId = shop.id;
    const sender = shop.turbosms_sender;
    const turboToken = shop.turbosms_token || process.env.TURBOSMS_TOKEN;
    const promoCode = shop.abandoned_promo_code;
    // Urgent promo (step 3) — bigger discount, shorter validity. Falls
    // back to the regular promo code when unset so legacy shops keep
    // working without changes.
    const urgentPromoCode = shop.abandoned_promo_urgent_code || promoCode;
    const urgentPromoPercent = shop.abandoned_promo_urgent_percent || null;
    const storeName = shop.domain_url || shop.name || '';

    // Таймінги з налаштувань магазину (хвилини → мілісекунди)
    const STEP1_DELAY = (shop.notif_step1_minutes || DEFAULT_STEP1_MINUTES) * 60 * 1000;
    const STEP2_DELAY = (shop.notif_step2_minutes || DEFAULT_STEP2_MINUTES) * 60 * 1000;
    const STEP3_DELAY = (shop.notif_step3_minutes || DEFAULT_STEP3_MINUTES) * 60 * 1000;
    const smsFirst = (shop.notif_channel_priority || 'sms_first') === 'sms_first';

    if (!sender || !turboToken) {
        console.log(`[Notifier] Store ${storeId}: TurboSMS not configured`);
    }

    const checkouts = await AbandonedCheckout.findForNotification(storeId);

    for (const checkout of checkouts) {
        const now = Date.now();
        const updatedAt = new Date(checkout.updated_at).getTime();
        const lastStep = checkout.last_step || 0;
        const lastSentAt = checkout.last_sent_at ? new Date(checkout.last_sent_at).getTime() : 0;

        const hasPhone = !!(checkout.phone && sender && turboToken);
        const hasEmail = !!checkout.email;
        const smtpConfig = (shop.smtp_host && shop.smtp_user) ? {
            host: shop.smtp_host, port: shop.smtp_port || 587,
            user: shop.smtp_user, pass: shop.smtp_pass, from: shop.smtp_from
        } : null;
        const canEmail = hasEmail && smtpConfig;

        // Немає жодного каналу — пропускаємо
        if (!hasPhone && !canEmail) continue;

        try {
            // ===== STEP 1: Нагадування =====
            // Пріоритет каналу з налаштувань: sms_first або email_first
            if (lastStep === 0 && (now - updatedAt) >= STEP1_DELAY) {
                const link = await createShortRecoveryLink(storeName, checkout.recovery_token, null, 1, storeId, checkout.id);
                const useSmsFirst = smsFirst ? hasPhone : !canEmail && hasPhone;
                const useEmailFirst = !smsFirst ? canEmail : !hasPhone && canEmail;

                if (useSmsFirst || (!useEmailFirst && hasPhone)) {
                    const viberText = `Ви не завершили замовлення. Ваші товари ще чекають на вас! Повернутися: ${link}`;
                    const smsText = `Ви не завершили замовлення. Повернутися: ${link}`;
                    const result = await sendSms(checkout.phone, smsText, sender, turboToken);
                    await NotificationLog.save({ abandonedCheckoutId: checkout.id, storeId, step: 1, channel: 'sms', recipient: checkout.phone, messageId: result.messageId, messageText: smsText });
                    console.log(`[Notifier] Step 1 sms → ${checkout.phone} (checkout #${checkout.id})`);
                } else if (useEmailFirst || canEmail) {
                    const cartItems = parseCartItems(checkout.cart_data);
                    const result = await sendAbandonedCartEmail({ email: checkout.email, firstName: checkout.first_name, cartItems, recoveryLink: link, storeName: storeName.replace(/^https?:\/\//, ''), smtpConfig });
                    await NotificationLog.save({ abandonedCheckoutId: checkout.id, storeId, step: 1, channel: 'email', recipient: checkout.email, messageId: result.messageId, messageText: `📧 Нагадування про покинутий кошик — посилання ${link}` });
                    console.log(`[Notifier] Step 1 email → ${checkout.email} (checkout #${checkout.id})`);
                }
            }

            // ===== STEP 2: Другий канал (24 год) =====
            // Якщо step 1 був SMS → тепер Email (якщо є)
            // Якщо step 1 був Email → тепер SMS (якщо є)
            // Якщо другий канал недоступний → повторити перший канал
            if (lastStep === 1 && (now - lastSentAt) >= STEP2_DELAY) {
                const link = await createShortRecoveryLink(storeName, checkout.recovery_token, null, 2, storeId, checkout.id);
                // Визначаємо який канал був в step 1 з notification_log
                const db = require('../config/db');
                const step1Log = await db.query('SELECT channel FROM notification_log WHERE abandoned_checkout_id = $1 AND step = 1 LIMIT 1', [checkout.id]);
                const step1Channel = step1Log.rows[0]?.channel;

                if (step1Channel === 'viber_sms' && canEmail) {
                    // Step 1 був SMS → Step 2 Email
                    const cartItems = parseCartItems(checkout.cart_data);
                    const result = await sendAbandonedCartEmail({ email: checkout.email, firstName: checkout.first_name, cartItems, recoveryLink: link, storeName: storeName.replace(/^https?:\/\//, ''), smtpConfig });
                    await NotificationLog.save({ abandonedCheckoutId: checkout.id, storeId, step: 2, channel: 'email', recipient: checkout.email, messageId: result.messageId, messageText: `📧 Друге нагадування (email) — посилання ${link}` });
                    console.log(`[Notifier] Step 2 email → ${checkout.email} (checkout #${checkout.id})`);
                } else if (step1Channel === 'email' && hasPhone) {
                    // Step 1 був Email → Step 2 SMS
                    const viberText = `Нагадуємо: ви не завершили замовлення. Повернутися: ${link}`;
                    const smsText = `Нагадуємо: ви не завершили замовлення. ${link}`;
                    const result = await sendViberWithSmsFallback(checkout.phone, viberText, smsText, sender, turboToken);
                    await NotificationLog.save({ abandonedCheckoutId: checkout.id, storeId, step: 2, channel: 'viber_sms', recipient: checkout.phone, messageId: result.messageId, messageText: smsText });
                    console.log(`[Notifier] Step 2 viber/sms → ${checkout.phone} (checkout #${checkout.id})`);
                } else if (hasPhone) {
                    // Тільки SMS — повторюємо SMS
                    const viberText = `Ваші товари ще чекають! Завершіть замовлення: ${link}`;
                    const smsText = `Ваші товари чекають! ${link}`;
                    const result = await sendViberWithSmsFallback(checkout.phone, viberText, smsText, sender, turboToken);
                    await NotificationLog.save({ abandonedCheckoutId: checkout.id, storeId, step: 2, channel: 'viber_sms', recipient: checkout.phone, messageId: result.messageId, messageText: smsText });
                    console.log(`[Notifier] Step 2 viber/sms (repeat) → ${checkout.phone} (checkout #${checkout.id})`);
                } else if (canEmail) {
                    // Тільки Email — повторюємо Email
                    const cartItems = parseCartItems(checkout.cart_data);
                    const result = await sendAbandonedCartEmail({ email: checkout.email, firstName: checkout.first_name, cartItems, recoveryLink: link, storeName: storeName.replace(/^https?:\/\//, ''), smtpConfig });
                    await NotificationLog.save({ abandonedCheckoutId: checkout.id, storeId, step: 2, channel: 'email', recipient: checkout.email, messageId: result.messageId, messageText: `📧 Друге нагадування (email, повтор) — посилання ${link}` });
                    console.log(`[Notifier] Step 2 email (repeat) → ${checkout.email} (checkout #${checkout.id})`);
                }
            }

            // ===== STEP 3: Остання знижка — терміново! =====
            // Bigger discount, only valid 24h — last chance messaging.
            // Канал: phone → Viber/SMS, тільки email → Email
            if (lastStep === 2 && (now - lastSentAt) >= STEP3_DELAY) {
                // If the shop configured a discount percent, mint a
                // unique single-use code per customer with a 24h expiry
                // instead of re-using the same static code. Falls back
                // to the static `urgent_code` and finally the generic
                // `abandoned_promo_code` so legacy setups keep working.
                let step3Code = null;
                if (urgentPromoPercent) {
                    step3Code = await mintUrgentPromoCode(storeId, urgentPromoPercent, 24);
                    if (!step3Code) console.warn(`[Notifier] mintUrgentPromoCode failed for checkout #${checkout.id}, falling back`);
                }
                if (!step3Code) step3Code = shop.abandoned_promo_urgent_code || promoCode;

                const link = await createShortRecoveryLink(storeName, checkout.recovery_token, step3Code, 3, storeId, checkout.id);
                // Percent tag is inlined into the copy when the shop
                // configured it, otherwise fall back to a generic
                // "special discount" phrase.
                const pctTag = urgentPromoPercent ? `-${urgentPromoPercent}%` : 'спеціальна знижка';
                const promoTag = step3Code ? ` (промокод ${step3Code})` : '';
                // Alias for the email text/log so we don't refactor every reference
                const urgentPromoCodeFinal = step3Code;

                if (hasPhone) {
                    const viberText =
                        `🔥 ОСТАННІЙ ШАНС! ${pctTag} на ваше замовлення${promoTag}. ` +
                        `Діє ТІЛЬКИ 24 години — не проґавте: ${link}`;
                    const smsText =
                        `🔥 Остання знижка ${pctTag}${promoTag}! Тільки 24 год: ${link}`;
                    const result = await sendViberWithSmsFallback(checkout.phone, viberText, smsText, sender, turboToken);
                    await NotificationLog.save({ abandonedCheckoutId: checkout.id, storeId, step: 3, channel: 'viber_sms', recipient: checkout.phone, messageId: result.messageId, messageText: smsText });
                    console.log(`[Notifier] Step 3 viber/sms → ${checkout.phone} (checkout #${checkout.id})`);
                } else if (canEmail) {
                    const cartItems = parseCartItems(checkout.cart_data);
                    const result = await sendAbandonedCartEmail({
                        email: checkout.email,
                        firstName: checkout.first_name,
                        cartItems,
                        recoveryLink: link,
                        storeName: storeName.replace(/^https?:\/\//, ''),
                        smtpConfig,
                        // Step-3 specific subject/intro hooks used by the
                        // abandoned-cart template when step === 3 to add
                        // urgency copy to the email.
                        step: 3,
                        promoCode: urgentPromoCodeFinal,
                        promoPercent: urgentPromoPercent,
                    });
                    await NotificationLog.save({ abandonedCheckoutId: checkout.id, storeId, step: 3, channel: 'email', recipient: checkout.email, messageId: result.messageId, messageText: `🔥 Остання знижка ${urgentPromoPercent ? `-${urgentPromoPercent}%` : ''} (${urgentPromoCodeFinal || '—'}) — email, 24 год` });
                    console.log(`[Notifier] Step 3 email → ${checkout.email} (checkout #${checkout.id})`);
                }
            }
        } catch (error) {
            console.error(`[Notifier] Error processing checkout #${checkout.id}:`, error.message);
        }
    }
}

async function processAbandonedCarts() {
    try {
        // Нічна тиша: не надсилаємо повідомлення поза дозволеним проміжком (за Києвом)
        if (isQuietHours()) {
            console.log(`[Notifier] Skipped — quiet hours (Kyiv). Дозволено з ${QUIET_END}:00 до ${QUIET_START}:00.`);
            return;
        }

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
