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

router.post('/payment', async (req, res) => {
  const { orderId, totalPrice } = req.body;

  if (!orderId || !totalPrice) {
      return res.status(400).json({ message: 'All fields are required' });
  }

  // Округляем totalPrice до целого числа копеек
  const amountInKopecks = Math.round(totalPrice * 100);

  const redirectUrl = `https://localhost:8080/order/${orderId}/success`;

  const basketOrder = [
    {
      name: 'Послуги друку',
      qty: 1,
      sum: amountInKopecks,
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
      amount: amountInKopecks,
      ccy: 980, // Код валюты (гривна)
      merchantPaymInfo: {
          reference: orderId.toString(), // шифрованный reference
          destination: "Послуги друку",
          basketOrder, // данные корзины
      },
      redirectUrl, // URL для перенаправления
      webHookUrl: `https://platizhka-back.vercel.app/printer/payment/mono`, // Webhook URL
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
          const orderId = paymentData.reference;

          await db.query(
            `UPDATE orders SET status = 'confirmed' WHERE id = $1`,
            [orderId],
          );

          return res.status(200).json({ message: 'Order confirmed'});
      } catch (error) {
          console.error('Ошибка при подтверждении заказа:', error);
          return res.status(500).json({ message: 'Order confirmation error', error: error.message });
      }
  } else {
      return res.status(400).json({ message: 'Payment declined' });
  }
});


module.exports = router;