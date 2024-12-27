const axios = require('axios');

async function sendGA4Conversion(client_id, transactionId, value, items) {
    const payload = {
        client_id: client_id, // Извлечённый из `_ga`
        events: [
            {
                name: 'purchase',
                params: {
                    transaction_id: transactionId, // ID транзакции
                    value: value, // Сумма покупки
                    currency: "UAH", // Валюта
                    items: items, // Массив товаров
                },
            },
        ],
    };

    try {
        const response = await axios.post(
            'https://www.google-analytics.com/mp/collect?measurement_id=G-0N0XKJ9EFBD&api_secret=QwhNuKsYTeCWvH7lXR9ISA',
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );
        console.log('GA4 Conversion Sent:', response.status);
        console.log('GA4 Conversion Sent:', JSON.stringify(response));
    } catch (error) {
        console.error('Ошибка отправки в GA4:', error.response?.data || error.message);
    }
}

export { sendGA4Conversion };