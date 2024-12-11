const db = require('../config/db');

class User {
   constructor({ email, password, telegram, referred, average_income }) {
    this.email = email;
    this.password = password;
    this.telegram = telegram;
    this.referred = referred;
    this.average_income = average_income;
   }

   async save() {
    const registration_date = new Date().toISOString();

    return new Promise((resolve, reject) => {
      db.query(
        `INSERT INTO users (email, password, telegram, referred, average_income, registration_date) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [this.email, this.password, this.telegram, this.referred, this.average_income, registration_date],
        function (err, results) {
          if (err) reject(err);
          const userId = results.rows[0].id;
          resolve(userId);
        }
      );
    });
  }

  static async findByUsername(email) {
    return new Promise((resolve, reject) => {
      db.query('SELECT * FROM users WHERE email = $1', [email], (err, row) => {
        if (err) reject(err);
        resolve(row.rows[0]);
      });
    });
  }

  static async GetAllUsers() {
    return new Promise((resolve, reject) => {
      db.query('SELECT * FROM users', (err, rows) => {
        if (err) reject(err);
        resolve(rows.rows);
      });
    });
  }

  static async findByUserId(id) {
    return new Promise((resolve, reject) => {
      db.query('SELECT * FROM users WHERE id = $1', [id], (err, row) => {
        if (err) reject(err);
        resolve(row.rows[0]);
      });
    });
  }

  static async updatePassword(userId, newPassword) {
    return new Promise((resolve, reject) => {
      db.query('UPDATE users SET password = $1 WHERE id = $2', [newPassword, userId], function(err) {
        if (err) reject(err);
        resolve(this.changes);
      });
    });
  }
}

module.exports = User;