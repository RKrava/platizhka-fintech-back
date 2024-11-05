const db = require('../config/db');

class Invoice {
    constructor({ id, status, storeid}) {
        this.id = id;
        this.status = status;
        this.storeid = storeid;
    }

    async save() {
        return new Promise((resolve, reject) => {
            db.query(
                `INSERT INTO mono_invoices (id, status, storeid) 
         VALUES ($1, $2, $3)`,
                [this.id, this.status, this.storeid],
                function (err, result) {
                    if (err) reject(err);
                    resolve(result);
                }
            );
        });
    }


    async changeStatus() {
        return new Promise((resolve, reject) => {
            db.query(
                `UPDATE mono_invoices set status = TRUE 
         Where id = $1`,
                [this.id],
                function (err, result) {
                    if (err) reject(err);
                    resolve(result);
                }
            );
        });
    }

    static async findById(id) {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM mono_invoices WHERE id = $1', [id], (err, result) => {
                if (err) reject(err);
                const row = result?.rows[0]
                if (row) {
                    resolve(new Invoice(row));
                } else {
                    resolve(null);
                }
            });
        });
    }
}

module.exports = Invoice;