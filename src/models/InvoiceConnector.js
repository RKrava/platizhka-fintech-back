const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');

class InvoiceConnector {
    constructor({ id, mono_id, order_shopify_id }) {
        this.id = id;
        this.mono_id = mono_id;
        this.order_shopify_id = order_shopify_id;
    }

    // Создать новый рядок с уникальным UUID
    async create() {
        return new Promise(async (resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 5;
            
            while (attempts < maxAttempts) {
                try {
                    const newId = uuidv4();
                    
                    // Проверяем, что UUID не занят
                    const existing = await this.findById(newId);
                    if (existing) {
                        attempts++;
                        continue;
                    }
                    
                    // Вставляем новый рядок без mono_id и order_shopify_id
                    const result = await new Promise((resolveInsert, rejectInsert) => {
                        db.query(
                            `INSERT INTO invoice_connectors (id, mono_id, order_shopify_id) 
                             VALUES ($1, $2, $3)`,
                            [newId, null, null],
                            function (err, result) {
                                if (err) rejectInsert(err);
                                resolveInsert(result);
                            }
                        );
                    });
                    
                    this.id = newId;
                    this.mono_id = null;
                    this.order_shopify_id = null;
                    resolve(this);
                    return;
                    
                } catch (error) {
                    attempts++;
                    if (attempts >= maxAttempts) {
                        reject(new Error('Не удалось создать уникальный UUID после нескольких попыток'));
                        return;
                    }
                }
            }
        });
    }

    // Добавить mono_id к существующему ряду
    async addMonoId(monoId) {
        return new Promise((resolve, reject) => {
            db.query(
                `UPDATE invoice_connectors 
                 SET mono_id = $1 
                 WHERE id = $2 AND mono_id IS NULL`,
                [monoId, this.id],
                function (err, result) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    if (result.rowCount === 0) {
                        reject(new Error('Рядок не найден или уже имеет mono_id'));
                        return;
                    }
                    this.mono_id = monoId;
                    resolve(this);
                }.bind(this)
            );
        });
    }

    // Добавить order_shopify_id к существующему ряду
    async addShopifyOrderId(shopifyOrderId) {
        return new Promise((resolve, reject) => {
            db.query(
                `UPDATE invoice_connectors 
                 SET order_shopify_id = $1 
                 WHERE id = $2 AND order_shopify_id IS NULL`,
                [shopifyOrderId, this.id],
                function (err, result) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    if (result.rowCount === 0) {
                        reject(new Error('Рядок не найден или уже имеет order_shopify_id'));
                        return;
                    }
                    this.order_shopify_id = shopifyOrderId;
                    resolve(this);
                }.bind(this)
            );
        });
    }

    // Поиск по обычному UUID
    static async findById(id) {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM invoice_connectors WHERE id = $1', [id], (err, result) => {
                if (err) {
                    reject(err);
                    return;
                }
                const row = result?.rows[0];
                if (row) {
                    resolve(new InvoiceConnector(row));
                } else {
                    resolve(null);
                }
            });
        });
    }

    // Поиск по mono_id
    static async findByMonoId(monoId) {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM invoice_connectors WHERE mono_id = $1', [monoId], (err, result) => {
                if (err) {
                    reject(err);
                    return;
                }
                const row = result?.rows[0];
                if (row) {
                    resolve(new InvoiceConnector(row));
                } else {
                    resolve(null);
                }
            });
        });
    }

    // Поиск по order_shopify_id
    static async findByShopifyOrderId(shopifyOrderId) {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM invoice_connectors WHERE order_shopify_id = $1', [shopifyOrderId], (err, result) => {
                if (err) {
                    reject(err);
                    return;
                }
                const row = result?.rows[0];
                if (row) {
                    resolve(new InvoiceConnector(row));
                } else {
                    resolve(null);
                }
            });
        });
    }

    // Получить все неиспользованные коннекторы (без mono_id)
    static async getUnusedConnectors() {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM invoice_connectors WHERE mono_id IS NULL', (err, result) => {
                if (err) {
                    reject(err);
                    return;
                }
                const connectors = result.rows.map(row => new InvoiceConnector(row));
                resolve(connectors);
            });
        });
    }

    // Удалить коннектор
    async delete() {
        return new Promise((resolve, reject) => {
            db.query(
                'DELETE FROM invoice_connectors WHERE id = $1',
                [this.id],
                function (err, result) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(result);
                }
            );
        });
    }

    // Получить данные коннектора по ID (mono_id и order_shopify_id)
    static async getConnectorData(connectorId) {
        return new Promise((resolve, reject) => {
            db.query(
                'SELECT id, mono_id, order_shopify_id FROM invoice_connectors WHERE id = $1',
                [connectorId],
                function (err, result) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    const row = result?.rows[0];
                    if (row) {
                        resolve({
                            id: row.id,
                            mono_id: row.mono_id,
                            order_shopify_id: row.order_shopify_id
                        });
                    } else {
                        resolve(null);
                    }
                }
            );
        });
    }
}

module.exports = InvoiceConnector;
