const db = require('../config/db');

class AbandonedCheckout {
    constructor({ storeId, cartToken, sessionId, firstName, lastName, phone, email, city, warehouse, novaPoshtaType, paymentMethod, marketingConsent }) {
        this.storeId = storeId;
        this.cartToken = cartToken;
        this.sessionId = sessionId;
        this.firstName = firstName;
        this.lastName = lastName;
        this.phone = phone;
        this.email = email;
        this.city = city;
        this.warehouse = warehouse;
        this.novaPoshtaType = novaPoshtaType;
        this.paymentMethod = paymentMethod;
        this.marketingConsent = marketingConsent || false;
    }

    async upsert() {
        const result = await db.query(
            `INSERT INTO abandoned_checkouts
                (store_id, cart_token, session_id, first_name, last_name, phone, email, city, warehouse, nova_poshta_type, payment_method, marketing_consent, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
             ON CONFLICT (session_id, store_id) DO UPDATE SET
                cart_token = COALESCE(EXCLUDED.cart_token, abandoned_checkouts.cart_token),
                first_name = COALESCE(EXCLUDED.first_name, abandoned_checkouts.first_name),
                last_name = COALESCE(EXCLUDED.last_name, abandoned_checkouts.last_name),
                phone = COALESCE(EXCLUDED.phone, abandoned_checkouts.phone),
                email = COALESCE(EXCLUDED.email, abandoned_checkouts.email),
                city = COALESCE(EXCLUDED.city, abandoned_checkouts.city),
                warehouse = COALESCE(EXCLUDED.warehouse, abandoned_checkouts.warehouse),
                nova_poshta_type = COALESCE(EXCLUDED.nova_poshta_type, abandoned_checkouts.nova_poshta_type),
                payment_method = COALESCE(EXCLUDED.payment_method, abandoned_checkouts.payment_method),
                marketing_consent = EXCLUDED.marketing_consent,
                updated_at = NOW()
             RETURNING id, recovery_token`,
            [
                this.storeId, this.cartToken, this.sessionId,
                this.firstName, this.lastName, this.phone, this.email,
                this.city, this.warehouse, this.novaPoshtaType,
                this.paymentMethod, this.marketingConsent
            ]
        );
        return result.rows[0];
    }

    static async findByRecoveryToken(token) {
        const result = await db.query(
            `SELECT * FROM abandoned_checkouts WHERE recovery_token = $1`,
            [token]
        );
        return result.rows[0] || null;
    }

    static async findAbandoned(storeId) {
        const result = await db.query(
            `SELECT id, store_id, cart_token, first_name, last_name, phone, email,
                    city, warehouse, nova_poshta_type, payment_method, marketing_consent,
                    recovery_token, status, created_at, updated_at
             FROM abandoned_checkouts
             WHERE store_id = $1 AND status = 'abandoned'
             ORDER BY updated_at DESC`,
            [storeId]
        );
        return result.rows;
    }

    static async markCompleted(cartToken, storeId, phone, email) {
        // Match by cart_token OR phone OR email within the same store
        const conditions = [];
        const params = [storeId];
        let idx = 2;

        if (cartToken) {
            conditions.push(`cart_token = $${idx++}`);
            params.push(cartToken);
        }
        if (phone) {
            conditions.push(`phone = $${idx++}`);
            params.push(phone);
        }
        if (email) {
            conditions.push(`email = $${idx++}`);
            params.push(email);
        }

        if (conditions.length === 0) return;

        await db.query(
            `UPDATE abandoned_checkouts SET status = 'completed', updated_at = NOW()
             WHERE store_id = $1 AND status = 'abandoned' AND (${conditions.join(' OR ')})`,
            params
        );
    }
}

module.exports = AbandonedCheckout;
