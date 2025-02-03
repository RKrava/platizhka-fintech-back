const express = require('express');
const axios = require("axios");
const {getCartShopify, createOrder} = require("../shopify/shopify");
const Shop = require("../models/Shop");
const Invoice = require("../models/Invoice");
const { sendGA4Conversion } = require('../services/ga4');
const GATrackingData = require("../models/GATrackingData");

const router = express.Router();
router.use(express.json());

const allowedIps = [
    '35.158.201.27',
    '52.58.160.42',
    '35.158.31.50',
    '35.158.251.173'
];

router.get('/create/order', async (req, res) => {
    try {
        const {cartid, storeId, gclid, clientId, redirectUrl} = req.query;
        const shop = await Shop.findById(storeId);
        const shopData = {
            apiSecretKey: shop.storefront_api_token,
            hostName: shop.shopify_url,
            adminApiAccessToken: shop.admin_api_token
        };
        const cartData = (await getCartShopify(cartid, storeId, shopData)).data.cart;
        const newCartItems = cartData.lines.edges.map((edge) => ({
            code_product: edge.node.merchandise.id,
            name: edge.node.merchandise.product.title + " - " + (edge.node.merchandise.title === "Default Title" || edge.node.merchandise.title === "mczr_price_1490" ? "" : edge.node.merchandise.title),
            price: edge.node.attributes.find((attr) => attr.key === '_mczr_price') ? parseFloat(edge.node.attributes.find((attr) => attr.key === '_mczr_price').value) : parseFloat(edge.node.merchandise.price.amount),
            cnt: edge.node.quantity,
            product_img_src: edge.node.attributes.find((attr) => attr.key === '_mczr_image') ? edge.node.attributes.find((attr) => attr.key === '_mczr_image').value : edge.node.merchandise.product.images.edges[0]?.node.url || '/default-image.jpg'
        }));

        let paymentMethodList = [];
        
        if (cartData.lines.edges.some((edge) => edge.node.merchandise.product.handle != "counstructor-odyagu")) {
            paymentMethodList.push("payment_on_delivery");
        }

        paymentMethodList.push("card");

        const requestData = {
            order_ref: cartid + "_" + Date.now(),
            amount: Math.round(parseFloat(cartData.estimatedCost.totalAmount.amount)),
            ccy: 980,
            count: cartData.lines.edges.reduce((acc, edge) => acc + edge.node.quantity, 0),
            products: newCartItems,
            dlv_method_list: [
                "np_brnm",
                "np_box",
            ],
            payment_method_list: paymentMethodList,
            dlv_pay_merchant: null,
            callback_url: "https://platizhka-back.vercel.app/mono/payment",
            return_url: redirectUrl
        }


        const response = await axios.post('https://api.monobank.ua/personal/checkout/order', requestData, {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control' : 'no-cache',
                'X-Token': shop.mono_checkout_token,
            },
        });

        await new Invoice({id: response.data.result.order_id, status: false, storeid: storeId }).save()
        await new GATrackingData({id: response.data.result.order_id, gclid: gclid, clientId: clientId, cartDataGA4: JSON.stringify(cartData)}).save()
        res.json({...response.data.result, cartData: cartData});
    } catch (error) {
        console.error('Shopify request error: ', error);
        res.status(500).json({ error: 'Shopify API error' });
    }
});

router.post('/payment', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Проверяем, что IP-адрес отправителя разрешен 
    if (!allowedIps.includes(clientIp)) {
        console.warn(`Запрос от неразрешенного IP-адреса: ${clientIp} `);
        return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const paymentData = req.body;

    console.log(paymentData);

    try {
        const invoice = await Invoice.findById(paymentData.orderId);
        if (!invoice) {
            return res.status(404).json({ message: 'Invoice not found' });
        }

        const gaTrackingData = await GATrackingData.findById(paymentData.orderId);
        const cartDataGA4 = gaTrackingData.cart_data_ga4 ? gaTrackingData.cart_data_ga4 : null;
        
        // Проверяем и корректируем email если нужно
        const validEmailDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'ukr.net'];
        const email = paymentData.mainClientInfo.email;
        const emailParts = email.split('@');
        
        if (emailParts.length === 2) {
            const domain = emailParts[1].toLowerCase();
            if (!validEmailDomains.includes(domain)) {
                paymentData.mainClientInfo.email = `${emailParts[0]}@gmail.com`;
            }
        }

        if (!paymentData.mainClientInfo.email) {
            paymentData.mainClientInfo.email = 'noemail@gmail.com'
        }
        
        const note = 'Адрес доставки: ' + paymentData.delivery_branch_address + '\n' + 
            (paymentData.mainClientInfo.first_name !== paymentData.deliveryRecipientInfo.first_name || 
             paymentData.mainClientInfo.last_name !== paymentData.deliveryRecipientInfo.last_name ||
             paymentData.mainClientInfo.phoneNumber !== paymentData.deliveryRecipientInfo.phoneNumber ? 
             'Основной клиент: ' + paymentData.mainClientInfo.first_name + ' ' + paymentData.mainClientInfo.last_name + ' ' + paymentData.mainClientInfo.phoneNumber + '\n' : '') +
            'Комментарий: ' + paymentData.comment;

        // Формируем данные для заказа
        const customerData = {
            firstName: paymentData.deliveryRecipientInfo.first_name,
            lastName: paymentData.deliveryRecipientInfo.last_name,
            phone: paymentData.deliveryRecipientInfo.phoneNumber,
            email: paymentData.mainClientInfo.email,
            note: note,
            address: {
                address1: paymentData.delivery_branch_address,
                city: paymentData.deliveryAddressInfo.cityName,
                country: 'Ukraine',
                zip: '00000'
            },
            payment: 'Monopay'
        };

        // Проверка статуса платежа
        if (paymentData.generalStatus === 'success' || paymentData.generalStatus === 'payment_on_delivery') {
            const shop = await Shop.findById(invoice.storeid);
            const shopData = {
                apiSecretKey: shop.storefront_api_token,
                hostName: shop.shopify_url,
                adminApiAccessToken: shop.admin_api_token
            };
            let createOrderResponse;
            if (paymentData.payment_method === 'payment_on_delivery') {
                customerData.payment = 'Накладений платіж'
                createOrderResponse = await createOrder(paymentData.basket_id.split('_')[0], customerData, true, invoice.storeid, shopData)
            } else {
                createOrderResponse = await createOrder(paymentData.basket_id.split('_')[0], customerData, false, invoice.storeid, shopData)
            }

            await invoice.changeStatus();

            // Отправка данных в GA4
            if (cartDataGA4 && cartDataGA4.lines && cartDataGA4.lines.edges && cartDataGA4.lines.edges.length > 0) {
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

                    /* if (gaTrackingData.client_id) {
                        console.log('Sending GA4 Conversion:', {
                            clientId: gaTrackingData.client_id,
                            transactionId: paymentData.orderId,
                            value,
                            items,
                        });

                        await sendGA4Conversion(gaTrackingData.client_id, paymentData.orderId, value, items);
                    } */
                } catch (error) {
                    console.error('Ошибка обработки cartDataGA4 для GA4:', error);
                }
            }

            return res.status(200).json({ message: 'Order created', data: createOrderResponse });
        } else {
            return res.status(400).json({ message: 'Payment declined' });
        }
    } catch (error) {
        console.error('Ошибка при обработке платежа:', error);
        return res.status(500).json({ message: 'Payment processing error', error: error.message });
    }
});

module.exports = router;