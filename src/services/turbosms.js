const axios = require('axios');

const API_URL = 'https://api.turbosms.ua';

function getHeaders(token) {
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}

function isSuccess(result) {
    // TurboSMS returns response_code 0 (or "0") and response_status containing "SUCCESS"
    return result.response_code == 0 || (result.response_status && result.response_status.toUpperCase().includes('SUCCESS'));
}

async function sendSms(phone, text, sender, token) {
    const apiToken = token || process.env.TURBOSMS_TOKEN;
    if (!apiToken) return { success: false, error: 'No API token' };

    try {
        const response = await axios.post(`${API_URL}/message/send.json`, {
            recipients: [phone],
            sms: { sender, text }
        }, { headers: getHeaders(apiToken) });

        const result = response.data;
        const messageId = result.response_result?.[0]?.message_id || null;

        if (isSuccess(result)) {
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

async function sendViberWithSmsFallback(phone, viberText, smsText, sender, token) {
    const apiToken = token || process.env.TURBOSMS_TOKEN;
    if (!apiToken) return { success: false, error: 'No API token' };

    try {
        const response = await axios.post(`${API_URL}/message/send.json`, {
            recipients: [phone],
            viber: { sender, text: viberText },
            sms: { sender, text: smsText }
        }, { headers: getHeaders(apiToken) });

        const result = response.data;
        const messageId = result.response_result?.[0]?.message_id || null;

        if (isSuccess(result)) {
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

module.exports = { sendViberWithSmsFallback, sendSms };
