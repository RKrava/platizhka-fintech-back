const db = require('../config/db');

class GATrackingData {
    constructor({ id, gclid, clientId, cartDataGA4 }) {
        this.id = id;
        this.gclid = gclid;
        this.clientId = clientId;
        this.cartDataGA4 = cartDataGA4;
    }

    async save() {
        return new Promise((resolve, reject) => {
            db.query(
                `INSERT INTO ga_tracking_data (id, gclid, client_id, cart_data_ga4) 
                 VALUES ($1, $2, $3, $4)`,
                [this.id, this.gclid, this.clientId, this.cartDataGA4],
                function (err, result) {
                    if (err) reject(err);
                    resolve(result);
                }
            );
        });
    }

    static async findById(id) {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM ga_tracking_data WHERE id = $1', [id], (err, result) => {
                if (err) reject(err);
                resolve(result?.rows[0]);
            });
        });
    }
}

module.exports = GATrackingData;