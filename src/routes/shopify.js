const express = require('express');
const axios = require("axios");
const {getCartShopify, createOrder} = require("../shopify/shopify");
const Shop = require("../models/Shop");

const router = express.Router();

// Добавьте эту строку перед определением маршрутов
router.use(express.json());

let invoicesData = []

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

    // Формируем объект basketOrder на основе данных cartData
    const basketOrder = cartData.map(item => ({
        name: item.title,
        qty: item.count,
        sum: item.price * 100,
        icon: item.image,
        unit: "шт.",
        code: "d21da1c47f3c45fca10a10c32518bdeb",
        barcode: "string",
        header: "string",
        footer: "string",
        tax: [],
        uktzed: "string",
    }));

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
    })).toString('base64');

    const totalAmount = cartData.reduce((acc, item) => acc + (item.price * item.count * 100), 0);

    const invoiceData = {
        amount: totalAmount,
        ccy: 980, // Код валюты (гривна)
        merchantPaymInfo: {
            reference, // шифрованный reference
            destination: "Покупка щастя",
            basketOrder, // данные корзины
        },
        redirectUrl, // URL для перенаправления
        webHookUrl: `https://platizhka-back.vercel.app/shopify/payment/mono`, // Webhook URL
        validity: 3600, // Время действия инвойса
        paymentType: "debit",
    };
    try {
        const shop = await Shop.findById(storeId);
        console.log(shop)
        console.log(shop.mono_token)
        const response = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', invoiceData, {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control' : 'no-cache',
                'X-Token': shop.mono_token,
            },
        });

        invoicesData.push( {invoiceId: response.data.invoiceId, status: false, storeId} )

        res.json({
            success: true,
            invoiceId: response.data.invoiceId,
            pageUrl: response.data?.pageUrl,
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

    // Расшифровка reference
    const decodedReference = JSON.parse(Buffer.from(paymentData.reference, 'base64').toString('utf-8'));

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
            const storeId = invoicesData.find((item) => item.invoiceId === paymentData.invoiceId)?.storeId
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

            invoicesData = invoicesData.map((invoiceData) => {
                if (invoiceData.invoiceId === paymentData.invoiceId) {
                    return { ...invoiceData, status: true };
                }
                return invoiceData
            });

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
        const invoiceData = invoicesData.filter((item) => item.invoiceId == invoiceId)
        if (invoiceData[0]) {
            res.json({ paymentStatus: invoiceData[0]?.status });
            return
        }

        res.json({ paymentStatus: false });
    } catch (error) {
        console.error('Shopify request error: ', error);
        res.status(500).json({ error: 'Shopify API error' });
    }
});

module.exports = router;