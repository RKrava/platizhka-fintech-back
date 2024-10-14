const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const express = require('express');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { email, password, telegram, source, income } = req.body;

    // Проверка, существует ли пользователь с таким email
    const existingUser = await User.findByUsername(email);

    if (existingUser) {
      return res.status(400).json({ message: 'Пользователь с таким email уже существует' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ email, password: hashedPassword, telegram, source, average_income: income });
    const userId = await user.save();
    // Создание токена сессии
    const token = jwt.sign({ userId: userId }, process.env.JWT_SECRET, { expiresIn: '2h' });
    res.status(201).json({ message: 'Пользователь успешно зарегистрирован', token, userId: userId });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Ошибка при регистрации', error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findByUsername(email);

    if (!user) {
      return res.status(401).json({ message: 'Неверное имя пользователя или пароль' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Неверное имя пользователя или пароль' });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '2h' });
    res.json({ token, userId: user.id });
  } catch (error) {
    console.error('Ошибка при входе:', error);
    res.status(500).json({ message: 'Ошибка при входе', error: error.message });
  }
});

module.exports = router;