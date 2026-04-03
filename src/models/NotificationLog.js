const db = require('../config/db');

class NotificationLog {
    static async save({ abandonedCheckoutId, storeId, step, channel, recipient, messageId }) {
        const result = await db.query(
            `INSERT INTO notification_log (abandoned_checkout_id, store_id, step, channel, recipient, message_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [abandonedCheckoutId, storeId, step, channel, recipient, messageId || null]
        );
        return result.rows[0];
    }

    static async getLastStep(abandonedCheckoutId) {
        const result = await db.query(
            `SELECT step, sent_at FROM notification_log
             WHERE abandoned_checkout_id = $1
             ORDER BY step DESC LIMIT 1`,
            [abandonedCheckoutId]
        );
        return result.rows[0] || null;
    }

    static async getStepsForCheckout(abandonedCheckoutId) {
        const result = await db.query(
            `SELECT step, channel, status, sent_at FROM notification_log
             WHERE abandoned_checkout_id = $1
             ORDER BY step ASC`,
            [abandonedCheckoutId]
        );
        return result.rows;
    }

    static async getStepCounts(checkoutIds) {
        if (!checkoutIds.length) return {};
        const result = await db.query(
            `SELECT abandoned_checkout_id, MAX(step) as max_step
             FROM notification_log
             WHERE abandoned_checkout_id = ANY($1)
             GROUP BY abandoned_checkout_id`,
            [checkoutIds]
        );
        const map = {};
        result.rows.forEach(r => { map[r.abandoned_checkout_id] = r.max_step; });
        return map;
    }
}

module.exports = NotificationLog;
