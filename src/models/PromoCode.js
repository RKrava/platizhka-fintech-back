const db = require('../config/db');

// Гарантуємо наявність колонки code_type (manual | system)
let schemaPromise = null;
async function ensureSchema() {
    if (schemaPromise) return schemaPromise;
    schemaPromise = (async () => {
        try {
            await db.query(`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS code_type VARCHAR(20) DEFAULT 'manual'`);
        } catch (e) {
            console.error('PromoCode schema migration error:', e.message);
        }
    })();
    return schemaPromise;
}
ensureSchema();

class PromoCode {
    constructor(data) {
        this.id = data.id;
        this.store_id = data.store_id;
        this.code = data.code;
        this.discount_type = data.discount_type;
        this.discount_value = parseFloat(data.discount_value) || 0;
        this.min_order_amount = parseFloat(data.min_order_amount) || 0;
        this.max_uses = data.max_uses;
        this.used_count = data.used_count || 0;
        this.active = data.active !== undefined ? data.active : true;
        this.starts_at = data.starts_at;
        this.expires_at = data.expires_at;
        this.created_at = data.created_at;
        // manual = створений вручну менеджером, system = згенерований автоматично
        this.code_type = data.code_type || 'manual';
    }

    async save() {
        await ensureSchema();
        return new Promise((resolve, reject) => {
            db.query(
                `INSERT INTO promo_codes (store_id, code, discount_type, discount_value, min_order_amount, max_uses, active, starts_at, expires_at, code_type)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 RETURNING *`,
                [this.store_id, this.code.toUpperCase(), this.discount_type, this.discount_value,
                 this.min_order_amount, this.max_uses, this.active, this.starts_at, this.expires_at, this.code_type || 'manual'],
                (err, result) => {
                    if (err) return reject(err);
                    resolve(new PromoCode(result.rows[0]));
                }
            );
        });
    }

    static async findByCode(storeId, code) {
        // Trim + uppercase — users copy-paste from email/SMS and often
        // drag in leading/trailing whitespace. All our inserted codes
        // are stored uppercase already.
        const normalized = String(code || '').trim().toUpperCase();
        return new Promise((resolve, reject) => {
            db.query(
                'SELECT * FROM promo_codes WHERE store_id = $1 AND code = $2',
                [storeId, normalized],
                (err, result) => {
                    if (err) return reject(err);
                    resolve(result.rows[0] ? new PromoCode(result.rows[0]) : null);
                }
            );
        });
    }

    static async findById(id) {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM promo_codes WHERE id = $1', [id], (err, result) => {
                if (err) return reject(err);
                resolve(result.rows[0] ? new PromoCode(result.rows[0]) : null);
            });
        });
    }

    static async findByStoreId(storeId) {
        return new Promise((resolve, reject) => {
            db.query(
                'SELECT * FROM promo_codes WHERE store_id = $1 ORDER BY created_at DESC',
                [storeId],
                (err, result) => {
                    if (err) return reject(err);
                    resolve(result.rows.map(row => new PromoCode(row)));
                }
            );
        });
    }

    static async update(id, data) {
        const fields = [];
        const values = [];
        let paramIndex = 1;

        const allowedFields = ['code', 'discount_type', 'discount_value', 'min_order_amount',
                               'max_uses', 'active', 'starts_at', 'expires_at', 'code_type'];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                fields.push(`${field} = $${paramIndex}`);
                values.push(field === 'code' ? data[field].toUpperCase() : data[field]);
                paramIndex++;
            }
        }

        if (fields.length === 0) return null;

        values.push(id);
        return new Promise((resolve, reject) => {
            db.query(
                `UPDATE promo_codes SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
                values,
                (err, result) => {
                    if (err) return reject(err);
                    resolve(result.rows[0] ? new PromoCode(result.rows[0]) : null);
                }
            );
        });
    }

    static async delete(id) {
        return new Promise((resolve, reject) => {
            db.query('DELETE FROM promo_codes WHERE id = $1', [id], (err, result) => {
                if (err) return reject(err);
                resolve(result.rowCount > 0);
            });
        });
    }

    static async incrementUsage(id) {
        return new Promise((resolve, reject) => {
            db.query(
                'UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1 RETURNING *',
                [id],
                (err, result) => {
                    if (err) return reject(err);
                    resolve(result.rows[0] ? new PromoCode(result.rows[0]) : null);
                }
            );
        });
    }

    static async recordUsage(promoCodeId, orderData) {
        return new Promise((resolve, reject) => {
            db.query(
                `INSERT INTO promo_code_usage (promo_code_id, order_id, customer_email, customer_phone, discount_applied)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [promoCodeId, orderData.orderId, orderData.email, orderData.phone, orderData.discountApplied],
                (err, result) => {
                    if (err) return reject(err);
                    resolve(result.rows[0]);
                }
            );
        });
    }

    // Validate promo code and calculate discount
    validate(orderTotal) {
        if (!this.active) {
            return { valid: false, error: 'Промокод неактивний' };
        }

        const now = new Date();
        if (this.starts_at && new Date(this.starts_at) > now) {
            return { valid: false, error: 'Промокод ще не діє' };
        }
        if (this.expires_at && new Date(this.expires_at) < now) {
            return { valid: false, error: 'Термін дії промокоду закінчився' };
        }

        if (this.max_uses !== null && this.used_count >= this.max_uses) {
            return { valid: false, error: 'Промокод вичерпано' };
        }

        if (orderTotal < this.min_order_amount) {
            return { valid: false, error: `Мінімальна сума замовлення ${this.min_order_amount} грн` };
        }

        let discount = 0;
        switch (this.discount_type) {
            case 'percentage':
                discount = Math.round(orderTotal * this.discount_value / 100 * 100) / 100;
                break;
            case 'fixed_amount':
                discount = Math.min(this.discount_value, orderTotal);
                break;
            case 'free_delivery':
                discount = 0; // delivery fee handled separately
                break;
        }

        return {
            valid: true,
            discount_type: this.discount_type,
            discount_value: this.discount_value,
            discount_amount: discount,
            free_delivery: this.discount_type === 'free_delivery',
        };
    }
}

module.exports = PromoCode;
