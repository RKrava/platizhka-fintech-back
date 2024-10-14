require('@shopify/shopify-api/adapters/node');
const {shopifyApi, LATEST_API_VERSION} = require("@shopify/shopify-api");
require('dotenv').config();
//
// const shopifyFutboss = shopifyApi({
//     apiSecretKey: process.env.FUTBOSS_SHOPIFY_API_SECRET,
//     hostName: process.env.FUTBOSS_SHOPIFY_HOST_NAME,
//     apiVersion: LATEST_API_VERSION,
//     isCustomStoreApp: true,
//     adminApiAccessToken: process.env.FUTBOSS_ADMIN_API_ACCESS_TOKEN,
//     privateAppStorefrontAccessToken: process.env.FUTBOSS_ADMIN_API_ACCESS_TOKEN
// });
//
// const sessionFutboss = shopifyFutboss.session.customAppSession(process.env.FUTBOSS_SHOPIFY_HOST_NAME);
//
// const storefrontClientFutboss = new shopifyFutboss.clients.Storefront({
//     session: sessionFutboss
// });
//
// const shopifyBrick = shopifyApi({
//     apiSecretKey: process.env.BRICK_SHOPIFY_API_SECRET,
//     hostName: process.env.BRICK_SHOPIFY_HOST_NAME,
//     apiVersion: LATEST_API_VERSION,
//     isCustomStoreApp: true,
//     adminApiAccessToken: process.env.BRICK_ADMIN_API_ACCESS_TOKEN,
//     privateAppStorefrontAccessToken: process.env.BRICK_ADMIN_API_ACCESS_TOKEN
// });
//
// const sessionBrick = shopifyBrick.session.customAppSession(process.env.BRICK_SHOPIFY_HOST_NAME);
//
// const storefrontClientBrick = new shopifyBrick.clients.Storefront({
//     session: sessionBrick
// });
//
// const shopifyUfighters = shopifyApi({
//     apiSecretKey: process.env.UFIGHTERS_SHOPIFY_API_SECRET,
//     hostName: process.env.UFIGHTERS_SHOPIFY_HOST_NAME,
//     apiVersion: LATEST_API_VERSION,
//     isCustomStoreApp: true,
//     adminApiAccessToken: process.env.UFIGHTERS_ADMIN_API_ACCESS_TOKEN,
//     privateAppStorefrontAccessToken: process.env.UFIGHTERS_ADMIN_API_ACCESS_TOKEN
// });
//
// const sessionUfighters = shopifyUfighters.session.customAppSession(process.env.UFIGHTERS_SHOPIFY_HOST_NAME);
//
// const storefrontClientUfighters = new shopifyUfighters.clients.Storefront({
//     session: sessionUfighters
// });
//
// const getStoreFrontClient = (storeId) => {
//     switch (Number.parseInt(storeId)) {
//         case 0: return storefrontClientFutboss
//         case 1: return storefrontClientBrick
//         case 2: return storefrontClientUfighters
//         default: return undefined;
//     }
// }
//
// const getShopifyApi = (storeId) => {
//     switch (Number.parseInt(storeId)) {
//         case 0: return shopifyFutboss
//         case 1: return shopifyBrick
//         case 2: return shopifyUfighters
//         default: return undefined;
//     }
// }
//
// const getShopifySession = (storeId) => {
//     switch (Number.parseInt(storeId)) {
//         case 0: return sessionFutboss
//         case 1: return sessionBrick
//         case 2: return sessionUfighters
//         default: return undefined;
//     }
// }

const shopifyCache = {
    shopifyApis: {},
    sessions: {},
    storefrontClients: {}
};

const getShopifyApi = async (storeId, shopData) => {
    if (!shopifyCache.shopifyApis[storeId]) {
        shopifyCache.shopifyApis[storeId] = shopifyApi({
            apiSecretKey: shopData.apiSecretKey,
            hostName: shopData.hostName,
            apiVersion: LATEST_API_VERSION,
            isCustomStoreApp: true,
            adminApiAccessToken: shopData.adminApiAccessToken,
            privateAppStorefrontAccessToken: shopData.adminApiAccessToken
        });
    }
    return shopifyCache.shopifyApis[storeId];
};

const getShopifySession = async (storeId, shopData) => {
    if (!shopifyCache.sessions[storeId]) {
        const shopify = await getShopifyApi(storeId, shopData);
        shopifyCache.sessions[storeId] = shopify.session.customAppSession(shopData.hostName);
    }
    return shopifyCache.sessions[storeId];
};

const getStoreFrontClient = async (storeId, shopData) => {
    if (!shopifyCache.storefrontClients[storeId]) {
        const session = await getShopifySession(storeId, shopData);
        const shopify = await getShopifyApi(storeId, shopData);
        shopifyCache.storefrontClients[storeId] = new shopify.clients.Storefront({ session });
    }
    return shopifyCache.storefrontClients[storeId];
};



module.exports = {getStoreFrontClient, getShopifyApi, getShopifySession };