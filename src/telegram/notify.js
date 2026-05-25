const BOT_TOKEN = '7705410123:AAG6iBrAK_yZGjSkQreV_IhsPIV0aypjuYw';
const CHAT_ID   = '-4630491937';

async function sendTelegram(text) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.warn('[telegram] notify failed:', e.message);
  }
}

async function notifyNewUser({ email, id, createdAt }) {
  const date = createdAt
    ? new Date(createdAt).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })
    : '—';
  await sendTelegram(
    `🎉 <b>Новий користувач</b>\n` +
    `📧 ${email || '—'}\n` +
    `🆔 <code>${id || '—'}</code>\n` +
    `🕐 ${date}`
  );
}

module.exports = { sendTelegram, notifyNewUser };
