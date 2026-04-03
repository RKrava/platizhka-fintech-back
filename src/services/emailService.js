const nodemailer = require('nodemailer');

// Кеш транспортерів по ключу (щоб не створювати щоразу)
const transporterCache = {};

function getTransporter(smtpConfig) {
    const host = smtpConfig?.host || process.env.SMTP_HOST;
    const port = smtpConfig?.port || parseInt(process.env.SMTP_PORT || '587');
    const user = smtpConfig?.user || process.env.SMTP_USER;
    const pass = smtpConfig?.pass || process.env.SMTP_PASS;

    if (!host || !user || !pass) return null;

    const key = `${host}:${port}:${user}`;
    if (!transporterCache[key]) {
        transporterCache[key] = nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass }
        });
    }
    return transporterCache[key];
}

// Генерація HTML для abandoned cart email
function buildAbandonedCartHtml({ firstName, cartItems, recoveryLink, storeName }) {
    const itemsHtml = cartItems.map(item =>
        `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;">${item.title || item.variantId}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;text-align:center;">${item.quantity}</td>
        </tr>`
    ).join('');

    return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
        <div style="max-width:560px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <div style="background:#1a1a1a;padding:24px 32px;">
                <h1 style="color:#fff;margin:0;font-size:18px;">${storeName || 'Ваш магазин'}</h1>
            </div>
            <div style="padding:32px;">
                <p style="font-size:16px;color:#333;margin:0 0 8px;">
                    ${firstName ? `${firstName}, ви` : 'Ви'} не завершили замовлення
                </p>
                <p style="font-size:14px;color:#666;margin:0 0 24px;">
                    Ваші товари ще чекають на вас. Завершіть оформлення в один клік:
                </p>

                ${cartItems.length > 0 ? `
                <table style="width:100%;border-collapse:collapse;margin:0 0 24px;">
                    <thead>
                        <tr style="background:#f9f9f9;">
                            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#999;text-transform:uppercase;">Товар</th>
                            <th style="padding:8px 12px;text-align:center;font-size:12px;color:#999;text-transform:uppercase;">Кількість</th>
                        </tr>
                    </thead>
                    <tbody>${itemsHtml}</tbody>
                </table>
                ` : ''}

                <a href="${recoveryLink}"
                   style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:14px;font-weight:600;">
                    Завершити замовлення
                </a>

                <p style="font-size:12px;color:#999;margin:24px 0 0;">
                    Якщо ви не оформлювали замовлення — просто проігноруйте цей лист.
                </p>
            </div>
        </div>
    </body>
    </html>`;
}

// smtpConfig: { host, port, user, pass, from } — з shop або env
async function sendAbandonedCartEmail({ email, firstName, cartItems, recoveryLink, storeName, smtpConfig }) {
    const transport = getTransporter(smtpConfig);
    if (!transport) {
        console.error('[Email] SMTP not configured');
        return { success: false, error: 'SMTP not configured' };
    }

    try {
        const html = buildAbandonedCartHtml({ firstName, cartItems, recoveryLink, storeName });
        const from = smtpConfig?.from || process.env.SMTP_FROM || 'noreply@platizhka.com';

        const info = await transport.sendMail({
            from,
            to: email,
            subject: `${firstName ? firstName + ', в' : 'В'}аше замовлення ще не завершено`,
            html
        });

        console.log(`[Email] Sent to ${email}, messageId: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('[Email] Send failed:', error.message);
        return { success: false, error: error.message };
    }
}

module.exports = { sendAbandonedCartEmail };
