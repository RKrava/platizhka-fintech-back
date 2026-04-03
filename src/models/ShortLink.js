const db = require('../config/db');
const crypto = require('crypto');

class ShortLink {
    static generateCode() {
        return crypto.randomBytes(4).toString('base64url').substring(0, 6);
    }

    static async create({ targetUrl, storeId, abandonedCheckoutId, step }) {
        // Try up to 3 times in case of code collision
        for (let i = 0; i < 3; i++) {
            const code = ShortLink.generateCode();
            try {
                const result = await db.query(
                    `INSERT INTO short_links (code, target_url, store_id, abandoned_checkout_id, step)
                     VALUES ($1, $2, $3, $4, $5)
                     RETURNING code`,
                    [code, targetUrl, storeId || null, abandonedCheckoutId || null, step || null]
                );
                return result.rows[0].code;
            } catch (err) {
                if (err.code === '23505' && i < 2) continue; // unique violation, retry
                throw err;
            }
        }
    }

    static async findByCode(code) {
        const result = await db.query(
            `SELECT * FROM short_links WHERE code = $1`,
            [code]
        );
        return result.rows[0] || null;
    }

    static async incrementClicks(code) {
        await db.query(
            `UPDATE short_links SET clicks = clicks + 1 WHERE code = $1`,
            [code]
        );
    }

    static async getStats(storeId) {
        const result = await db.query(
            `SELECT sl.step, COUNT(*) as total_links, SUM(sl.clicks) as total_clicks
             FROM short_links sl
             WHERE sl.store_id = $1 AND sl.step IS NOT NULL
             GROUP BY sl.step
             ORDER BY sl.step`,
            [storeId]
        );
        return result.rows;
    }
}

module.exports = ShortLink;
