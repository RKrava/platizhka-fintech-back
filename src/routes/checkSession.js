const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');

router.post('/check-session', authMiddleware, async (req, res) => {
  try {
    // Получаем токен из заголовка Authorization
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: 'Токен авторизации отсутствует' });
    }

    // Извлекаем токен из заголовка
    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'Неверный формат токена' });
    }

    res.status(200).json({ message: 'Сессия действительна', isValid: true });

  } catch (error) {
    console.error('Ошибка при проверке сессии:', error);
    res.status(500).json({ message: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;