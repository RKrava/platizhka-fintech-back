const db = require('../config/db');

// Гарантуємо наявність колонок payment_method, shopify_error, shopify_order_id
// (runs once on startup, безпечний для повторного запуску)
let migrationPromise = null;
async function ensureSchema() {
    if (migrationPromise) return migrationPromise;
    migrationPromise = (async () => {
        try {
            await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50)`);
            await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shopify_error TEXT`);
            await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shopify_order_id VARCHAR(100)`);
        } catch (e) {
            console.error('Order schema migration error:', e.message);
        }
    })();
    return migrationPromise;
}
ensureSchema();

class Order {
    constructor({ firstName, lastName, phone, note, email, address, city, country, store_id, checkoutData, paymentMethod }) {
        this.firstName = firstName;
        this.lastName = lastName;
        this.phone = phone;
        this.note = note;
        this.email = email;
        this.address = address;
        this.city = city;
        this.country = country;
        this.store_id = store_id;
        this.checkoutData = checkoutData;
        this.paymentMethod = paymentMethod || null;
    }

    async save() {
        await ensureSchema();
        const date = new Date().toISOString();

        const result = await db.query(
            `INSERT INTO orders (first_name, last_name, phone, note, email, address, city, country, date, store_id, checkoutData, payment_method)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING id`,
            [this.firstName, this.lastName, this.phone, this.note, this.email, this.address, this.city,
                this.country, date, this.store_id, this.checkoutData, this.paymentMethod]
        );
        this.id = result.rows[0].id;
        return this;
    }

    // Записати результат синхронізації з Shopify
    async updateShopifyResult({ shopifyError = null, shopifyOrderId = null }) {
        if (!this.id) return;
        await ensureSchema();
        await db.query(
            `UPDATE orders SET shopify_error = $1, shopify_order_id = COALESCE($2, shopify_order_id) WHERE id = $3`,
            [shopifyError, shopifyOrderId, this.id]
        );
    }
}

module.exports = Order;
