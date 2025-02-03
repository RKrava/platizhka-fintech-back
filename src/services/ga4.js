const axios = require('axios');

async function sendGA4Conversion(client_id, transactionId, value, items, gclid) {
    const payload = {
        client_id, // то же самое, что client_id: client_id
        user_properties: {
          // Передаём gclid в user_properties (важно для атрибуции Google Ads)
          gclid: { value: gclid },
        },
        events: [
          {
            name: 'purchase',
            params: {
              transaction_id: transactionId,
              value: value,
              currency: "UAH",
              items: items,

            },
          },
        ],
      };


    try {
        const response = await axios.post(
            'https://www.google-analytics.com/mp/collect?measurement_id=G-0N0XKJ9EFB&api_secret=QwhNuKsYTeCWvH7lXR9ISA',
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );
        console.log('GA4 Conversion Sent: ', response.status);
    } catch (error) {
        console.error('Ошибка отправки в GA4:', error.response?.data || error.message);
    }
}
/* async function sendGoogleAdsConversion({
    gclid,
    conversionName,
    value,
    transactionId,
    conversionTime = new Date().toISOString(),
    userAgent = '',
    items = [],
}) {
    if (!gclid) {
        console.warn('GCLID отсутствует. Конверсия не будет отправлена в Google Ads.');
        return;
    }

    const payload = {
        conversion_action: "purchase", // Название конверсии, заданное в Google Ads
        conversion_value: value, // Стоимость конверсии
        currency_code: "UAH", // Код валюты
        gclid: gclid, // GCLID пользователя
        order_id: transactionId, // Уникальный ID транзакции
        conversion_time: conversionTime, // Время совершения конверсии
        user_agent: userAgent, // User-Agent клиента (опционально)
        items: items.map(item => ({
            item_id: item.item_id,
            item_name: item.item_name,
            quantity: item.quantity,
            price: item.price,
        })), // Массив товаров
    };

    try {
        const response = await axios.post(
            'https://www.google.com/ads/event/conversions?api_version=v1',
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer <Ваш_ACCESS_TOKEN>', // Ваш токен доступа Google Ads API
                },
            }
        );
        console.log('Google Ads Conversion Sent:', response.status);
    } catch (error) {
        console.error('Ошибка отправки в Google Ads:', error.response?.data || error.message);
    }
}

module.exports = { sendGoogleAdsConversion }; */

module.exports = { sendGA4Conversion };