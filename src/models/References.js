const db = require('../config/db');

class Reference {
    constructor({ base64 }) {
        this.base64 = base64;
    }

    async save() {
        return new Promise((resolve, reject) => {
            db.query(
                `INSERT INTO mono_references (base64) 
                 VALUES ($1)
                 RETURNING id`,
                [this.base64],
                function (err, result) {
                    if (err) reject(err);
                    resolve(result.rows[0].id);
                }
            );
        });
    }

    static async findById(id) {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM mono_references WHERE id = $1', [id], (err, result) => {
                if (err) reject(err);
                resolve(result?.rows[0]);
            });
        });
    }
}



module.exports = Reference;