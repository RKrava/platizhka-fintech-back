const db = require('../config/db');

class Analytics {
    constructor({ transaction_id, value }) {
        this.transaction_id = transaction_id;
        this.value = value;
    }

    async save() {
        return new Promise((resolve, reject) => {
            db.query(
                `INSERT INTO analytics_events_log (transaction_id, value) 
                 VALUES ($1, $2)`,
                [this.transaction_id, this.value],
                function (err, result) {
                    if (err) reject(err);
                    resolve(result);
                }
            );
        });
    }

    static async findByTransactionId(transaction_id) {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM analytics_events_log WHERE transaction_id = $1', [transaction_id], (err, result) => {
                if (err) reject(err);
                resolve(result?.rows[0]);
            });
        });
    }
}

module.exports = Analytics;