const nodemailer = require('nodemailer');

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
            host, port, secure: port === 465,
            auth: { user, pass }
        });
    }
    return transporterCache[key];
}

function buildAbandonedCartHtml({ firstName, cartItems, recoveryLink, storeName }) {
    const hasProducts = cartItems.length > 0 && cartItems.some(i => i.title);
    const total = cartItems.reduce((sum, item) => sum + (parseFloat(item.price || 0) * (item.quantity || 1)), 0);
    const greeting = firstName ? `${firstName}, ви` : 'Ви';
    const displayName = storeName || 'Магазин';

    const productsSection = hasProducts ? `
            <h3 style="color:#333;font-size:16px;margin:0 0 16px;font-family:'Rubik',sans-serif;font-weight:600;padding-bottom:8px;border-bottom:2px solid #FA5800;display:inline-block;">
                Ваш кошик
            </h3>
            <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:0;border-radius:12px;overflow:hidden;border:1px solid #f0f0f0;background:#fff;">
                ${cartItems.map(item => `
                <tr>
                    <td style="width:70px;padding:14px;border-bottom:1px solid #f0f0f0;background:#fff;">
                        ${item.image
                            ? `<img src="${item.image}" alt="" style="width:60px;height:60px;border-radius:10px;object-fit:cover;box-shadow:0 2px 8px rgba(0,0,0,0.1);">`
                            : `<div style="width:60px;height:60px;border-radius:10px;background:#f5f5f5;"></div>`
                        }
                    </td>
                    <td style="padding:14px;border-bottom:1px solid #f0f0f0;background:#fff;">
                        <span style="font-weight:500;color:#333;font-size:14px;font-family:'Rubik',sans-serif;">${item.title || 'Товар'}</span>
                    </td>
                    <td style="padding:14px;border-bottom:1px solid #f0f0f0;text-align:center;color:#888;font-size:14px;background:#fff;">
                        &times;${item.quantity || 1}
                    </td>
                    ${total > 0 ? `
                    <td style="padding:14px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600;color:#333;font-size:15px;background:#fff;">
                        ${parseFloat(item.price || 0).toFixed(0)} &#8372;
                    </td>` : ''}
                </tr>`).join('')}
                ${total > 0 ? `
                <tr>
                    <td colspan="3" style="padding:16px;text-align:right;font-size:14px;color:#666;border-bottom:none;background:#fff;">Доставка:</td>
                    <td style="padding:16px;text-align:right;font-size:14px;color:#666;border-bottom:none;background:#fff;">За тарифами НП</td>
                </tr>
                <tr>
                    <td colspan="3" style="padding:18px 16px;text-align:right;font-size:18px;font-weight:600;color:#fff;background:#FA5800;border-bottom:none;">Разом:</td>
                    <td style="padding:18px 16px;text-align:right;font-size:18px;font-weight:600;color:#fff;background:#FA5800;border-bottom:none;">${total.toFixed(0)} &#8372;</td>
                </tr>` : ''}
            </table>
    ` : '';

    return `<!DOCTYPE html>
<html lang="uk">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Rubik', 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 20px 10px; }
        @media screen and (max-width: 600px) {
            .content { padding: 24px 16px !important; }
            .cta-btn { padding: 14px 24px !important; font-size: 13px !important; }
        }
    </style>
</head>
<body style="font-family:'Rubik','Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:20px 10px;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header gradient -->
        <div style="background:linear-gradient(135deg,#E42C0B 0%,#FA5800 100%);text-align:center;padding:32px 30px;">
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;font-family:'Rubik',sans-serif;letter-spacing:0.5px;">${displayName}</h1>
        </div>

        <!-- Content -->
        <div class="content" style="padding:40px 30px;background:#fff;">
            <h2 style="color:#E42C0B;font-size:22px;margin:0 0 12px;text-align:center;font-weight:600;font-family:'Rubik',sans-serif;">
                ${greeting} не завершили замовлення
            </h2>
            <p style="color:#555;font-size:15px;line-height:1.7;text-align:center;margin:0 0 28px;font-family:'Rubik',sans-serif;">
                ${hasProducts ? 'Ваші товари ще чекають на вас.' : 'Ви почали оформлення, але не завершили.'} Завершіть — це займе лише хвилину!
            </p>

            <!-- CTA -->
            <div style="text-align:center;margin:0 0 ${hasProducts ? '30' : '0'}px;">
                <a href="${recoveryLink}" class="cta-btn" style="background:linear-gradient(135deg,#CBDE25 0%,#A6D700 100%);color:#333;padding:16px 40px;text-decoration:none;border-radius:50px;display:inline-block;font-weight:600;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;box-shadow:0 4px 15px rgba(203,222,37,0.3);font-family:'Rubik',sans-serif;">
                    Завершити замовлення
                </a>
            </div>

            ${productsSection}

            ${hasProducts ? `
            <!-- Second CTA -->
            <div style="text-align:center;margin:30px 0 0;">
                <a href="${recoveryLink}" class="cta-btn" style="background:linear-gradient(135deg,#CBDE25 0%,#A6D700 100%);color:#333;padding:16px 40px;text-decoration:none;border-radius:50px;display:inline-block;font-weight:600;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;box-shadow:0 4px 15px rgba(203,222,37,0.3);font-family:'Rubik',sans-serif;">
                    Завершити замовлення
                </a>
            </div>` : ''}
        </div>

        <!-- Footer -->
        <div style="background:#FA5800;color:#fff;text-align:center;padding:25px 30px;">
            <p style="margin:0 0 12px;font-size:14px;color:#fff;font-family:'Rubik',sans-serif;">
                <strong>+380966596072</strong>
                <span style="opacity:0.6;margin:0 8px;">&bull;</span>
                Пн-Нд 9-19
            </p>
            <p style="margin:0;font-size:13px;color:#fff;font-family:'Rubik',sans-serif;">
                <a href="https://t.me/managerUUA" style="color:#fff;text-decoration:none;">Telegram</a>
                <span style="opacity:0.6;margin:0 6px;">&bull;</span>
                <a href="https://www.instagram.com/bricktopia.ua/" style="color:#fff;text-decoration:none;">Instagram</a>
                <span style="opacity:0.6;margin:0 6px;">&bull;</span>
                <a href="https://bricktopia.store/" style="color:#fff;text-decoration:none;">bricktopia.store</a>
            </p>
            <p style="margin:12px 0 0;font-size:10px;color:#fff;opacity:0.7;font-family:'Rubik',sans-serif;">
                Якщо ви не оформлювали замовлення — просто проігноруйте цей лист.
            </p>
        </div>
    </div>
</body>
</html>`;
}

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

function getEmailPreviewHtml({ firstName, cartItems, recoveryLink, storeName }) {
    return buildAbandonedCartHtml({ firstName, cartItems, recoveryLink, storeName });
}

module.exports = { sendAbandonedCartEmail, getEmailPreviewHtml };
