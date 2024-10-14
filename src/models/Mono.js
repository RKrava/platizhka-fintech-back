const db = require('../config/db');

class Mono {
    constructor({ token, store_id }) {
        this.token = token;
        this.store_id = store_id;
    }

    async save() {
        return new Promise((resolve, reject) => {
            db.query(
                `INSERT INTO mono (token, store_id) 
         VALUES ($1, $2)`,
                [this.token, this.store_id],
                function (err, result) {
                    if (err) reject(err);
                    resolve(result);
                }
            );
        });
    }

    static async findByStoreId(id) {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM mono WHERE id = $1', [id], (err, row) => {
                if (err) reject(err);
                resolve(row.rows[0]);
            });
        });
    }
}

module.exports = Mono;