const db = require('../config/db');

class Invoice {
    constructor({ id, status, storeid}) {
        this.id = id;
        this.status = status;
        this.storeid = storeid;
    }

    async save() {
        return new Promise(async (resolve, reject) => {
            try {
                // Проверяем подключение к базе данных
                await new Promise((resolveTest, rejectTest) => {
                    db.query('SELECT 1', (err, result) => {
                        if (err) {
                            console.error('Database connection test failed in Invoice.save:', err);
                            rejectTest(err);
                            return;
                        }
                        resolveTest(result);
                    });
                });
            } catch (error) {
                reject(new Error(`Ошибка подключения к базе данных в Invoice.save: ${error.message}`));
                return;
            }
            db.query(
                `INSERT INTO mono_invoices (id, status, storeid) 
         VALUES ($1, $2, $3)`,
                [this.id, this.status, this.storeid],
                function (err, result) {
                    if (err) {
                        console.error('Database insert error in Invoice.save:', err);
                        reject(err);
                        return;
                    }
                    console.log(`Successfully saved invoice: ${this.id}`);
                    resolve(result);
                }.bind(this)
            );
        });
    }


    async changeStatus() {
        return new Promise(async (resolve, reject) => {
            try {
                // Проверяем подключение к базе данных
                await new Promise((resolveTest, rejectTest) => {
                    db.query('SELECT 1', (err, result) => {
                        if (err) {
                            console.error('Database connection test failed in Invoice.changeStatus:', err);
                            rejectTest(err);
                            return;
                        }
                        resolveTest(result);
                    });
                });
            } catch (error) {
                reject(new Error(`Ошибка подключения к базе данных в Invoice.changeStatus: ${error.message}`));
                return;
            }
            db.query(
                `UPDATE mono_invoices set status = TRUE 
         Where id = $1`,
                [this.id],
                function (err, result) {
                    if (err) {
                        console.error('Database update error in Invoice.changeStatus:', err);
                        reject(err);
                        return;
                    }
                    if (result.rowCount === 0) {
                        reject(new Error('Invoice не найден или уже обновлен'));
                        return;
                    }
                    console.log(`Successfully updated invoice status: ${this.id}`);
                    resolve(result);
                }.bind(this)
            );
        });
    }

    static async findById(id) {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM mono_invoices WHERE id = $1', [id], (err, result) => {
                if (err) {
                    console.error('Database query error in Invoice.findById:', err);
                    reject(err);
                    return;
                }
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