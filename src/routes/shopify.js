const express = require('express');
const axios = require("axios");
const {getCartShopify, createOrder, getOrderNumber} = require("../shopify/shopify");
const Shop = require("../models/Shop");
const Invoice = require("../models/Invoice");
const { sendGA4Conversion } = require('../services/ga4');
const GATrackingData = require("../models/GATrackingData");
const InvoiceConnector = require('../models/InvoiceConnector');
const Reference = require('../models/References');
const router = express.Router();

// Добавьте эту строку перед определением маршрутов
router.use(express.json());

const allowedIps = [
    '35.158.201.27',
    '52.58.160.42',
    '35.158.31.50',
    '35.158.251.173'
];

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

router.post('/order/create', async (req, res) => {
    try {
        const customerData = req.body.customerData
        const cartId = req.body.cartId
        const storeId = req.body.storeId
        const shop = await Shop.findById(req.body.storeId);
        const shopData = {
            apiSecretKey: shop.storefront_api_token,
            hostName: shop.shopify_url,
            adminApiAccessToken: shop.admin_api_token
        };
        customerData.payment = 'Накладений платіж'
        res.json(await createOrder(cartId, customerData, true, storeId, shopData))
    } catch (error) {
        console.error('Shopify request error:', error);
        res.status(500).json({ error: error.toString() });
    }
})

router.post('/payment', async (req, res) => {
    const { cartToken, formData, cartData, storeId, redirectUrl } = req.body;

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
        connectorId: connector.id.toString(), // Сохраняем connectorId в reference
        // gclid: formData.gclid, //_gcl_aw
        // clientId: formData.clientId, //client_id
        // cartDataGA4: formData.cartData //cartData
    })).toString('base64');

    const referenceId = await new Reference({ base64: reference }).save()

    console.log(cartData)
    const totalAmount = cartData.reduce((acc, item) => acc + (item.price * item.count * 100), 0);

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
            const gaTrackingData = await GATrackingData.findById(paymentData.invoiceId)
            const shop = await Shop.findById(storeId);
            const shopData = {
                apiSecretKey: shop.storefront_api_token,
                hostName: shop.shopify_url,
                adminApiAccessToken: shop.admin_api_token
            };
            const createOrderResponse = await createOrder(
                decodedReference.cartToken,
                customerData,
                false,
                storeId,
                shopData
            );

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

        // Если orderId не содержит префикс gid://shopify/Order/, добавляем его
        const formattedOrderId = orderId.startsWith('gid://shopify/Order/') 
            ? orderId 
            : `gid://shopify/Order/${orderId}`;

        console.log('[GET /shopify/order/number] Вызов getOrderNumber с параметрами:', {
            formattedOrderId,
            storeId,
            hostName: shopData.hostName
        });

        const orderNumber = await getOrderNumber(formattedOrderId, storeId, shopData);
        
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



module.exports = router;