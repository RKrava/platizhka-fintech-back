const db = require('../config/db');

class Order {
    constructor({ firstName, lastName, phone, note, email, address, city, country, store_id, checkoutData }) {
        this.firstName = firstName;
        this.lastName = lastName;
        this.phone = phone;
        this.note = note;
        this.email = email;
        this.address = address;
        this.city = city;
        this.country = country;
        this.store_id = store_id;
        this.checkoutData = checkoutData
    }

    async save() {
        const date = new Date().toISOString();

        return new Promise((resolve, reject) => {
            db.query(
                `INSERT INTO orders (first_name, last_name, phone, note, email, address, city, country, date, store_id, checkoutData) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [this.firstName, this.lastName, this.phone, this.note, this.email, this.address, this.city,
                    this.country, date, this.store_id, this.checkoutData],
                function (err, result) {
                    if (err) reject(err);
                    resolve(result);
                }
            );
        });
    }
}

module.exports = Order;