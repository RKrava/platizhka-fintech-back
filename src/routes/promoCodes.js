const express = require('express');
const router = express.Router();
const PromoCode = require('../models/PromoCode');

// Валидация промокода (фронтенд чекаут)
router.post('/validate', async (req, res) => {
    try {
        const { code, storeId, orderTotal } = req.body;

        if (!code || !storeId) {
            return res.status(400).json({ success: false, error: 'code та storeId обов\'язкові' });
        }

        const promo = await PromoCode.findByCode(storeId, code);
        if (!promo) {
            return res.status(200).json({ success: false, error: 'Промокод не знайдено' });
        }

        const result = promo.validate(orderTotal || 0);
        if (!result.valid) {
            return res.status(200).json({ success: false, error: result.error });
        }

        return res.json({
            success: true,
            promoCodeId: promo.id,
            code: promo.code,
            discount_type: result.discount_type,
            discount_value: result.discount_value,
            discount_amount: result.discount_amount,
            free_delivery: result.free_delivery,
        });
    } catch (error) {
        console.error('Error validating promo code:', error);
        res.status(500).json({ success: false, error: 'Помилка при перевірці промокоду' });
    }
});

// --- CRUD для админки ---

// Получить все промокоды магазина
router.get('/:storeId', async (req, res) => {
    try {
        const promos = await PromoCode.findByStoreId(req.params.storeId);
        res.json(promos);
    } catch (error) {
        console.error('Error fetching promo codes:', error);
        res.status(500).json({ error: 'Failed to fetch promo codes' });
    }
});

// Создать промокод
router.post('/', async (req, res) => {
    try {
        const { store_id, code, discount_type, discount_value, min_order_amount, max_uses, active, starts_at, expires_at } = req.body;

        if (!store_id || !code || !discount_type) {
            return res.status(400).json({ error: 'store_id, code, discount_type обов\'язкові' });
        }

        if (!['percentage', 'fixed_amount', 'free_delivery'].includes(discount_type)) {
            return res.status(400).json({ error: 'discount_type має бути: percentage, fixed_amount або free_delivery' });
        }

        const promo = new PromoCode({
            store_id,
            code,
            discount_type,
            discount_value: discount_value || 0,
            min_order_amount: min_order_amount || 0,
            max_uses: max_uses || null,
            active: active !== undefined ? active : true,
            starts_at: starts_at || new Date(),
            expires_at: expires_at || null,
        });

        const saved = await promo.save();
        res.status(201).json(saved);
    } catch (error) {
        if (error.code === '23505') { // unique constraint violation
            return res.status(409).json({ error: 'Промокод з таким кодом вже існує' });
        }
        console.error('Error creating promo code:', error);
        res.status(500).json({ error: 'Failed to create promo code' });
    }
});

// Обновить промокод
router.put('/:id', async (req, res) => {
    try {
        const updated = await PromoCode.update(req.params.id, req.body);
        if (!updated) {
            return res.status(404).json({ error: 'Promo code not found' });
        }
        res.json(updated);
    } catch (error) {
        console.error('Error updating promo code:', error);
        res.status(500).json({ error: 'Failed to update promo code' });
    }
});

// Удалить промокод
router.delete('/:id', async (req, res) => {
    try {
        const deleted = await PromoCode.delete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: 'Promo code not found' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting promo code:', error);
        res.status(500).json({ error: 'Failed to delete promo code' });
    }
});

module.exports = router;
