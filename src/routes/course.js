const express = require('express');
const axios = require('axios');

const db = require('../config/db');
const router = express.Router();
router.use(express.json());

const allowedIps = [
  '35.158.201.27',
  '52.58.160.42',
  '35.158.31.50',
  '35.158.251.173'
];

// Generate unique code for Telegram bot access
const generateTelegramCode = () => {
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
};


router.post('/payment', async (req, res) => {
  const { phone, email, version } = req.body;

  if (!phone || !email) {
      return res.status(400).json({ message: 'All fields are required' });
  }

  const telegramCode = generateTelegramCode();

  const userId = await new Promise((resolve, reject) => {
      db.query(
          `INSERT INTO course_users (email, phone, code) 
            VALUES ($1, $2, $3) RETURNING id`,
          [email, phone, telegramCode],
      function (err, results) {
        if (err) reject(err);
        const userId = results.rows[0].id;
        resolve(userId);
      }
    );
  });

  const redirectUrl = `https://t.me/startmagazyn_bot?start=${telegramCode}`;

  const basketOrder = [
    {
      name: 'Курс "Твій магазин одягу"',
      qty: 1,
      sum: version === '1' ? 9900 : 39900,
      icon: 'https://printera-course.vercel.app/logo.png',
      unit: "шт.",
      code: "d21da1c47f3c45fca10a10c32518bdeb",
      barcode: "string",
      header: "string",
      footer: "string",
      tax: [],
      uktzed: "string",
    }
  ]

  const invoiceData = {
      amount: version === '1' ? 9900 : 39900,
      ccy: 980, // Код валюты (гривна)
      merchantPaymInfo: {
          reference: userId.toString(), // шифрованный reference
          destination: "Покупка курсу",
          basketOrder, // данные корзины
      },
      redirectUrl, // URL для перенаправления
      webHookUrl: `https://platizhka-back.vercel.app/course/payment/mono`, // Webhook URL
      validity: 3600, // Время действия инвойса 
      paymentType: "debit",
  };

  try {
      
      const response = await axios.post('https://api.monobank.ua/api/merchant/invoice/create', invoiceData, {
          headers: {
              'Content-Type': 'application/json',
              'Cache-Control' : 'no-cache',
              'X-Token': 'mFohYtxdYoQe91HE6nY13nA'
          },
      });

      res.json({
          success: true,
          invoiceId: response.data.invoiceId,
          pageUrl: response.data?.pageUrl,
      });
  } catch (error) {
      console.error('Ошибка при создании инвойса:', error);
      res.status(500).json({
          success: false,
          message: 'Ошибка при создании инвойса',
      });
  }
});


router.post('/payment/mono', async (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  if (!allowedIps.includes(clientIp)) {
      console.warn(`Запрос от неразрешенного IP-адреса: ${clientIp}`);
      return res.status(403).json({ message: 'Доступ запрещен' });
  }

  const paymentData = req.body;

  if (paymentData.status === 'success') {
      try {
          const userId = paymentData.reference;

          await db.query(
            `UPDATE course_users SET buy = true WHERE id = $1`,
            [userId],
          );

          return res.status(200).json({ message: 'User updated'});
      } catch (error) {
          console.error('Ошибка при создании заказа:', error);
          return res.status(500).json({ message: 'User update error', error: error.message });
      }
  } else {
      return res.status(400).json({ message: 'Payment declined' });
  }
});


module.exports = router;