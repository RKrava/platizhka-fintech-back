const db = require('../config/db');

class PromoCodeOrder {
    /**
     * Record an order that used a promo code
     */
    static async record({ storeId, promoCode, promoCodeId, orderId, orderTotal, discountAmount, discountType, customerName, customerEmail, customerPhone, paymentMethod }) {
        return new Promise((resolve, reject) => {
            db.query(
                `INSERT INTO promo_code_orders
                 (store_id, promo_code, promo_code_id, order_id, order_total, discount_amount, discount_type, customer_name, customer_email, customer_phone, payment_method)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 RETURNING *`,
                [storeId, promoCode, promoCodeId || null, orderId || null, orderTotal || 0, discountAmount || 0, discountType || null, customerName || null, customerEmail || null, customerPhone || null, paymentMethod || null],
                (err, result) => {
                    if (err) {
                        console.error('[PromoCodeOrder] Error recording:', err.message);
                        return resolve(null); // Don't break order flow
                    }
                    resolve(result.rows[0]);
                }
            );
        });
    }

    /**
     * Get stats per promo code for a store
     */
    static async getStatsByStore(storeId) {
        return new Promise((resolve, reject) => {
            db.query(
                `SELECT
                    promo_code,
                    COUNT(*) as total_orders,
                    SUM(order_total) as total_revenue,
                    SUM(discount_amount) as total_discount,
                    ROUND(AVG(order_total)::numeric, 2) as avg_order,
                    MIN(created_at) as first_order,
                    MAX(created_at) as last_order
                 FROM promo_code_orders
                 WHERE store_id = $1
                 GROUP BY promo_code
                 ORDER BY total_revenue DESC`,
                [storeId],
                (err, result) => {
                    if (err) return reject(err);
                    resolve(result.rows);
                }
            );
        });
    }

    /**
     * Get detailed orders for a specific promo code
     */
    static async getOrdersByCode(storeId, promoCode) {
        return new Promise((resolve, reject) => {
            db.query(
                `SELECT * FROM promo_code_orders
                 WHERE store_id = $1 AND promo_code = $2
                 ORDER BY created_at DESC`,
                [storeId, promoCode.toUpperCase()],
                (err, result) => {
                    if (err) return reject(err);
                    resolve(result.rows);
                }
            );
        });
    }

    /**
     * Get stats filtered by date range
     */
    static async getStatsByDateRange(storeId, from, to) {
        return new Promise((resolve, reject) => {
            db.query(
                `SELECT
                    promo_code,
                    COUNT(*) as total_orders,
                    SUM(order_total) as total_revenue,
                    SUM(discount_amount) as total_discount,
                    ROUND(AVG(order_total)::numeric, 2) as avg_order,
                    MIN(created_at) as first_order,
                    MAX(created_at) as last_order
                 FROM promo_code_orders
                 WHERE store_id = $1 AND created_at >= $2 AND created_at <= $3
                 GROUP BY promo_code
                 ORDER BY total_revenue DESC`,
                [storeId, from, to],
                (err, result) => {
                    if (err) return reject(err);
                    resolve(result.rows);
                }
            );
        });
    }

    /**
     * Public stats for a specific promo code (across all stores or by store)
     */
    static async getPublicStatsByCode(code, storeId) {
        const query = storeId
            ? `SELECT
                    COUNT(*) as total_orders,
                    COALESCE(SUM(order_total), 0) as total_revenue,
                    COALESCE(SUM(discount_amount), 0) as total_discount,
                    ROUND(COALESCE(AVG(order_total), 0)::numeric, 2) as avg_order,
                    MIN(created_at) as first_order,
                    MAX(created_at) as last_order
               FROM promo_code_orders
               WHERE promo_code = $1 AND store_id = $2`
            : `SELECT
                    COUNT(*) as total_orders,
                    COALESCE(SUM(order_total), 0) as total_revenue,
                    COALESCE(SUM(discount_amount), 0) as total_discount,
                    ROUND(COALESCE(AVG(order_total), 0)::numeric, 2) as avg_order,
                    MIN(created_at) as first_order,
                    MAX(created_at) as last_order
               FROM promo_code_orders
               WHERE promo_code = $1`;
        const params = storeId ? [code.toUpperCase(), storeId] : [code.toUpperCase()];
        return new Promise((resolve, reject) => {
            db.query(query, params, (err, result) => {
                if (err) return reject(err);
                resolve(result.rows[0] || null);
            });
        });
    }

    /**
     * Public order list for a specific promo code (limited info)
     */
    static async getPublicOrdersByCode(code, storeId) {
        const query = storeId
            ? `SELECT order_total, discount_amount, payment_method, created_at
               FROM promo_code_orders
               WHERE promo_code = $1 AND store_id = $2
               ORDER BY created_at DESC`
            : `SELECT order_total, discount_amount, payment_method, created_at
               FROM promo_code_orders
               WHERE promo_code = $1
               ORDER BY created_at DESC`;
        const params = storeId ? [code.toUpperCase(), storeId] : [code.toUpperCase()];
        return new Promise((resolve, reject) => {
            db.query(query, params, (err, result) => {
                if (err) return reject(err);
                resolve(result.rows);
            });
        });
    }
}

module.exports = PromoCodeOrder;
