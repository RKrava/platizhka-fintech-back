const axios = require('axios');

const API_URL = 'https://api.turbosms.ua';

function getToken() {
    return process.env.TURBOSMS_TOKEN;
}

function getHeaders() {
    return {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
    };
}

// Viber з автоматичним SMS fallback (гібридна відправка TurboSMS)
async function sendViberWithSmsFallback(phone, viberText, smsText, sender) {
    try {
        const response = await axios.post(`${API_URL}/message/send.json`, {
            recipients: [phone],
            viber: {
                sender: sender,
                text: viberText
            },
            sms: {
                sender: sender,
                text: smsText
            }
        }, { headers: getHeaders() });

        const result = response.data;
        const messageId = result.response_result?.[0]?.message_id || null;

        if (result.response_code === 0) {
            console.log(`[TurboSMS] Viber+SMS sent to ${phone}, message_id: ${messageId}`);
            return { success: true, messageId };
        } else {
            console.error(`[TurboSMS] Error: ${result.response_status}`);
            return { success: false, error: result.response_status };
        }
    } catch (error) {
        console.error('[TurboSMS] Request failed:', error.message);
        return { success: false, error: error.message };
    }
}

// Тільки SMS
async function sendSms(phone, text, sender) {
    try {
        const response = await axios.post(`${API_URL}/message/send.json`, {
            recipients: [phone],
            sms: {
                sender: sender,
                text: text
            }
        }, { headers: getHeaders() });

        const result = response.data;
        const messageId = result.response_result?.[0]?.message_id || null;

        if (result.response_code === 0) {
            console.log(`[TurboSMS] SMS sent to ${phone}, message_id: ${messageId}`);
            return { success: true, messageId };
        } else {
            console.error(`[TurboSMS] Error: ${result.response_status}`);
            return { success: false, error: result.response_status };
        }
    } catch (error) {
        console.error('[TurboSMS] Request failed:', error.message);
        return { success: false, error: error.message };
    }
}

// Перевірка статусу повідомлення
async function getStatus(messageId) {
    try {
        const response = await axios.post(`${API_URL}/message/status.json`, {
            messages: [messageId]
        }, { headers: getHeaders() });
        return response.data;
    } catch (error) {
        console.error('[TurboSMS] Status check failed:', error.message);
        return null;
    }
}

module.exports = { sendViberWithSmsFallback, sendSms, getStatus };
