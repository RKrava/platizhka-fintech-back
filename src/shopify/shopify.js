const {getStoreFrontClient, getShopifySession, getShopifyApi} = require("../config/shopifyConfig");
const Order = require("../models/Order");
const {shopifyApi} = require("@shopify/shopify-api");
const axios = require("axios");

const getCartShopify = async (cartId, storeId, shopData) => {
    const cartQuery = `
         query getCart($cartId: ID!) {
      cart(id: $cartId) {
        id
        lines(first: 100) {
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
              discountAllocations {
                discountedAmount {
                  amount
                }
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
    const storeFrontClient = await getStoreFrontClient(storeId, shopData)
    return storeFrontClient.request(cartQuery, {
        variables: {
            cartId: 'gid://shopify/Cart/' + cartId,
        },
    });
}

const getCustomersByContact = async (customerData, storeId, shopData) => {
    const shopifyApi = await getShopifyApi(storeId, shopData)
    const client = new shopifyApi.clients.Graphql({session: await getShopifySession(storeId, shopData)});
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

const createCustomer = async (customerData, storeId, shopData) => {
    const shopifyApi = await getShopifyApi(storeId, shopData)
    const client = new shopifyApi.clients.Graphql({session: await getShopifySession(storeId, shopData)});
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

const createDraftOrder = async (customerData, checkoutData, storeId, shopData) => {
    // const customerIdByContact = await getCustomersByContact(customerData, storeId, shopData)
    // const customerId = customerIdByContact ? customerIdByContact : await createCustomer(customerData, storeId, shopData)

    const shopifyApi = await getShopifyApi(storeId, shopData)
    const client = new shopifyApi.clients.Graphql({session: await getShopifySession(storeId, shopData)});
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
            // "customerId": customerId,
            "note": customerData.note,
            "phone": customerData.phone,
            "email": customerData.email,
            customAttributes: [
                { key: "Recipient Name", value: customerData.firstName + ' ' + customerData.lastName },
                { key: "Recipient Phone", value: customerData.phone },
                { key: "Recipient Email", value: customerData.email },
                { key: "Payment", value: customerData.payment },
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

const completeDraftOrder = async (draftOrderId, paymentPending, storeId, shopData) => {
    const shopifyApi = await getShopifyApi(storeId, shopData)
    const client = new shopifyApi.clients.Graphql({session: await getShopifySession(storeId, shopData)});
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

const clearCart = async (cartId, cartLineIdArray, storeId, shopData) => {
    const storeFrontClient = await getStoreFrontClient(storeId, shopData)
    return storeFrontClient.request(`mutation cartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
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

const sendTelegramMessage = async (message, chatId) => {
    try {
        const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        
        if (!BOT_TOKEN || !chatId) {
            console.error('Telegram credentials not configured');
            return;
        }

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        });
    } catch (error) {
        console.error('Error sending telegram message:', error);
    }
};

const createOrder = async (cartId, customerData, pendingPayment, storeId, shopData) => {
    const cart = await getCartShopify(cartId, storeId, shopData)
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

        if (item.node.discountAllocations?.length) {
            let discountAmount = 0

            item.node.discountAllocations.map((discounts) => {
                //TODO: взависимости от типа скидки делить или нет
                discountAmount += Number(discounts.discountedAmount.amount)/item.node.quantity
            })

            lineItem.appliedDiscount = {
                value: discountAmount,
                valueType: "FIXED_AMOUNT"
            }
        }

        return lineItem
    })


    const checkoutData = {
        lineItems,
        totalAmount: cart.data.cart.estimatedCost.totalAmount,
    };

    await new Order({
        firstName: customerData.firstName,
        lastName: customerData.lastName,
        phone: customerData.phone,
        note: customerData.note,
        email: customerData.email,
        address: customerData.address.address1,
        city: customerData.address.city,
        country: customerData.address.country,
        store_id: Number(storeId),
        checkoutData: JSON.stringify(checkoutData)
    }).save()

    const draftOrderData = await createDraftOrder(customerData, checkoutData, storeId, shopData)

    if (draftOrderData.body.data.draftOrderCreate.userErrors.length > 0) {
        console.log(draftOrderData.body.data.draftOrderCreate.userErrors)
        const errorMessage = `❌ Order Creation Error:
Store ID: ${storeId}
Customer: ${customerData.firstName} ${customerData.lastName}
Phone: ${customerData.phone}
Email: ${customerData.email}
Address: ${customerData.address.address1}
City: ${customerData.address.city}
Country: ${customerData.address.country}
checkoutData: ${JSON.stringify(checkoutData)}
note: ${customerData.note}
Errors: ${JSON.stringify(draftOrderData.body.data.draftOrderCreate.userErrors)}`;
        await sendTelegramMessage(errorMessage, '-567427708');
        return { userErrors: draftOrderData.body.data.draftOrderCreate.userErrors }
    }

    const completeOrderData = await completeDraftOrder(draftOrderData.body.data.draftOrderCreate.draftOrder.id,
        pendingPayment, storeId, shopData)
    
    // After order is completed, update the customer's marketing preferences
    if (completeOrderData.body.data.draftOrderComplete.draftOrder.order.id) {
      const orderId = completeOrderData.body.data.draftOrderComplete.draftOrder.order.id.split('/').pop();
      try {
          await axios.get(
              `https://${shopData.hostName}/admin/api/2024-10/orders/${orderId}.json`,
              {
                  headers: {
                      "X-Shopify-Access-Token": shopData.adminApiAccessToken,
                      "Content-Type": "application/json"
                  }
              }
          ).then(async (response) => {
              const order = response.data.order;
              const lineItems = order.line_items;
              const itemNames = lineItems.map(item => item.name || item.title).join(', ');

              if (Number(storeId) === 1) {
                sendTelegramMessage(`Нове замовлення: ${itemNames}`, '-1002431256352');
              }

              const customerId = response.data.order.customer.id;
              if (customerId) {
                  await axios.put(
                      `https://${shopData.hostName}/admin/api/2024-10/customers/${customerId}.json`,
                      {
                          customer: {
                              id: customerId,
                              accepts_marketing: true,
                              accepts_marketing_updated_at: new Date().toISOString(),
                              marketing_opt_in_level: "SINGLE_OPT_IN"
                          }
                      },
                      {
                          headers: {
                              "X-Shopify-Access-Token": shopData.adminApiAccessToken,
                              "Content-Type": "application/json"
                          }
                      }
                  );
              }
          });
      } catch (error) {
          console.error('Error updating customer marketing preferences:', error);
      }
    }

    await clearCart(cartId, cartLineIdArray, storeId, shopData)
  

    return completeOrderData.body.data;
}

const initialConfig = async (shopData) => {
    const shopify = shopifyApi({
        apiSecretKey: shopData.apiSecretKey,
        hostName: shopData.hostName,
        apiVersion: '2024-10',
        isCustomStoreApp: true,
        adminApiAccessToken: shopData.adminApiAccessToken,
        privateAppStorefrontAccessToken: shopData.adminApiAccessToken
    })
    const session = shopify.session.customAppSession(shopData.hostName)
    const client = new shopify.clients.Graphql({session: session})

    const activeThemeQuery = await client.query({
        data: {
            "query": `query {
            themes(first: 100) {
              edges {
                node {
                  name
                  id
                  role
                }
              }
            }
          }`
        }
    });

    const activeTheme = activeThemeQuery.body.data.themes.edges.find(theme => theme.node.role === 'MAIN')

    if (!activeTheme)
    {
        throw new Error("No active theme")
    }

    const script = "!function(){const t={cfg:{dataAttrAppUrl:\"data-url\",dataAttrCheckout:\"procceded\",dataAttrCustomDomain:\"data-checkout-domain\",defaultAppBaseUrl:\"https://platizhka.vercel.app\",domainPath:\"checkout\"},vars:{checkoutDomain:null}," +
        "cartApi:{clearCart:function(){return fetch(\"/cart/clear.js\",{method:\"POST\",credentials:\"same-origin\"})},addToCart:function(t){return fetch(\"/cart/add.js\",{method:\"POST\",credentials:\"same-origin\",body:\"FORM\"===t.nodeName?new FormData(t):t})}}," +
        "helpers:{debounce:function(t,e){let o=!1;return function(){o||(o=!0,setTimeout((()=>{t.apply(this,arguments),o=!1}),e))}},isChild:(t,e)=>{let o=e.parentNode;for(;null!==o;){if(o===t)return!0;o=o.parentNode}return!1},addWrapperListener:(e,o,r)=>" +
        "{e.addEventListener&&window.addEventListener(o,(o=>{(o.target===e||t.helpers.isChild(e,o.target))&&(o.stopImmediatePropagation(),o.preventDefault(),r())}),!0)},getCookie:t=>{let e=document.cookie.match(new RegExp(\"(?:^|; )\"+t." +
        "replace(/([\\.$?*|{}\\(\\)\\[\\]\\\\\\/\\+^])/g,\"\\\\$1\")+\"=([^;]*)\"));return e?decodeURIComponent(e[1]):void 0},setCookie:(t,e)=>{let o=new Date(Date.now()+18e5).toUTCString();document.cookie=`${t}=${e}; expires=`+o+\";path=/;\"}}," +
        "dom:{selectors:{checkoutForm:'form[action^=\"/cart\"]:not([action^=\"/cart/\"]), form[action=\"/checkout\"], form[action=\"/a/checkout\"]',checkoutButton:'[name=\"checkout\"],[name=\"Checkout\"],[class*=\"opcCheckout\"],[c" +
        "lass*=\"checkout-btn\"],[class*=\"btn-checkout\"],[class*=\"checkout-button\"],[class*=\"button-checkout\"],[class*=\"carthook_checkout\"],[type*=\"submit\"][class*=\"action_button\"]:not([name*=\"add\"]),[href*=\"/checkout\"][cl" +
        "ass*=\"action_button\"],[id*=\"checkout\"],[id*=\"Checkout\"],[id*=\"checkout-button\"],[id*=\"checkout-btn\"]',directCheckoutLink:'a[href^=\"/checkout\"],[onclick*=\"/checkout\"],a[href*=\"/checkout\"]',addToCartForm:'form[act" +
        "ion^=\"/cart/add\"]',returnToField:'input[name=\"return_to\"][value*=\"checkout\"]',buyNowForm:'form[action^=\"/cart/add\"][data-skip-cart=\"true\"]',checkoutUpdateButton:'[type=\"submit\"][name=\"update\"]',dynamicPaymentButton:'[da" +
        "ta-shopify=\"payment-button\"] button,[data-shopify=\"payment-button\"] .shopify-payment-button__button',dynamicPaymentButtonContainer:'[data-shopify=\"payment-button\"]'},getCheckoutForms:()=>document.querySelectorAll(t.dom.selectors.che" +
        "ckoutForm),getCheckoutButtons:()=>document.querySelectorAll(t.dom.selectors.checkoutButton),getCheckoutLinks:()=>document.querySelectorAll(t.dom.selectors.directCheckoutLink),getBuyItNowForms:()=>{const e=[...document.querySelectorAll(t.d" +
        "om.selectors.buyNowForm)];return document.querySelectorAll(t.dom.selectors.returnToField).forEach((t=>{const o=t.closest(\"form\");o&&e.filter((t=>o.isSameNode(t))).length<=0&&e.push(o)})),e},getAddToCartForm:()=>document.querySelector(t.dom" +
        ".selectors.addToCartForm),getDynamicPaymentButtons:()=>document.querySelectorAll(t.dom.selectors.dynamicPaymentButton),getUpdateCartButtons:()=>document.querySelectorAll(t.dom.selectors.checkoutUpdateButton),getDynamicPaymentButtonContai" +
        "ner:()=>document.querySelector(t.dom.selectors.dynamicPaymentButtonContainer)},functions:{getAppBaseUrl:()=>{const e=document.querySelector(\"[\"+t.cfg.dataAttrAppUrl+\"]\"),o=e.getAttribute(t.cfg.dataAttrCustomDomain),r=e.getAttribute(t.cf" +
        "g.dataAttrAppUrl),n=t.cfg.defaultAppBaseUrl;return o||(r||n)},getOriginUrl:()=>window.location.origin,getCartToken:()=>t.helpers.getCookie(\"cart\"),getStoreName:()=>window.Shopify&&window.Shopify.shop?window.Shopify.shop:\"\",getStoreActieCurr" +
        "ency:()=>window.Shopify.currency.active,getStoreCountry:()=>window.Shopify.country,getStoreActiveCurrencyRate:()=>window.Shopify.currency.rate,getStoreRootRoute:()=>window.Shopify.routes.root,submitBuyNowForm:e=>{let o=e.closest(\"form\");if(o||(o=t.dom.get" +
        "AddToCartForm()),o){if(!o.querySelector('[name=\"quantity\"]')){const t=document.createElement(\"input\");t.setAttribute(\"type\",\"hidden\"),t.setAttribute(\"name\",\"quantity\"),t.setAttribute(\"value\",\"1\"),o.appendChild(t)}if(!o.querySel" +
        "ector('input[name=\"return_to\"]')){const t=document.createElement(\"input\");t.setAttribute(\"type\",\"hidden\"),t.setAttribute(\"name\",\"return_to\"),t.setAttribute(\"value\",\"/checkout\"),o.appendChild(t)}t.cartApi.clearCart().then((()=>t.cart" +
        "Api.addToCart(o))).then((()=>t.functions.processCheckout()))}},processCheckout:()=>{if(!t.vars.isCheckoutProcessing){t.vars.isCheckoutProcessing=!0;const e=t.functions.getAppBaseUrl(),o=t.functions.getCartToken(),r=t.functions.getOriginUrl().repl" +
        "ace(/^https?:\\/\\//,\"\"),n=t.functions.getStoreRootRoute(),c=t.functions.getStoreName(),a=t.functions.getStoreActiveCurrencyRate(),u=t.helpers.getCookie(\"_shopify_sa_p\");let i=new URLSearchParams(window.location.search),s=i.get(\"utm_cam" +
        "paign\"),d=i.get(\"utm_medium\"),m=i.get(\"utm_source\"),l=i.get(\"utm_content\"),h=i.get(\"utm_term\");const p=`${s?`&utm_campaign=${s}`:\"\"}${d?`&utm_medium=${d}`:\"\"}${m?`&utm_source=${m}`:\"\"}${l?`&utm_content=${l}`:\"\"}${h?`&utm_ter" +
        "m=${h}`:\"\"}`;if(e&&o&&r){let t=!1;const i=`${e}/checkout/?storeName=${r}&cartToken=${o}&curRate=${a}&shopifyDomain=${c}${n.length>2?\"&subFolder=\"+n.replace(/\\//g,\"\"):\"\"}`;window.ga&&ga((e=>{var o=e.get(\"linkerParam\");window.locat" +
        "ion=`${i}&${o}${u?`&${u}`:p?`${p}`:\"\"}`,t=!0})),t||(window.location=`${i}${u?`&${u}`:p?`${p}`:\"\"}`)}else window.location=\"/checkout\"}},addHandlers:()=>{const e=t.dom.getCheckoutForms(),o=t.dom.getCheckoutLinks(),r=t.dom.getCheckoutButt" +
        "ons(),n=t.dom.getBuyItNowForms(),c=t.dom.getUpdateCartButtons();[...e].forEach((e=>{\"true\"!==e.getAttribute(t.cfg.dataAttrCheckout)&&(t.helpers.addWrapperListener(e,\"submit\",(()=>{t.functions.processCheckout()})),e.setAttribute(t.cfg.dat" +
        "aAttrCheckout,\"true\"))})),[...o,...r].forEach((e=>{\"true\"!==e.getAttribute(t.cfg.dataAttrCheckout)&&(t.helpers.addWrapperListener(e,\"mousedown\",(()=>{t.functions.processCheckout()})),t.helpers.addWrapperListener(e,\"touchstart\",(()=>{t.fun" +
        "ctions.processCheckout()})),t.helpers.addWrapperListener(e,\"click\",(()=>{t.functions.processCheckout()})),e.setAttribute(t.cfg.dataAttrCheckout,\"true\"))})),[...n].forEach((e=>{\"true\"!==e.getAttribute(t.cfg.dataAttrCheckout)&&(t.helpers.add" +
        "WrapperListener(e,\"submit\",(()=>{t.functions.submitBuyNowForm(e)})),e.setAttribute(t.cfg.dataAttrCheckout,\"true\"))})),[...c].forEach((e=>{\"true\"!==e.getAttribute(t.cfg.dataAttrCheckout)&&(t.helpers.addWrapperListener(e,\"click\",(()=>{e.c" +
        "losest(\"form\").submit()})),e.setAttribute(t.cfg.dataAttrCheckout,\"true\"))}))},addDynamicButtonHandlers:()=>{[...t.dom.getDynamicPaymentButtons()].forEach((e=>{t.helpers.addWrapperListener(e,\"click\",(()=>{t.functions.submitBuyNowFor" +
        "m(e)}))}))},init:()=>{\"UA\"===t.functions.getStoreCountry()&&(t.functions.addDynamicButtonHandlers(),t.functions.addHandlers(),document.addEventListener(\"DOMContentLoaded\",(()=>{t.functions.addDynamicButtonHandlers(),t.functions.addHand" +
        "lers()})),window.addEventListener(\"load\",(()=>{t.functions.addDynamicButtonHandlers(),t.functions.addHandlers();const e=t.helpers.debounce((()=>{t.functions.addHandlers(),t.functions.addDynamicButtonHandlers()}),100);new MutationObserve" +
        "r((()=>{e()})).observe(window.document,{attributes:!0,childList:!0,subtree:!0})})))}}};t.functions.init()}();"

    const themeId = activeTheme.node.id;
    await client.query({
        data: {
            "query": `mutation themeFilesUpsert($files: [OnlineStoreThemeFilesUpsertFileInput!]!, $themeId: ID!) {
                themeFilesUpsert(files: $files, themeId: $themeId) {
                  upsertedThemeFiles {
                    filename
                  }
                  userErrors {
                    field
                    message
                  }
                }
            }`,
            "variables": {
                "themeId": themeId,
                "files": [
                    {
                        "filename": "assets/platizhka.js",
                        "body": {
                            "type": "TEXT",
                            "value": script
                        }
                    }
                ]
            },
        },
    });

    const assetResponse = await axios.get(
        `https://${shopData.hostName}/admin/api/2024-10/themes/${themeId.split('/').pop()}/assets.json`,
        {
            headers: {
                "X-Shopify-Access-Token": shopData.adminApiAccessToken,
                "Content-Type": "application/json"
            },
            params: {
                "asset[key]": "layout/theme.liquid" // Ключ для конкретного файлу
            }
        }
    );

    const themeLiquidContent = assetResponse.data.asset.value; // Отримуємо вміст файлу

    const updatedThemeLiquidContent = `<script data-url="https://platizhka.vercel.app" src="{{ 'platizhka.js' | asset_url }}" async></script>\n${themeLiquidContent}`;

    await client.query({
        data: {
            "query": `mutation themeFilesUpsert($files: [OnlineStoreThemeFilesUpsertFileInput!]!, $themeId: ID!) {
                themeFilesUpsert(files: $files, themeId: $themeId) {
                  upsertedThemeFiles {
                    filename
                  }
                  userErrors {
                    field
                    message
                  }
                }
              }`,
            "variables": {
                "themeId": themeId,
                "files": [
                    {
                        "filename": "layout/theme.liquid",
                        "body": {
                            "type": "TEXT",
                            "value": updatedThemeLiquidContent,
                        },
                    },
                ],
            },
        },
    });
}

const getOrderNumber = async (orderId, storeId, shopData) => {
    try {
        console.log('[getOrderNumber] Начало выполнения:', { orderId, storeId });
        
        // Проверяем, является ли orderId числовым ID или GID
        // Если это строка вида "order-xxx" или просто число без префикса, обрабатываем по-другому
        let formattedOrderId = orderId;
        
        // Если это не GID формат, пытаемся извлечь числовой ID
        if (!orderId.startsWith('gid://shopify/Order/')) {
            // Если это просто число, добавляем префикс GID
            if (/^\d+$/.test(orderId)) {
                formattedOrderId = `gid://shopify/Order/${orderId}`;
                console.log('[getOrderNumber] Преобразован числовой ID в GID:', formattedOrderId);
            } else {
                // Если это не числовой ID, возможно это номер заказа (name) - ищем через REST API
                console.log('[getOrderNumber] Похоже на номер заказа, используем REST API для поиска');
                try {
                    // Убираем # если есть
                    const orderName = orderId.replace('#', '');
                    const restResponse = await axios.get(
                        `https://${shopData.hostName}/admin/api/2024-10/orders.json?name=${orderName}&limit=1`,
                        {
                            headers: {
                                "X-Shopify-Access-Token": shopData.adminApiAccessToken,
                                "Content-Type": "application/json"
                            }
                        }
                    );
                    
                    if (restResponse.data.orders && restResponse.data.orders.length > 0) {
                        const order = restResponse.data.orders[0];
                        console.log('[getOrderNumber] Заказ найден через REST API:', order.name);
                        return order.name;
                    } else {
                        throw new Error(`Заказ с номером ${orderName} не найден`);
                    }
                } catch (restError) {
                    console.error('[getOrderNumber] Ошибка при поиске через REST API:', restError.message);
                    throw new Error(`Не удалось найти заказ. Проверьте формат orderId. Ожидается числовой ID (например: 123456789) или GID (gid://shopify/Order/123456789), получено: ${orderId}`);
                }
            }
        }
        
        const shopifyApi = await getShopifyApi(storeId, shopData)
        const client = new shopifyApi.clients.Graphql({session: await getShopifySession(storeId, shopData)});
        
        const query = `query GetOrderNumber($orderId: ID!) {
            order(id: $orderId) {
                id
                name
            }
        }`;
        
        console.log('[getOrderNumber] Выполнение GraphQL запроса:', { formattedOrderId });
        
        const response = await client.query({
            data: {
                query,
                variables: {
                    orderId: formattedOrderId
                }
            }
        });
        
        console.log('[getOrderNumber] Получен ответ:', {
            hasBody: !!response.body,
            hasData: !!response.body?.data,
            hasOrder: !!response.body?.data?.order,
            responseKeys: Object.keys(response || {}),
            bodyKeys: response.body ? Object.keys(response.body) : null
        });
        
        if (!response || !response.body) {
            console.error('[getOrderNumber] Ответ не содержит body:', response);
            throw new Error('Invalid response structure: missing body');
        }
        
        if (!response.body.data) {
            console.error('[getOrderNumber] Ответ не содержит data:', response.body);
            throw new Error('Invalid response structure: missing data');
        }
        
        if (!response.body.data.order) {
            console.error('[getOrderNumber] Заказ не найден или ошибка в запросе:', response.body.data);
            throw new Error(`Заказ с ID ${formattedOrderId} не найден. Проверьте правильность ID заказа.`);
        }
        
        const orderName = response.body.data.order.name;
        console.log('[getOrderNumber] Номер заказа получен:', orderName);
        
        return orderName;
    } catch (error) {
        console.error('[getOrderNumber] Ошибка при получении номера заказа:', {
            message: error.message,
            stack: error.stack,
            orderId,
            storeId,
            errorResponse: error.response ? {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            } : null
        });
        throw error; // Пробрасываем ошибку дальше, чтобы её можно было обработать в роуте
    }
}

module.exports = { getCartShopify, createOrder, initialConfig, sendTelegramMessage, getOrderNumber };