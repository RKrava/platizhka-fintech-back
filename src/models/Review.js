const db = require('../config/db');

class Review {
    constructor(data) {
        this.storeId = data.storeId;
        this.type = data.type;           // 'complaint' | 'survey'
        this.rating = data.rating;
        this.name = data.name || null;
        this.contact = data.contact || null;
        this.orderId = data.orderId || null;
        this.problem = data.problem || null;
        this.source = data.source || null;
        this.reorder = data.reorder || null;
        this.deliverySpeed = data.deliverySpeed || null;
        this.quality = data.quality || null;
        this.packaging = data.packaging || null;
        this.improve = data.improve || null;
        this.wishlist = data.wishlist || null;
        this.urlParams = data.urlParams || null;
    }

    async save() {
        const result = await db.query(
            `INSERT INTO reviews
                (store_id, type, rating, name, contact, order_id,
                 problem, source, reorder, delivery_speed, quality, packaging,
                 improve, wishlist, url_params)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             RETURNING id, created_at`,
            [
                this.storeId, this.type, this.rating, this.name, this.contact, this.orderId,
                this.problem, this.source, this.reorder, this.deliverySpeed, this.quality, this.packaging,
                this.improve, this.wishlist, this.urlParams ? JSON.stringify(this.urlParams) : null
            ]
        );
        return result.rows[0];
    }

    static async findByStore(storeId, { type, status, limit = 50, offset = 0 } = {}) {
        let query = `SELECT * FROM reviews WHERE store_id = $1`;
        const params = [storeId];
        let idx = 2;

        if (type) {
            query += ` AND type = $${idx++}`;
            params.push(type);
        }
        if (status) {
            query += ` AND status = $${idx++}`;
            params.push(status);
        }

        query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(limit, offset);

        const result = await db.query(query, params);
        return result.rows;
    }

    static async countByStore(storeId) {
        const result = await db.query(
            `SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE type = 'complaint') AS complaints,
                COUNT(*) FILTER (WHERE type = 'survey') AS surveys,
                COUNT(*) FILTER (WHERE status = 'new') AS new_count,
                ROUND(AVG(rating), 1) AS avg_rating
             FROM reviews WHERE store_id = $1`,
            [storeId]
        );
        return result.rows[0];
    }

    static async updateStatus(id, status, notes) {
        const result = await db.query(
            `UPDATE reviews SET status = $1, notes = $2, updated_at = NOW()
             WHERE id = $3 RETURNING *`,
            [status, notes || null, id]
        );
        return result.rows[0];
    }
}

module.exports = Review;
