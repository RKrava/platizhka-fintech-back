const supabaseAdmin = require('../config/supabase');

const defaultSuccessPageConfig = {
  backgroundColor: '#F3F4F6',
  cardBackgroundColor: '#ffffff',
  textColor: '#000000',
  primaryColor: '000000',
  title: 'Дякуємо за ваше замовлення!',
  description:
    'Ваше замовлення було успішно оформлене. Ви отримаєте лист із деталями замовлення на вашу електронну пошту.',
  orderNumber: '1235',
  continueShoppingText: 'Продовжити покупки',
  contactInfoText: "Якщо у вас виникли питання, зв'яжіться з нашою службою підтримки:",
  thankYouText: 'Ми цінуємо ваш вибір і сподіваємося побачити вас знову!',
};

const defaultCartPageConfig = {
  backgroundColor: '#F3F4F6',
  cardBackgroundColor: '#ffffff',
  textColor: '#000000',
  buttonColor: '#c6c7c7',
  showImages: true,
  logo: 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Untitled%20design%20(1)-vubXMNP4oUztYdwiAW6WgvhxYVogR0.png',
  allowCashOnDelivery: true,
  showSelfPickup: true,
  showDiscountSection: true,
};

function parseJsonField(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function asPgResult(data) {
  return { rows: data || [], rowCount: Array.isArray(data) ? data.length : data ? 1 : 0 };
}

class Shop {
  constructor(row) {
    this.id = row.id;
    this.user_id = row.user_id;
    this.name = row.name;
    this.description = row.description;
    this.shopify_url = row.shopify_url;
    this.domain_url = row.domain_url;
    this.admin_api_token = row.admin_api_token;
    this.storefront_api_token = row.storefront_api_token;
    this.success_page_config = row.success_page_config;
    this.cart_page_config = row.cart_page_config;
    this.settings = row.settings;
    this.status = row.status || 'active';
    this.mono_token = row.mono_token;
    this.mono_checkout_token = row.mono_checkout_token;
    this.hutko_merchant_id = row.hutko_merchant_id;
    this.hutko_secret_key = row.hutko_secret_key;
    this.turbosms_token = row.turbosms_token;
    this.turbosms_sender = row.turbosms_sender;
    this.abandoned_promo_code = row.abandoned_promo_code;
    this.abandoned_promo_urgent_code = row.abandoned_promo_urgent_code;
    this.abandoned_promo_urgent_percent = row.abandoned_promo_urgent_percent;
    this.abandoned_notifications_enabled = row.abandoned_notifications_enabled;
    this.smtp_host = row.smtp_host;
    this.smtp_port = row.smtp_port;
    this.smtp_user = row.smtp_user;
    this.smtp_pass = row.smtp_pass;
    this.smtp_from = row.smtp_from;
    this.notif_step1_minutes = row.notif_step1_minutes || 30;
    this.notif_step2_minutes = row.notif_step2_minutes || 1440;
    this.notif_step3_minutes = row.notif_step3_minutes || 2880;
    this.notif_channel_priority = row.notif_channel_priority || 'sms_first';
  }

  static normalizeRow(row) {
    if (!row) return null;

    return {
      ...row,
      success_page_config: parseJsonField(row.success_page_config, defaultSuccessPageConfig),
      cart_page_config: parseJsonField(row.cart_page_config, defaultCartPageConfig),
      settings: parseJsonField(row.settings, row.settings || null),
    };
  }

  static fromRow(row) {
    const normalized = Shop.normalizeRow(row);
    return normalized ? new Shop(normalized) : null;
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
      cart_page_config = defaultCartPageConfig,
      settings,
    } = shopData;

    const { data, error } = await supabaseAdmin
      .from('shops')
      .insert({
        user_id,
        name,
        description,
        shopify_url,
        domain_url,
        admin_api_token,
        storefront_api_token,
        success_page_config,
        cart_page_config,
        settings: settings === undefined ? null : settings,
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  static async findById(id) {
    const { data, error } = await supabaseAdmin
      .from('shops')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return Shop.fromRow(data);
  }

  static async findByHost(shopify_url) {
    const { data, error } = await supabaseAdmin
      .from('shops')
      .select('*')
      .eq('shopify_url', shopify_url)
      .maybeSingle();

    if (error) throw error;
    return Shop.fromRow(data);
  }

  static async findByUrl(shopifyUrl) {
    return Shop.findByHost(shopifyUrl);
  }

  static async findByUserId(userId) {
    const { data, error } = await supabaseAdmin
      .from('shops')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;
    return (data || []).map((row) => Shop.fromRow(row));
  }

  static async findAll() {
    const { data, error } = await supabaseAdmin.from('shops').select('*');

    if (error) throw error;
    return (data || []).map((row) => Shop.fromRow(row));
  }

  static async updateConfig(
    id,
    success_page_config,
    cart_page_config,
    mono_token,
    mono_checkout_token,
    hutko_merchant_id,
    hutko_secret_key,
  ) {
    const updates = {};

    if (success_page_config !== undefined) updates.success_page_config = success_page_config;
    if (cart_page_config !== undefined) updates.cart_page_config = cart_page_config;
    if (mono_token !== undefined) updates.mono_token = mono_token;
    if (mono_checkout_token !== undefined) updates.mono_checkout_token = mono_checkout_token;
    if (hutko_merchant_id !== undefined) updates.hutko_merchant_id = hutko_merchant_id;
    if (hutko_secret_key !== undefined) updates.hutko_secret_key = hutko_secret_key;

    return Shop.updateColumns(id, updates);
  }

  static async update(id, shopData) {
    const {
      name,
      description,
      shopify_url,
      domain_url,
      admin_api_token,
      storefront_api_token,
    } = shopData;

    return Shop.updateColumns(id, {
      name,
      description,
      shopify_url,
      domain_url,
      admin_api_token,
      storefront_api_token,
    });
  }

  static async updateWithSettings(id, shopData) {
    const { name, shopify_url, admin_api_token, settings } = shopData;

    return Shop.updateColumns(id, {
      name,
      shopify_url,
      admin_api_token,
      settings,
    });
  }

  static async updateColumns(id, updates) {
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    );

    if (Object.keys(cleanUpdates).length === 0) return asPgResult([]);

    const { data, error } = await supabaseAdmin
      .from('shops')
      .update(cleanUpdates)
      .eq('id', id)
      .select('*');

    if (error) throw error;
    return asPgResult(data);
  }

  static async delete(id) {
    const { data, error } = await supabaseAdmin
      .from('shops')
      .delete()
      .eq('id', id)
      .select('*');

    if (error) throw error;
    return asPgResult(data);
  }
}

module.exports = Shop;
