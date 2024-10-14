const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');

    if (!authHeader) {
      throw new Error('Отсутствует заголовок Authorization');
    }
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByUserId(decoded.userId);
    user.id = decoded.userId
    if (!user) {
      throw new Error('Пользователь не найден');
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    console.error('Ошибка аутентификации:', error.message);
    res.status(401).send({ error: 'Пожалуйста, авторизуйтесь.' });
  }
};

module.exports = authMiddleware;