const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');

class InvoiceConnector {
    constructor({ id, mono_id, order_shopify_id, orderRef }) {
        this.id = id;
        this.mono_id = mono_id;
        this.order_shopify_id = order_shopify_id;
        this.orderRef = orderRef;
    }

    // Альтернативный метод создания с использованием базы данных для генерации UUID
    async createWithDbUuid() {
        return new Promise((resolve, reject) => {
            db.query(
                `INSERT INTO invoice_connectors (id, mono_id, order_shopify_id, "orderRef") 
                 VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`,
                [null, null, null],
                (err, result) => {
                    if (err) {
                        console.error('Database insert error with gen_random_uuid:', err);
                        reject(err);
                        return;
                    }
                    const newId = result.rows[0].id;
                    this.id = newId;
                    this.mono_id = null;
                    this.order_shopify_id = null;
                    this.orderRef = null;
                    console.log(`Successfully created with DB UUID: ${newId}`);
                    resolve(this);
                }
            );
        });
    }

    // Создать новый рядок с уникальным UUID
    async create() {
        return new Promise(async (resolve, reject) => {
            try {
                // Проверяем подключение к базе данных
                await new Promise((resolveTest, rejectTest) => {
                    db.query('SELECT 1', (err, result) => {
                        if (err) {
                            console.error('Database connection test failed:', err);
                            rejectTest(err);
                            return;
                        }
                        resolveTest(result);
                    });
                });
            } catch (error) {
                reject(new Error(`Ошибка подключения к базе данных: ${error.message}`));
                return;
            }

            let attempts = 0;
            const maxAttempts = 5;
            
            while (attempts < maxAttempts) {
                try {
                    const newId = uuidv4();
                    console.log(`Attempt ${attempts + 1}: Generated UUID: ${newId}`);
                    
                    // Проверяем, что UUID не занят
                    const existing = await InvoiceConnector.findById(newId);
                    if (existing) {
                        console.log(`UUID ${newId} already exists, trying again...`);
                        attempts++;
                        continue;
                    }
                    
                    // Вставляем новый рядок без mono_id, order_shopify_id и orderRef
                    const result = await new Promise((resolveInsert, rejectInsert) => {
                        db.query(
                            `INSERT INTO invoice_connectors (id, mono_id, order_shopify_id, "orderRef") 
                             VALUES ($1, $2, $3, $4)`,
                            [newId, null, null, null],
                            function (err, result) {
                                if (err) {
                                    console.error('Database insert error:', err);
                                    rejectInsert(err);
                                    return;
                                }
                                console.log(`Successfully inserted UUID: ${newId}`);
                                resolveInsert(result);
                            }
                        );
                    });
                    
                    this.id = newId;
                    this.mono_id = null;
                    this.order_shopify_id = null;
                    this.orderRef = null;
                    resolve(this);
                    return;
                    
                } catch (error) {
                    console.error(`Attempt ${attempts + 1} failed:`, error);
                    attempts++;
                    if (attempts >= maxAttempts) {
                        reject(new Error(`Не удалось создать уникальный UUID после ${maxAttempts} попыток. Последняя ошибка: ${error.message}`));
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

    // Добавить orderRef к существующему ряду
    async addOrderRef(orderRef) {
        return new Promise((resolve, reject) => {
            db.query(
                `UPDATE invoice_connectors 
                 SET "orderRef" = $1 
                 WHERE id = $2 AND "orderRef" IS NULL`,
                [orderRef, this.id],
                function (err, result) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    if (result.rowCount === 0) {
                        reject(new Error('Рядок не найден или уже имеет orderRef'));
                        return;
                    }
                    this.orderRef = orderRef;
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
                    console.error('Database query error in findById:', err);
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

    // Поиск по orderRef
    static async findByOrderRef(orderRef) {
        return new Promise((resolve, reject) => {
            db.query('SELECT * FROM invoice_connectors WHERE "orderRef" = $1', [orderRef], (err, result) => {
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

    // Получить данные коннектора по ID (mono_id, order_shopify_id и orderRef)
    static async getConnectorData(connectorId) {
        return new Promise((resolve, reject) => {
            db.query(
                'SELECT id, mono_id, order_shopify_id, "orderRef" FROM invoice_connectors WHERE id = $1',
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
                            order_shopify_id: row.order_shopify_id,
                            orderRef: row.orderRef
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
