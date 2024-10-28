const express = require('express');
const router = express.Router();
const Shop = require('../models/Shop');
const authMiddleware = require('../middleware/auth');


// Удаление магазина
router.post('/delete', authMiddleware, async (req, res) => {
    try {
      const shopId = req.body.shopId;

      if (!shopId) {
        return res.status(400).json({ message: 'Не указан идентификатор магазина' });
      }

      const shop = await Shop.findById(shopId);

      if (!shop) {
        return res.status(404).json({ message: 'Магазин не найден' });
      }

      if (shop.user_id !== req.user.id) {
        return res.status(403).json({ message: 'У вас нет доступа к этому магазину' });
      }

      const result = await Shop.delete(shopId);
      if (result === 0) {
        return res.status(404).json({ message: 'Магазин не найден' });
      }
      res.json({ message: 'Магазин успешно удален' });
    } catch (error) {
      console.error('Ошибка при удалении магазина:', error);
      res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
  });
  
  // Обновление параметров магазина
  router.post('/update', authMiddleware, async (req, res) => {
    try {
      const { shopId, name, description, shopify_url, domain_url, admin_api_token, storefront_api_token } = req.body;

      if (!shopId) {
        return res.status(400).json({ message: 'Не указан идентификатор магазина' });
      }

      const shop = await Shop.findById(shopId);

      if (!shop) {
        return res.status(404).json({ message: 'Магазин не найден' });
      }

      if (shop.user_id !== req.user.id) {
        return res.status(403).json({ message: 'У вас нет доступа к этому магазину' });
      }
      
      const shopData = {
        name,
        description,
        shopify_url,
        domain_url,
        admin_api_token,
        storefront_api_token
      };

      const result = await Shop.update(shopId, shopData);
      if (result === 0) {
        return res.status(404).json({ message: 'Магазин не найден' });
      }
      res.json({ message: 'Магазин успешно обновлен' });
    } catch (error) {
      console.error('Ошибка при обновлении магазина:', error);
      res.status(500).json({ message: 'Внутренняя ошибка сервера' });
    }
  });

router.get('/id', async (req, res) => {
  try {
    const { host_url } = req.query;

    if (!host_url) {
      return res.status(400).json({ message: 'Не указан домен магазина' });
    }
    console.log(host_url)
    const shop = await Shop.findByHost(host_url);

    if (!shop) {
      return res.status(404).json({ message: 'Магазин не найден' });
    }

    res.json({ id: shop.id });
  } catch (error) {
    console.error('Ошибка при получении магазина:', error);
    res.status(500).json({ message: 'Внутренняя ошибка сервера' });
  }
});

// Получить конфигурацию магазина
router.get('/config-info', async (req, res) => {
  try {
    const shopId = req.query.shopId;

    if (!shopId) {
      return res.status(400).json({ message: 'Не указан идентификатор магазина' });
    }

    const shop = await Shop.findById(shopId);
    
    if (!shop) {
      return res.status(404).json({ message: 'Магазин не найден' });
    }
    
    if (shop.user_id !== req.user.id) {
      return res.status(403).json({ message: 'У вас нет доступа к этому магазину' });
    }
    
    res.json({
      success_page_config: shop.success_page_config,
      cart_page_config: shop.cart_page_config
    });
  } catch (error) {
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Обновить конфигурацию магазина
router.post('/config', authMiddleware, async (req, res) => {
  try {
    const shopId = req.body.shopId;

    if (!shopId) {
      return res.status(400).json({ message: 'Не указан идентификатор магазина' });
    }

    const { success_page_config, cart_page_config } = req.body;
    // Проверяем, что хотя бы один из параметров конфигурации не пустой
    if (!success_page_config && !cart_page_config) {
      return res.status(400).json({ message: 'Вы не изменили никаких настроек конфигурации' });
    }
    
    const shop = await Shop.findById(shopId);
    
    if (!shop) {
      return res.status(404).json({ message: 'Магазин не найден' });
    }
    
    if (shop.user_id !== req.user.id) {
      return res.status(403).json({ message: 'У вас нет доступа к этому магазину' });
    }
    
    await Shop.updateConfig(shopId, success_page_config, cart_page_config);
    
    res.json({ message: 'Конфигурация магазина обновлена успешно' });
  } catch (error) {
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

module.exports = router;