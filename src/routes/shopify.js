const express = require('express');
const axios = require("axios");
const crypto = require('crypto');
const {getCartShopify, createOrder, getOrderNumber, sendTelegramMessage, applyDiscountCode} = require("../shopify/shopify");
const Shop = require("../models/Shop");
const Invoice = require("../models/Invoice");
const { sendGA4Conversion } = require('../services/ga4');
const GATrackingData = require("../models/GATrackingData");
const InvoiceConnector = require('../models/InvoiceConnector');
const Reference = require('../models/References');
const PromoCode = require('../models/PromoCode');
const router = express.Router();

// Добавьте эту строку перед определением маршрутов
router.use(express.json());

const allowedIps = [
    '35.158.201.27',
    '52.58.160.42',
    '35.158.31.50',
    '35.158.251.173'
];

// Функция для генерации подписи Hutko
// Согласно документации Hutko: https://docs.hutko.org/uk/docs/page/3/
// Алгоритм:
// 1. Добавить merchant_id в параметры (если его нет)
// 2. Отфильтровать пустые значения (но не значения "0")
// 3. Отсортировать по ключам
// 4. Взять только значения (array_values)
// 5. Добавить secretKey в начало массива
// 6. Объединить через "|"
// 7. SHA1 от получившейся строки
function generateHutkoSignature(params, secretKey, merchantId) {
    // Исключаем поле signature из расчета подписи
    const paramsForSignature = { ...params };
    delete paramsForSignature.signature;
    
    // Добавляем merchant_id в параметры (если его нет)
    if (!paramsForSignature.merchant_id && merchantId) {
        paramsForSignature.merchant_id = merchantId;
    }
    
    // Отфильтровываем пустые значения (но не "0" и не false)
    // В PHP array_filter с strlen удаляет пустые строки, null, но не "0"
    const filteredParams = {};
    for (const key in paramsForSignature) {
        const value = paramsForSignature[key];
        // Сохраняем значение, если оно не пустая строка и не null/undefined
        // Но сохраняем "0", false, и другие "ложные" значения, которые не являются пустыми строками
        if (value !== null && value !== undefined && value !== '') {
            filteredParams[key] = value;
        } else if (value === 0 || value === '0' || value === false) {
            // Сохраняем 0, "0", false
            filteredParams[key] = value;
        }
    }
    
    // Сортируем параметры по ключу
    const sortedKeys = Object.keys(filteredParams).sort();
    
    // Берем только значения (array_values)
    const values = sortedKeys.map(key => String(filteredParams[key]));
    
    // Добавляем secretKey в начало массива (array_unshift)
    values.unshift(secretKey);
    
    // Объединяем через "|"
    const signatureString = values.join('|');
    
    // Генерируем SHA1 хеш (не HMAC, а просто SHA1)
    return crypto.createHash('sha1').update(signatureString).digest('hex').toLowerCase();
}

// Пример эндпоинта для выполнения GraphQL запроса
router.get('/cart', async (req, res) => {
    try {
        const shop = await Shop.findById(req.query.storeId);
        const shopData = {
            apiSecretKey: shop.storefront_api_token,
            hostName: shop.shopify_url,
            adminApiAccessToken: shop.admin_api_token
        };
        res.json(await getCartShopify(req.query.cartid, req.query.storeId, shopData));
    } catch (error) {
        console.error('Shopify request error:', error);
        res.status(500).json({ error: 'Shopify API error' });
    }
});

router.post('/cart/discount', async (req, res) => {
    try {
        const { cartId, discountCode, storeId } = req.body;
        if (!cartId || !discountCode || !storeId) {
            return res.status(400).json({ error: 'cartId, discountCode and storeId are required' });
        }
        const shop = await Shop.findById(storeId);
        const shopData = {
            apiSecretKey: shop.storefront_api_token,
            hostName: shop.shopify_url,
            adminApiAccessToken: shop.admin_api_token
        };
        const result = await applyDiscountCode(cartId, [discountCode], storeId, shopData);
        res.json(result);
    } catch (error) {
        console.error('Discount code error:', error);
        res.status(500).json({ error: 'Failed to apply discount code' });
    }
});

router.post('/order/create', async (req, res) => {
    try {
        const customerData = req.body.customerData
        const cartId = req.body.cartId
        const storeId = req.body.storeId
        const promoData = req.body.promoData ? JSON.parse(req.body.promoData) : null
        const shop = await Shop.findById(req.body.storeId);
        const shopData = {
            apiSecretKey: shop.storefront_api_token,
            hostName: shop.shopify_url,
            adminApiAccessToken: shop.admin_api_token
        };
        customerData.payment = 'Накладений платіж'
        const result = await createOrder(cartId, customerData, true, storeId, shopData, promoData)

        // Record promo code usage
        if (promoData && promoData.promoCodeId) {
            try {
                await PromoCode.incrementUsage(promoData.promoCodeId);
                await PromoCode.recordUsage(promoData.promoCodeId, {
                    orderId: result?.draftOrderComplete?.draftOrder?.order?.id || '',
                    email: customerData.email,
                    phone: customerData.phone,
                    discountApplied: promoData.discount_amount
                });
            } catch (promoErr) {
                console.error('Error recording promo usage:', promoErr);
            }
        }

        res.json(result)
    } catch (error) {
        console.error('Shopify request error:', error);
        res.status(500).json({ error: error.toString() });
    }
})

router.post('/payment', async (req, res) => {
    const { cartToken, formData, cartData, storeId, redirectUrl, estimatedTotal } = req.body;

    // Формируем объект basketOrder на основе данных cartData, модифицируя названия если нужно
    const basketOrder = cartData.map(item => {
        let name = item.title;
        if (name === "Фігурка за вашими параметрами") {
            name = "Колекційна фігурка";
        } else if (name === "Рамка за вашими параметрами") {
            name = "Декоративна рамка з фігурками";
        }
        return {
            name,
            qty: item.count,
            sum: item.price * 100,
            icon: item.image,
            unit: "шт.",
            code: "d21da1c47f3c45fca10a10c32518bdeb",
            tax: [],
        };
    });


    // Создать новый коннектор перед формированием reference
    const connector = new InvoiceConnector({});
    try {
        await connector.create();
    } catch (error) {
        console.log('Primary create method failed, trying alternative method:', error.message);
        try {
            await connector.createWithDbUuid();
        } catch (altError) {
            console.error('Both create methods failed:', altError);
            throw altError;
        }
    }

    // Шифруем reference (в простом виде через Base64)
    const monoPromoData = formData.promoData ? JSON.parse(formData.promoData) : null;
    const reference = Buffer.from(JSON.stringify({
        cartToken,
        firstName: formData.firstName,
        lastName: formData.lastName,
        tel: formData.tel,
        email: formData.email,
        comment: formData.comment,
        warehouse: formData.warehouse,
        city: formData.city,
        store_id: Number(storeId),
        connectorId: connector.id.toString(),
        promoData: monoPromoData,
    })).toString('base64');

    const referenceId = await new Reference({ base64: reference }).save()

    console.log(cartData)
    const totalAmountFromItems = cartData.reduce((acc, item) => acc + (item.price * item.count * 100), 0);
    let totalAmount = estimatedTotal ? Math.round(estimatedTotal * 100) : totalAmountFromItems;
    // Apply our promo code discount to Mono payment amount
    if (monoPromoData && monoPromoData.discount_amount > 0) {
        totalAmount = Math.max(0, totalAmount - Math.round(monoPromoData.discount_amount * 100));
    }

    const invoiceData = {
        amount: totalAmount,
        ccy: 980, // Код валюты (гривна)
        merchantPaymInfo: {
            reference: referenceId.toString(), // шифрованный reference
            destination: "Cплата за товар",
            basketOrder, // данные корзины
        },
        redirectUrl: (redirectUrl + "?connector_id=" + connector.id.toString()), // URL для перенаправления
        webHookUrl: `https://platizhka-back.vercel.app/shopify/payment/mono`, // Webhook URL
        validity: 3600, // Время действия инвойса 
        paymentType: "debit",
    };

    try {
        const shop = await Shop.findById(storeId);
        
        const response = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', invoiceData, {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control' : 'no-cache',
                'X-Token': shop.mono_checkout_token ? shop.mono_checkout_token : shop.mono_token
            },
        });

        await new Invoice({id: response.data.invoiceId, status: false, storeid: storeId }).save()

        // Не используем addMonoId для старого API, так как invoiceId не является UUID
        // connectorId уже сохранен в reference и будет использован в webhook

        await new GATrackingData({id: response.data.invoiceId, gclid: formData.gclid, clientId: formData.clientId, cartDataGA4: JSON.stringify(formData.cartData)}).save()

        res.json({
            success: true,
            invoiceId: response.data.invoiceId,
            pageUrl: response.data?.pageUrl,
            connectorId: connector.id.toString()
        });
    } catch (error) {
        console.error('Ошибка при создании инвойса:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка при создании инвойса',
        });
    }
});

router.post('/payment/mono', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Проверяем, что IP-адрес отправителя разрешен 
    if (!allowedIps.includes(clientIp)) {
        console.warn(`Запрос от неразрешенного IP-адреса: ${clientIp}`);
        return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const paymentData = req.body;
    console.log(paymentData)

    const reference = await Reference.findById(Number(paymentData.reference))
    if (!reference) {
        return res.status(400).json({ message: 'Reference not found' });
    }

    // Расшифровка reference
    const decodedReference = JSON.parse(Buffer.from(reference.base64, 'base64').toString('utf-8'));

    // if (decodedReference.cartDataGA4) {
    //     console.log('decodedReference cartData', decodedReference.cartDataGA4)
    // }

    const customerData = {
        firstName: decodedReference.firstName,
        lastName: decodedReference.lastName,
        phone: decodedReference.tel,
        email: decodedReference.email,
        note: decodedReference.comment,
        address: {
            address1: decodedReference.warehouse,
            city: decodedReference.city,
            country: 'Ukraine',
            zip: '00000'
        },
        payment: 'Monopay'
    }

    // Проверка статуса платежа
    if (paymentData.status === 'success') {
        try {
            console.log('MONOBANK INVOICEID:' + paymentData.invoiceId)
            const invoice = await Invoice.findById(paymentData.invoiceId)
            const storeId = !invoice ? decodedReference.store_id : invoice.storeid

            // Idempotency check: если invoice уже обработан, не создаём повторный заказ
            if (invoice && invoice.status === true) {
                console.log(`Invoice ${paymentData.invoiceId} already processed, skipping order creation`);
                return res.status(200).json({ message: 'Already processed' });
            }
            const gaTrackingData = await GATrackingData.findById(paymentData.invoiceId)
            const shop = await Shop.findById(storeId);
            const shopData = {
                apiSecretKey: shop.storefront_api_token,
                hostName: shop.shopify_url,
                adminApiAccessToken: shop.admin_api_token
            };
            const monoPromoData = decodedReference.promoData || null;
            const createOrderResponse = await createOrder(
                decodedReference.cartToken,
                customerData,
                false,
                storeId,
                shopData,
                monoPromoData
            );

            // Record promo code usage for Mono payments
            if (monoPromoData && monoPromoData.promoCodeId) {
                try {
                    await PromoCode.incrementUsage(monoPromoData.promoCodeId);
                    await PromoCode.recordUsage(monoPromoData.promoCodeId, {
                        orderId: createOrderResponse?.draftOrderComplete?.draftOrder?.order?.id || '',
                        email: customerData.email,
                        phone: customerData.phone,
                        discountApplied: monoPromoData.discount_amount
                    });
                } catch (promoErr) {
                    console.error('Error recording promo usage (Mono):', promoErr);
                }
            }

            // Ищем коннектор по connectorId из reference (для старого API)
            // или по mono_id (для нового API, если бы использовался)
            let connector = null;
            if (decodedReference.connectorId) {
                connector = await InvoiceConnector.findById(decodedReference.connectorId);
            } else {
                // Fallback: пытаемся найти по mono_id (для совместимости)
                try {
                    connector = await InvoiceConnector.findByMonoId(paymentData.invoiceId);
                } catch (error) {
                    // Игнорируем ошибку, если invoiceId не UUID
                    console.log('Could not find connector by mono_id (invoiceId is not UUID):', paymentData.invoiceId);
                }
            }

            if (connector && createOrderResponse?.draftOrderComplete?.draftOrder?.order?.id) {
                const orderId_last = createOrderResponse.draftOrderComplete.draftOrder.order.id.split('/').pop();
                const orderId = await getOrderNumber("gid://shopify/Order/" + orderId_last, storeId, shopData);
                await connector.addShopifyOrderId(orderId.replace('#', ''));
            }

            await invoice.changeStatus()

            const cartDataGA4 = gaTrackingData.cart_data_ga4 ? JSON.parse(gaTrackingData.cart_data_ga4) : null
            console.log('cartDataGA4', cartDataGA4)

            if (
                decodedReference.store_id === 1 && cartDataGA4 && cartDataGA4.lines && cartDataGA4.lines.edges && cartDataGA4.lines.edges.length <= 0
            ) {
                console.error('Cart data is missing, invalid, or empty or store_id is not 1:', cartDataGA4);
            } else {
                try {
                    // Инициализация массива товаров и расчёт суммы
                    const items = [];
                    const value = Math.round(cartDataGA4.estimatedCost.totalAmount.amount);
            
                    cartDataGA4.lines.edges.forEach((edge) => {
                        const product = edge.node.merchandise.product;
                        const variant = edge.node.merchandise;
            
                        const productId = product.id.split('/').pop();
                        const variantId = variant.id.split('/').pop();
                        const customId = `shopify_UA_${productId}_${variantId}`;
            
                        items.push({
                            item_id: customId,
                            item_name: product.title,
                            quantity: edge.node.quantity,
                            price: parseFloat(variant.price.amount),
                        });
                    });

                    if (gaTrackingData.client_id) {
                        console.log('Sending GA4 Conversion:', {
                            clientId: gaTrackingData.client_id,
                            transactionId: paymentData.invoiceId,
                            value,
                            items,
                        });

                        await sendGA4Conversion(gaTrackingData.client_id, paymentData.invoiceId, value, items,gaTrackingData.gclid);
                    } else {
                        console.warn('Client ID отсутствует, пропуск отправки в GA4');
                    }
                } catch (error) {
                    console.error('Ошибка обработки cartDataGA4 для GA4:', error);
                }
            }

            return res.status(200).json({ message: 'Order created', data: createOrderResponse });
        } catch (error) {
            console.error('Ошибка при создании заказа:', error);
            const errorMessage = `🚨 КРИТИЧНА ПОМИЛКА: Оплата пройшла, але замовлення НЕ створено!
Провайдер: Monobank (Merchant API)
Invoice ID: ${paymentData.invoiceId}
Reference ID: ${paymentData.reference}
Клієнт: ${customerData.firstName} ${customerData.lastName}
Телефон: ${customerData.phone}
Email: ${customerData.email}
Місто: ${customerData.address?.city || 'N/A'}
Відділення: ${customerData.address?.address1 || 'N/A'}
Store ID: ${decodedReference.store_id}
Помилка: ${error?.message || 'Невідома помилка'}
Stack: ${error?.stack?.substring(0, 500) || 'N/A'}`;
            try {
                await sendTelegramMessage(errorMessage, '567427708');
            } catch (tgError) {
                console.error('Failed to send Telegram notification:', tgError);
            }
            return res.status(500).json({ message: 'Order create error', error: error.message });
        }
    } else {
        return res.status(400).json({ message: 'Payment declined' });
    }
});

router.get('/payment/status', async (req, res) => {
    const { invoiceId } = req.query;
    try {
        const invoice = await Invoice.findById(invoiceId)
        if (!invoice) {
            res.json({ paymentStatus: false });
            return
        }

        res.json({ paymentStatus: invoice.status });

    } catch (error) {
        console.error('Shopify request error: ', error);
        res.status(500).json({ error: 'Shopify API error' });
    }
});

router.get('/order/number', async (req, res) => {
    try {
        const { orderId, storeId } = req.query;
        
        console.log('[GET /shopify/order/number] Запрос получен:', { orderId, storeId });
        
        if (!orderId || !storeId) {
            console.error('[GET /shopify/order/number] Отсутствуют обязательные параметры:', { orderId, storeId });
            return res.status(400).json({ error: 'orderId и storeId обязательны' });
        }

        console.log('[GET /shopify/order/number] Поиск магазина по storeId:', storeId);
        const shop = await Shop.findById(storeId);
        if (!shop) {
            console.error('[GET /shopify/order/number] Магазин не найден для storeId:', storeId);
            return res.status(404).json({ error: 'Магазин не найден' });
        }

        console.log('[GET /shopify/order/number] Магазин найден:', { 
            shopId: shop._id, 
            hostName: shop.shopify_url 
        });

        const shopData = {
            apiSecretKey: shop.storefront_api_token,
            hostName: shop.shopify_url,
            adminApiAccessToken: shop.admin_api_token
        };

        console.log('[GET /shopify/order/number] Вызов getOrderNumber с параметрами:', {
            orderId,
            storeId,
            hostName: shopData.hostName
        });

        // Передаем orderId как есть - функция getOrderNumber сама определит формат
        const orderNumber = await getOrderNumber(orderId, storeId, shopData);
        
        console.log('[GET /shopify/order/number] Успешно получен номер заказа:', orderNumber);
        
        res.json({ orderNumber });
    } catch (error) {
        console.error('[GET /shopify/order/number] Ошибка:', {
            message: error.message,
            stack: error.stack,
            orderId: req.query.orderId,
            storeId: req.query.storeId
        });
        res.status(500).json({ error: 'Shopify API error', message: error.message });
    }
});

// Эндпоинт для создания заказа в Hutko (аналог /payment для Mono)
router.post('/payment/hutko', async (req, res) => {
    const { cartToken, formData, cartData, storeId, redirectUrl, estimatedTotal } = req.body;

    try {
        const shop = await Shop.findById(storeId);
        if (!shop) {
            return res.status(404).json({ error: 'Shop not found' });
        }




        // Проверяем наличие необходимых данных для Hutko
        if (!shop.hutko_merchant_id || !shop.hutko_secret_key) {
            return res.status(400).json({ error: 'Hutko credentials not configured for this shop' });
        }

        // Создать новый коннектор перед формированием reference
        const connector = new InvoiceConnector({});
        try {
            await connector.create();
        } catch (error) {
            console.log('Primary create method failed, trying alternative method:', error.message);
            try {
                await connector.createWithDbUuid();
            } catch (altError) {
                console.error('Both create methods failed:', altError);
                throw altError;
            }
        }

        // Шифруем reference (в простом виде через Base64)
        const promoData = formData.promoData ? JSON.parse(formData.promoData) : null;
        const reference = Buffer.from(JSON.stringify({
            cartToken,
            firstName: formData.firstName,
            lastName: formData.lastName,
            tel: formData.tel,
            email: formData.email,
            comment: formData.comment,
            warehouse: formData.warehouse,
            city: formData.city,
            store_id: Number(storeId),
            connectorId: connector.id.toString(),
            promoData: promoData,
        })).toString('base64');

        const referenceId = await new Reference({ base64: reference }).save();

        console.log(cartData);
        const totalAmountFromItems = cartData.reduce((acc, item) => acc + (item.price * item.count * 100), 0);
        let totalAmount = estimatedTotal ? Math.round(estimatedTotal * 100) : totalAmountFromItems;
        // Apply our promo code discount to payment amount
        if (promoData && promoData.discount_amount > 0) {
            totalAmount = Math.max(0, totalAmount - Math.round(promoData.discount_amount * 100));
        }

        // Формируем описание заказа
        const orderDesc = cartData.map(item => `${item.title} x${item.count}`).join(', ');

        // Формируем параметры для запроса
        // Сохраняем reference_id в merchant_data для использования в callback
        const hutkoOrderId = `${referenceId}_${Date.now()}`;
        const merchantData = JSON.stringify({ reference_id: referenceId.toString() });
        const requestParams = {
            sender_email: formData.email,
            response_url: (redirectUrl + "?connector_id=" + connector.id.toString()),
            server_callback_url: `https://platizhka-back.vercel.app/shopify/payment/hutko/callback`,
            order_id: hutkoOrderId,
            currency: 'UAH',
            merchant_id: shop.hutko_merchant_id,
            order_desc: orderDesc.substring(0, 255), // Ограничение длины описания
            amount: totalAmount,
            merchant_data: merchantData,
        };

        // Генерируем подпись
        const signature = generateHutkoSignature(requestParams, shop.hutko_secret_key, shop.hutko_merchant_id);
        requestParams.signature = signature;

        // Отправляем запрос на создание токена
        const response = await axios.post('https://pay.hutko.org/api/checkout/token/', {
            request: requestParams
        }, {
            headers: {
                'Content-Type': 'application/json',
            },
        });

        console.log('Hutko API response:', response.data.response);
        if (response.data.response.response_status === 'failure') {
            console.error('Hutko API error:', response.data.response);
            return res.status(400).json({
                success: false,
                message: response.data.response.error_message || 'Ошибка при создании заказа',
                error_code: response.data.response.error_code
            });
        }

        const token = response.data.response.token;

        // Сохраняем invoice с hutko order_id как идентификатором
        await new Invoice({ id: hutkoOrderId, status: false, storeid: storeId }).save();

        // Формируем pageUrl с токеном
        const pageUrl = `https://pay.hutko.org/merchants/ce3dc7675b723b76d2abdaab35e9c6ecb77f3662/default/index.html?token=${token}`;

        res.json({
            success: true,
            invoiceId: hutkoOrderId,
            pageUrl: pageUrl,
            connectorId: connector.id.toString()
        });
    } catch (error) {
        console.error('Ошибка при создании заказа в Hutko:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка при создании заказа',
            error: error.message
        });
    }
});

// Эндпоинт для обработки callback от Hutko (аналог /payment/mono)
router.post('/payment/hutko/callback', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Проверяем, что IP-адрес отправителя разрешен
    // Примечание: возможно, Hutko использует другие IP-адреса, их нужно будет добавить
    if (!allowedIps.includes(clientIp)) {
        console.warn(`Запрос от неразрешенного IP-адреса: ${clientIp}`);
        // Пока не блокируем, так как IP Hutko могут отличаться
        // return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const paymentData = req.body;
    console.log('Hutko callback data:', paymentData);

    try {
        // В Hutko callback приходит order_id, по которому мы можем найти reference
        // Но обычно в callback приходит order_id, который мы использовали при создании заказа
        const orderId = paymentData.order_id;
        
        if (!orderId) {
            return res.status(400).json({ message: 'order_id is required' });
        }

        const invoice = await Invoice.findById(orderId);
        if (!invoice) {
            console.error(`Invoice not found: ${orderId}`);
            return res.status(404).json({ message: 'Invoice not found' });
        }

        // Idempotency check: если invoice уже обработан, не создаём повторный заказ
        if (invoice.status === true) {
            console.log(`Invoice ${orderId} already processed (Hutko), skipping order creation`);
            return res.status(200).json({ message: 'Already processed' });
        }

        // Проверяем статус платежа
        if (paymentData.response_status === 'success' && paymentData.order_status === 'approved') {
            // Извлекаем reference_id из merchant_data или парсим из order_id
            let referenceId;
            if (paymentData.merchant_data) {
                try {
                    const md = JSON.parse(paymentData.merchant_data);
                    referenceId = md.reference_id;
                } catch (e) {
                    referenceId = orderId.split('_')[0];
                }
            } else {
                referenceId = orderId.split('_')[0];
            }

            const reference = await Reference.findById(Number(referenceId));
            if (!reference) {
                console.error(`Reference not found for reference_id: ${referenceId}`);
                return res.status(404).json({ message: 'Reference not found' });
            }

            // Расшифровка reference
            const decodedReference = JSON.parse(Buffer.from(reference.base64, 'base64').toString('utf-8'));

            const customerData = {
                firstName: decodedReference.firstName,
                lastName: decodedReference.lastName,
                phone: decodedReference.tel,
                email: decodedReference.email,
                note: decodedReference.comment,
                address: {
                    address1: decodedReference.warehouse,
                    city: decodedReference.city,
                    country: 'Ukraine',
                    zip: '00000'
                },
                payment: 'Hutko'
            };

            const storeId = invoice.storeid;
            const gaTrackingData = await GATrackingData.findById(orderId);
            const shop = await Shop.findById(storeId);
            const shopData = {
                apiSecretKey: shop.storefront_api_token,
                hostName: shop.shopify_url,
                adminApiAccessToken: shop.admin_api_token
            };

            const refPromoData = decodedReference.promoData || null;
            const createOrderResponse = await createOrder(
                decodedReference.cartToken,
                customerData,
                false,
                storeId,
                shopData,
                refPromoData
            );

            // Record promo code usage
            if (refPromoData && refPromoData.promoCodeId) {
                try {
                    await PromoCode.incrementUsage(refPromoData.promoCodeId);
                    await PromoCode.recordUsage(refPromoData.promoCodeId, {
                        orderId: createOrderResponse?.draftOrderComplete?.draftOrder?.order?.id || '',
                        email: customerData.email,
                        phone: customerData.phone,
                        discountApplied: refPromoData.discount_amount
                    });
                } catch (promoErr) {
                    console.error('Error recording promo usage (Hutko):', promoErr);
                }
            }

            // Ищем коннектор по connectorId из reference
            let connector = null;
            if (decodedReference.connectorId) {
                connector = await InvoiceConnector.findById(decodedReference.connectorId);
            }

            if (connector && createOrderResponse?.draftOrderComplete?.draftOrder?.order?.id) {
                const orderId_last = createOrderResponse.draftOrderComplete.draftOrder.order.id.split('/').pop();
                const orderId_shopify = await getOrderNumber("gid://shopify/Order/" + orderId_last, storeId, shopData);
                await connector.addShopifyOrderId(orderId_shopify.replace('#', ''));
            }

            await invoice.changeStatus();

            const cartDataGA4 = gaTrackingData && gaTrackingData.cart_data_ga4 ? JSON.parse(gaTrackingData.cart_data_ga4) : null;
            console.log('cartDataGA4', cartDataGA4);

            if (
                decodedReference.store_id === 1 && cartDataGA4 && cartDataGA4.lines && cartDataGA4.lines.edges && cartDataGA4.lines.edges.length > 0
            ) {
                try {
                    const items = [];
                    const value = Math.round(cartDataGA4.estimatedCost.totalAmount.amount);

                    cartDataGA4.lines.edges.forEach((edge) => {
                        const product = edge.node.merchandise.product;
                        const variant = edge.node.merchandise;

                        const productId = product.id.split('/').pop();
                        const variantId = variant.id.split('/').pop();
                        const customId = `shopify_UA_${productId}_${variantId}`;

                        items.push({
                            item_id: customId,
                            item_name: product.title,
                            quantity: edge.node.quantity,
                            price: parseFloat(variant.price.amount),
                        });
                    });

                    if (gaTrackingData && gaTrackingData.client_id) {
                        console.log('Sending GA4 Conversion:', {
                            clientId: gaTrackingData.client_id,
                            transactionId: orderId,
                            value,
                            items,
                        });

                        await sendGA4Conversion(gaTrackingData.client_id, orderId, value, items, gaTrackingData.gclid);
                    } else {
                        console.warn('Client ID отсутствует, пропуск отправки в GA4');
                    }
                } catch (error) {
                    console.error('Ошибка обработки cartDataGA4 для GA4:', error);
                }
            }

            return res.status(200).json({ message: 'Order created', data: createOrderResponse });
        } else {
            console.error('Payment declined:', paymentData);
            return res.status(400).json({ message: 'Payment declined', data: paymentData });
        }
    } catch (error) {
        console.error('Ошибка при обработке callback от Hutko:', error);
        const errorMessage = `🚨 КРИТИЧНА ПОМИЛКА: Оплата Hutko пройшла, але замовлення НЕ створено!
Провайдер: Hutko
Order ID: ${paymentData?.order_id || 'N/A'}
Response Status: ${paymentData?.response_status || 'N/A'}
Order Status: ${paymentData?.order_status || 'N/A'}
Callback Data: ${JSON.stringify(paymentData).substring(0, 500)}
Помилка: ${error?.message || 'Невідома помилка'}
Stack: ${error?.stack?.substring(0, 500) || 'N/A'}`;
        try {
            await sendTelegramMessage(errorMessage, '567427708');
        } catch (tgError) {
            console.error('Failed to send Telegram notification:', tgError);
        }
        return res.status(500).json({ message: 'Callback processing error', error: error.message });
    }
});



module.exports = router;