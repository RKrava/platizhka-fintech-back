require('@shopify/shopify-api/adapters/node');
const { createStorefrontApiClient } = require('@shopify/storefront-api-client');
const { shopifyApi, LATEST_API_VERSION, DataType} = require('@shopify/shopify-api');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');
const http = require('http');

dotenv.config();

let invoicesData = []

const allowedIps = [
    '35.158.201.27',
    '52.58.160.42',
    '35.158.31.50',
    '35.158.251.173'
];

const shopifyFutboss = shopifyApi({
    apiSecretKey: process.env.FUTBOSS_SHOPIFY_API_SECRET,
    hostName: process.env.FUTBOSS_SHOPIFY_HOST_NAME,
    apiVersion: LATEST_API_VERSION,
    isCustomStoreApp: true,
    adminApiAccessToken: process.env.FUTBOSS_ADMIN_API_ACCESS_TOKEN,
    privateAppStorefrontAccessToken: process.env.FUTBOSS_ADMIN_API_ACCESS_TOKEN
});

const sessionFutboss = shopifyFutboss.session.customAppSession(process.env.FUTBOSS_SHOPIFY_HOST_NAME);

const storefrontClientFutboss = new shopifyFutboss.clients.Storefront({
    session: sessionFutboss
});

const shopifyBrick = shopifyApi({
    apiSecretKey: process.env.BRICK_SHOPIFY_API_SECRET,
    hostName: process.env.BRICK_SHOPIFY_HOST_NAME,
    apiVersion: LATEST_API_VERSION,
    isCustomStoreApp: true,
    adminApiAccessToken: process.env.BRICK_ADMIN_API_ACCESS_TOKEN,
    privateAppStorefrontAccessToken: process.env.BRICK_ADMIN_API_ACCESS_TOKEN
});

const sessionBrick = shopifyBrick.session.customAppSession(process.env.BRICK_SHOPIFY_HOST_NAME);

const storefrontClientBrick = new shopifyBrick.clients.Storefront({
    session: sessionBrick
});

const shopifyUfighters = shopifyApi({
    apiSecretKey: process.env.BRICK_SHOPIFY_API_SECRET,
    hostName: process.env.BRICK_SHOPIFY_HOST_NAME,
    apiVersion: LATEST_API_VERSION,
    isCustomStoreApp: true,
    adminApiAccessToken: process.env.BRICK_ADMIN_API_ACCESS_TOKEN,
    privateAppStorefrontAccessToken: process.env.BRICK_ADMIN_API_ACCESS_TOKEN
});

const sessionUfighters = shopifyUfighters.session.customAppSession(process.env.BRICK_SHOPIFY_HOST_NAME);

const storefrontClientUfighters = new shopifyUfighters.clients.Storefront({
    session: sessionUfighters
});

const getStoreFrontClient = (storeId) => {
    switch (Number.parseInt(storeId)) {
        case 0: return storefrontClientFutboss
        case 1: return storefrontClientBrick
        case 2: return storefrontClientUfighters
        default: return undefined;
    }
}

const getShopifyApi = (storeId) => {
    switch (Number.parseInt(storeId)) {
        case 0: return shopifyFutboss
        case 1: return shopifyBrick
        case 2: return shopifyUfighters
        default: return undefined;
    }
}

const getShopifySession = (storeId) => {
    switch (Number.parseInt(storeId)) {
        case 0: return sessionFutboss
        case 1: return sessionBrick
        case 2: return sessionUfighters
        default: return undefined;
    }
}

const getCartShopify = async (cartId, storeId) => {
    const cartQuery = `
         query getCart($cartId: ID!) {
      cart(id: $cartId) {
        id
        lines(first: 10) {
          edges {
            node {
              id
              quantity
              merchandise {
                ... on ProductVariant {
                  id
                  title
                  sku
                  availableForSale
                  price {
                    amount
                    currencyCode
                  }
                  product {
                    id
                    title
                    description
                    vendor
                    handle
                    images(first: 5) {
                      edges {
                        node {
                          url
                          altText
                        }
                      }
                    }
                  }
                }
              }
              attributes {
                key
                value
              }
            }
          }
        }
        estimatedCost {
          totalAmount {
            amount
            currencyCode
          }
        }
      }
    }
        `;
    return await getStoreFrontClient(storeId).request(cartQuery, {
        variables: {
            cartId: 'gid://shopify/Cart/' + cartId,
        },
    });
}

const getCustomersByContact = async (customerData, storeId) => {
    const shopifyApi = getShopifyApi(storeId)
    const client = new shopifyApi.clients.Graphql({session: getShopifySession(storeId)});
    const data = await client.query({
        data: `query {
            customers(first: 1, query: "email:${customerData.email} OR phone:${customerData.phone}") {
              edges {
                node {
                  id
                }
              }
            }
          }`
    });

    if (data.body.data.customers.edges.length > 0) {
        return data.body.data.customers.edges[0].node.id
    }
    return undefined
}

const createCustomer = async (customerData, storeId) => {
    const shopifyApi = getShopifyApi(storeId)
    const client = new shopifyApi.clients.Graphql({session: getShopifySession(storeId)});
    const response = await client.query({
        data: {
            "query": `mutation customerCreate($input: CustomerInput!) {
      customerCreate(input: $input) {
        userErrors {
          field
          message
        }
        customer {
          id
          email
          phone
          taxExempt
          firstName
          lastName
          addresses {
            address1
            city
            country
            phone
            zip
          }
        }
      }
    }`,
            "variables": {
                "input": {
                    "email": customerData.email,
                    "phone": customerData.phone,
                    "firstName": customerData.firstName,
                    "lastName": customerData.lastName,
                    "addresses": [
                        customerData.address
                    ]
                }
            },
        },
    });

    return response.body.data.customerCreate.customer.id
}

const createDraftOrder = async (customerData, checkoutData, storeId) => {
    const customerIdByContact = await getCustomersByContact(customerData, storeId)
    const customerId = customerIdByContact ? customerIdByContact : await createCustomer(customerData, storeId)

    const shopifyApi = getShopifyApi(storeId)
    const client = new shopifyApi.clients.Graphql({session: getShopifySession(storeId)});
    const query = `mutation draftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder {
          id
        }
        userErrors {
          message
          field
        }
      }
    }`

    const variables = {
                "input": {
                    "customerId": customerId,
                    "note": customerData.note,
                    "phone": customerData.phone,
                    "email": customerData.email,
                    customAttributes: [
                        { key: "Recipient Name", value: customerData.firstName + ' ' + customerData.lastName },
                        { key: "Recipient Phone", value: customerData.phone },
                        { key: "Recipient Email", value: customerData.email },
                        { key: "Payment", value: "Накладений платіж" },
                        { key: "Comment", value: customerData.note },
                    ],
                    "taxExempt": true,
                    "tags": [
                        "Auto created",
                    ],
                    "shippingAddress": customerData.address,
                    // "billingAddress": {
                    //     "address1": "456 Main St",
                    //     "city": "Toronto",
                    //     "province": "Ontario",
                    //     "country": "Canada",
                    //     "zip": "Z9Z 9Z9"
                    // },
                    "lineItems": checkoutData.lineItems,
                }
    }
    return await client.query({
        data: {
            query, variables
        }
    })
};

const completeDraftOrder = async (draftOrderId, paymentPending, storeId) => {
    const shopifyApi = getShopifyApi(storeId)
    const client = new shopifyApi.clients.Graphql({session: getShopifySession(storeId)});
    return await client.query({
        data: {
            "query": `mutation draftOrderComplete($id: ID!, $paymentPending: Boolean) {
              draftOrderComplete(id: $id, paymentPending: $paymentPending) {
                draftOrder {
                  id
                  order {
                    id
                  }
                }
              }
            }`,
            "variables": {
                "id": draftOrderId,
                "paymentPending": paymentPending
            },
        },
    });

}

const clearCart = async (cartId, cartLineIdArray, storeId) => {
    return await getStoreFrontClient(storeId).request(`mutation cartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
              cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
                userErrors {
                  field
                  message
                }
              }
            }`,
        {
            variables: {
                cartId: 'gid://shopify/Cart/' + cartId,
                "lineIds": cartLineIdArray
            },
        }
    );

}

const createOrder = async (cartId, customerData, pendingPayment, storeId) => {
    const cart = await getCartShopify(cartId, storeId)
    const cartLineIdArray = []
    const lineItems = cart.data.cart.lines.edges.map((item) => {
        cartLineIdArray.push(item.node.id)
        const lineItem = {
            variantId: item.node.merchandise.id,
            quantity: item.node.quantity,
        }
        if (item.node.attributes?.length) {
            lineItem.customAttributes = item.node.attributes
        }

        return lineItem
    })
    const checkoutData = {
        lineItems,
        totalAmount: cart.data.cart.estimatedCost.totalAmount,
    };

    const draftOrderData = await createDraftOrder(customerData, checkoutData, storeId)

    if (draftOrderData.body.data.draftOrderCreate.userErrors.length > 0) {
        console.log(draftOrderData.body.data.draftOrderCreate.userErrors)
    }

    const completeOrderData = await completeDraftOrder(draftOrderData.body.data.draftOrderCreate.draftOrder.id, pendingPayment, storeId)
    await clearCart(cartId, cartLineIdArray, storeId)

    return completeOrderData.body.data;
}

const app = express();

// Создаем HTTP сервер
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

app.use(function (req, res, next) {

    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', true);

    // Pass to next layer of middleware
    next();
});

app.get('/', (request, response) => {
    response.json({ info: 'Platizhka API' })
})

// Пример эндпоинта для выполнения GraphQL запроса
app.get('/getCart', async (req, res) => {
    try {
        res.json(await getCartShopify(req.query.cartid, req.query.storeId));
    } catch (error) {
        console.error('Shopify request error:', error);
        res.status(500).json({ error: 'Shopify API error' });
    }
});

app.post('/createOrder', async (req, res) => {
    try {
        const customerData = req.body.customerData
        const cartId = req.body.cartId
        const storeId = req.body.storeId
        res.json(await createOrder(cartId, customerData, true, storeId))
    } catch (error) {
        console.error('Shopify request error:', error);
        res.status(500).json({ error: error.toString() });
    }
})

app.post('/api/payment', async (req, res) => {
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
        city:formData.city,
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
        webHookUrl: `https://platizhka-back.vercel.app/api/payment/mono`, // Webhook URL
        validity: 3600, // Время действия инвойса
        paymentType: "debit",
    };

    try {
        const response = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', invoiceData, {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control' : 'no-cache',
                'X-Token': Number.parseInt(storeId) === 0 ? process.env.FUTBOSS_MONOBANK_TOKEN : process.env.BRICK_MONOBANK_TOKEN, // Токен Monobank
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

app.post('/api/payment/mono', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Проверяем, что IP-адрес отправителя разрешен
    if (!allowedIps.includes(clientIp)) {
        console.warn(`Запрос от неразрешенного IP-адреса: ${clientIp}`);
        return res.status(403).json({ message: 'Доступ запрещен' });
    }

    const paymentData = req.body;

    // console.log('Получены данные о платеже:', paymentData);

    // Расшифровка reference
    const decodedReference = JSON.parse(Buffer.from(paymentData.reference, 'base64').toString('utf-8'));
    console.log('Расшифрованные данные reference:', decodedReference);

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
        }
    }

    // Проверка статуса платежа
    if (paymentData.status === 'success') {
        try {
            const storeId = invoicesData.find((item) => item.invoiceId === paymentData.invoiceId)?.storeId
            const createOrderResponse = await createOrder(
                decodedReference.cartToken,
                customerData,
                false,
                storeId
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

// Пример эндпоинта для выполнения GraphQL запроса
app.get('/api/payment/status', async (req, res) => {
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

server.listen(process.env.PORT || 3000, () => {

});
