const express = require('express');
const bcrypt = require('bcryptjs'); // Добавляем импорт bcrypt
const Shop = require('../models/Shop');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Добавьте эту строку перед определением маршрутов
router.use(express.json());

router.post('/create-shop', authMiddleware, async (req, res) => {
  try {
    const { name, description, shopify_url, domain_url, admin_api_token, storefront_api_token } = req.body;
    const user_id = req.user.id; // Предполагается, что ID пользователя доступен после аутентификации
    if (!name || !description || !shopify_url || !domain_url || !admin_api_token || !storefront_api_token) {
      return res.status(400).json({ message: 'Все поля обязательны для заполнения' });
    }

    const shopData = { user_id, name, description, shopify_url, domain_url, admin_api_token, storefront_api_token };
    const shopId = await Shop.create(shopData);
    res.status(201).json({ message: 'Магазин успешно создан', shopId });
  } catch (error) {
    res.status(500).json({ message: 'Ошибка при создании магазина', error: error.message });
  }
});

router.post('/shops', authMiddleware, async (req, res) => {
  try {
    const shops = await Shop.findByUserId(req.user.id);
    res.json(shops);
  } catch (error) {
    res.status(500).json({ message: 'Ошибка при получении магазинов', error: error.message });
  }
});

router.post('/user-data', authMiddleware, async (req, res) => {
  try {
    const shops = await Shop.findByUserId(req.user.id);

    const userData = {
      email: req.user.email,
      registration_date: req.user.registration_date,
      shops: shops
    };

    res.json(userData);
  } catch (error) {
    res.status(500).json({ message: 'Ошибка при получении данных пользователя', error: error.message });
  }
});

router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findByUserId(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Неверный текущий пароль' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await User.updatePassword(req.user.id, hashedNewPassword);

    res.json({ message: 'Пароль успешно изменен' });
  } catch (error) {
    console.error('Ошибка при изменении пароля:', error);
    res.status(500).json({ message: 'Ошибка при изменении пароля', error: error.message });
  }
});

module.exports = router;