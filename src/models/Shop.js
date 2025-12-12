const db = require('../config/db');

const defaultSuccessPageConfig = {
  "backgroundColor": "#F3F4F6",
  "cardBackgroundColor": "#ffffff",
  "textColor": "#000000",
  "primaryColor": "000000",
  "title": "Дякуємо за ваше замовлення!",
  "description": "Ваше замовлення було успішно оформлене. Ви отримаєте лист із деталями замовлення на вашу електронну пошту.",
  "orderNumber": "1235",    
  "continueShoppingText": "Продовжити покупки",
  "contactInfoText": "Якщо у вас виникли питання, зв'яжіться з нашою службою підтримки:",
  "thankYouText": "Ми цінуємо ваш вибір і сподіваємося побачити вас знову!"
};

const defaultCartPageConfig = {
  "backgroundColor": "#F3F4F6",
  "cardBackgroundColor": "#ffffff",
  "textColor": "#000000",
  "buttonColor": "#c6c7c7",
  "showImages": true,
  "logo": "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Untitled%20design%20(1)-vubXMNP4oUztYdwiAW6WgvhxYVogR0.png",
  "allowCashOnDelivery": true,
  "showSelfPickup": true,
  "showDiscountSection": true
};

class Shop {
  constructor({ id, user_id, name, description, shopify_url, domain_url, admin_api_token, storefront_api_token, success_page_config, cart_page_config, mono_token, mono_checkout_token, hutko_merchant_id, hutko_secret_key }) {
    this.id = id;
    this.user_id = user_id;
    this.name = name;
    this.description = description;
    this.shopify_url = shopify_url;
    this.domain_url = domain_url
    this.admin_api_token = admin_api_token;
    this.storefront_api_token = storefront_api_token;
    this.success_page_config = success_page_config;
    this.cart_page_config = cart_page_config;
    this.mono_token = mono_token;
    this.mono_checkout_token = mono_checkout_token;
    this.hutko_merchant_id = hutko_merchant_id;
    this.hutko_secret_key = hutko_secret_key;
  }

  static async create(shopData) {
    const { 
      user_id, 
      name, 
      description, 
      shopify_url,
      domain_url,
      admin_api_token, 
      storefront_api_token, 
      success_page_config = defaultSuccessPageConfig, 
      cart_page_config = defaultCartPageConfig 
    } = shopData;

    return new Promise((resolve, reject) => {
      db.query(
        `INSERT INTO shops (user_id, name, description, shopify_url, domain_url, admin_api_token, storefront_api_token, success_page_config, cart_page_config) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [user_id, name, description, shopify_url, domain_url, admin_api_token, storefront_api_token, JSON.stringify(success_page_config), JSON.stringify(cart_page_config)],
        function (err, rows) {
          if (err) reject(err);
          resolve(rows.rows[0].id);
        }
      );
    });
  }

  static async findById(id) {
    return new Promise((resolve, reject) => {
      db.query('SELECT * FROM shops WHERE id = $1', [id], (err, result) => {
        if (err) reject(err);
        const row = result?.rows[0]
        if (row) {
          // Проверка и парсинг success_page_config
          if (row.success_page_config) {
            try {
              row.success_page_config = JSON.parse(row.success_page_config);
            } catch (e) {
              console.error('Ошибка при парсинге success_page_config:', e);
              row.success_page_config = defaultSuccessPageConfig;
            }
          } else {
            row.success_page_config = defaultSuccessPageConfig;
          }

          // Проверка и парсинг cart_page_config
          if (row.cart_page_config) {
            try {
              row.cart_page_config = JSON.parse(row.cart_page_config);
            } catch (e) {
              console.error('Ошибка при парсинге cart_page_config:', e);
              row.cart_page_config = defaultCartPageConfig;
            }
          } else {
            row.cart_page_config = defaultCartPageConfig;
          }

          resolve(new Shop(row));
        } else {
          resolve(null);
        }
      });
    });
  }

  static async findByHost(shopify_url) {
    return new Promise((resolve, reject) => {
      db.query('SELECT * FROM shops WHERE shopify_url = $1', [shopify_url], (err, result) => {
        if (err) reject(err);
        const row = result?.rows[0]

        if (!row) {
          resolve(null)
        }

        resolve(new Shop(result.rows[0]));
      });
    });
  }

  static async updateConfig(id, success_page_config, cart_page_config, mono_token, mono_checkout_token, hutko_merchant_id, hutko_secret_key) {
    return new Promise((resolve, reject) => {
      let query = 'UPDATE shops SET';
      const params = [];
      let paramsNumber = 0
      
      if (success_page_config !== undefined) {
        query += ` success_page_config = $${++paramsNumber},`;
        params.push(JSON.stringify(success_page_config));
      }
      
      if (cart_page_config !== undefined) {
        query += ` cart_page_config = $${++paramsNumber},`;
        params.push(JSON.stringify(cart_page_config));
      }

      if (mono_token !== undefined) {
        query += ` mono_token = $${++paramsNumber},`;
        params.push(mono_token);
      }

      if (mono_checkout_token !== undefined) {
        query += ` mono_checkout_token = $${++paramsNumber},`;
        params.push(mono_checkout_token);
      }

      if (hutko_merchant_id !== undefined) {
        query += ` hutko_merchant_id = $${++paramsNumber},`;
        params.push(hutko_merchant_id);
      }

      if (hutko_secret_key !== undefined) {
        query += ` hutko_secret_key = $${++paramsNumber},`;
        params.push(hutko_secret_key);
      }
      
      // Удаляем последнюю запятую
      query = query.slice(0, -1);
      
      query += ` WHERE id = $${++paramsNumber}`;
      params.push(id);
      
      db.query(query, params, function (err, result) {
        if (err) reject(err);
        resolve(result);
      });
    });
  }

  static async delete(id) {
    return new Promise((resolve, reject) => {
      db.query('DELETE FROM shops WHERE id = $1', [id], function (err, result) {
        if (err) reject(err);
        resolve(result);
      });
    });
  }

  static async update(id, shopData) {
    const { name, description, shopify_url, domain_url, admin_api_token, storefront_api_token } = shopData;
    return new Promise((resolve, reject) => {
      db.query(
        `UPDATE shops 
         SET name = $1, description = $2, shopify_url = $3, admin_api_token = $4, storefront_api_token = $5, domain_url = $6
         WHERE id = $7`,
        [name, description, shopify_url, admin_api_token, storefront_api_token, domain_url, id],
        function (err, result) {
          if (err) reject(err);
          resolve(result);
        }
      );
    });
  }

  static async findByUserId(userId) {
    return new Promise((resolve, reject) => {
      db.query('SELECT * FROM shops WHERE user_id = $1', [userId], (err, result) => {
        if (err) reject(err);
        resolve(result.rows.map(row => new Shop(row)));
      });
    });
  }

}

module.exports = Shop;