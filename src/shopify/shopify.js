const {getStoreFrontClient, getShopifySession, getShopifyApi} = require("../config/shopifyConfig");
const Order = require("../models/Order");

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
        store_id: Number(storeId)
    }).save()

    const draftOrderData = await createDraftOrder(customerData, checkoutData, storeId, shopData)

    if (draftOrderData.body.data.draftOrderCreate.userErrors.length > 0) {
        console.log(draftOrderData.body.data.draftOrderCreate.userErrors)
    }

    const completeOrderData = await completeDraftOrder(draftOrderData.body.data.draftOrderCreate.draftOrder.id,
        pendingPayment, storeId, shopData)
    await clearCart(cartId, cartLineIdArray, storeId, shopData)

    return completeOrderData.body.data;
}

module.exports = { getCartShopify, createOrder };