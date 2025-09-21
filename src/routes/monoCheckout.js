const express = require('express');
const axios = require("axios");
const {getCartShopify, createOrder, getOrderNumber} = require("../shopify/shopify");
const Shop = require("../models/Shop");
const Invoice = require("../models/Invoice");
const { sendGA4Conversion } = require('../services/ga4');
const GATrackingData = require("../models/GATrackingData");
const InvoiceConnector = require('../models/InvoiceConnector');
const { sendTelegramMessage } = require('../shopify/shopify'); // Добавляем импорт
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


        // Создать новый коннектор
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
        
        // Получаем значения из коннектора
        console.log('Созданный коннектор:');
        console.log('ID:', connector.id);
        

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
            return_url: redirectUrl + "?connector_id=" + connector.id.toString()
        }


        const response = await axios.post('https://api.monobank.ua/personal/checkout/order', requestData, {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control' : 'no-cache',
                'X-Token': shop.mono_checkout_token,
            },
        });

        await new Invoice({id: response.data.result.order_id, status: false, storeid: storeId }).save()

        await connector.addMonoId(response.data.result.order_id);  //связываем внутренний UUID с UUID от Monobank
        await new GATrackingData({id: response.data.result.order_id, gclid: gclid, clientId: clientId, cartDataGA4: JSON.stringify(cartData)}).save()
        res.json({...response.data.result, cartData: cartData});
    } catch (error) {
        const errorMessage = `❌ Mono Checkout Error:
Store ID: ${req.query.storeId || 'N/A'}
Cart ID: ${req.query.cartid || 'N/A'}
Amount: N/A
Products: N/A
Error: ${error.message}`;
        await sendTelegramMessage(errorMessage, '567427708');
        console.error('Shopify request error: ', error);
        res.status(500).json({ error: 'Shopify API error' });
    }
});

router.post('/payment', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Проверяем, что IP-адрес отправителя разрешен 
    if (!allowedIps.includes(clientIp)) {
        console.warn(`Запрос от неразрешенного IP-адреса: ${clientIp} `);
        const errorMessage = `⚠️ Unauthorized IP Access Attempt:
IP: ${clientIp}`;
        await sendTelegramMessage(errorMessage, '567427708');
        return res.status(403).json({ message: 'Доступ запрещен ' });
    }

    const paymentData = req.body;

    console.log(paymentData);

    try {
        const invoice = await Invoice.findById(paymentData.orderId);
        if (!invoice) {
            await sendTelegramMessage(`❌ Invoice not found: ${paymentData.orderId}`, '567427708');
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
            'Перезвонить клиенту: ' + (paymentData.clientCallback ? 'нужно' : 'не нужно') + '\n' +
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

            const byMono = await InvoiceConnector.findByMonoId(paymentData.orderId);
            const orderId_last = createOrderResponse?.draftOrderComplete?.draftOrder?.order?.id?.split('/').pop() || '0';
            const orderId = await getOrderNumber("gid://shopify/Order/" + orderId_last, invoice.storeid, shopData);
            await byMono.addShopifyOrderId(orderId.replace('#', ''));
            
            
            console.log('Create Order Response:', JSON.stringify(createOrderResponse, null, 2));
            
            try {
                const orderMessage = `✅ Новый заказ создан:
ID заказа: ${createOrderResponse?.draftOrderComplete?.draftOrder?.order?.id || 'N/A'}
Статус: ${paymentData.generalStatus}
Сумма: ${Math.round(cartDataGA4?.estimatedCost?.totalAmount?.amount || 0)}
Способ оплаты: ${customerData.payment}

Полный ответ:
${JSON.stringify(createOrderResponse, null, 2)}`;

                await sendTelegramMessage(orderMessage, '567427708');
            } catch (error) {
                console.error('Ошибка при отправке уведомления в Telegram:', error);
            }


            await invoice.changeStatus();

            // Отправка данных в GA4
            if (cartDataGA4 && cartDataGA4.lines && cartDataGA4.lines.edges && cartDataGA4.lines.edges.length > 0) {
                try {
                    const items = [];
                    const value = Math.round(cartDataGA4.estimatedCost.totalAmount.amount);

                    let hasConstructor = false
                    
                    cartDataGA4.lines.edges.forEach((edge) => {
                        const product = edge.node.merchandise.product;
                        const variant = edge.node.merchandise;

                        const productId = product.id.split('/').pop();
                        const variantId = variant.id.split('/').pop();
                        const customId = `shopify_UA_${productId}_${variantId}`;

                        if (product.handle === 'counstructor-odyagu') {
                            hasConstructor = true
                          }

                        items.push({
                            item_id: customId,
                            item_name: product.title,
                            quantity: edge.node.quantity,
                            price: parseFloat(variant.price.amount),
                        });
                    });

                    if (gaTrackingData.client_id) {
                        console.log('Sending GA4 Conversion: ', {
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
        } else {
            const errorMessage = `❌ Payment declined:
Store ID: ${invoice?.storeid || 'N/A'}
Payment Status: ${paymentData?.generalStatus || 'Unknown'}
Payment Code: ${paymentData?.statusCode || 'N/A'} 
Payment Description: ${paymentData?.statusMessage || 'No description'}
Payment Reference: ${paymentData?.reference || 'N/A'}
Cart ID: ${paymentData.basket_id}
Error: ${paymentData.generalStatus}`;
            await sendTelegramMessage(errorMessage, '567427708');
            return res.status(400).json({ message: 'Payment declined' });
        }
    } catch (error) {
        const errorMessage = `❌ Server payment error:
Store ID: ${req.body?.orderId ? 'N/A' : 'N/A'}
Cart ID: ${paymentData?.basket_id || 'N/A'} 
Amount: ${cartDataGA4?.estimatedCost?.totalAmount?.amount ? Math.round(parseFloat(cartDataGA4.estimatedCost.totalAmount.amount)) : 'N/A'}
Products: ${cartDataGA4?.lines?.edges ? JSON.stringify(cartDataGA4.lines.edges) : 'N/A'}
Error: ${error?.message || 'Неизвестная ошибка'}`;
        await sendTelegramMessage(errorMessage, '567427708');
        console.error('Ошибка при обработке платежа:', error);
        return res.status(500).json({ message: 'Payment processing error', error: error.message });
    }
});

// Эндпоинт для получения данных коннектора по ID
router.get('/connector/status', async (req, res) => {
    const { connectorId } = req.query;
    try {
        const connectorData = await InvoiceConnector.getConnectorData(connectorId);
        if (!connectorData) {
            res.json({ 
                found: false,
                message: 'Connector not found' 
            });
            return;
        }

        res.json({
            found: true,
            connector_id: connectorData.id,
            mono_id: connectorData.mono_id,
            order_shopify_id: connectorData.order_shopify_id
        });

    } catch (error) {
        console.error('Connector status error: ', error);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;