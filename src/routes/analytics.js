const express = require('express');
const Analytics = require('../models/Analytics');
const router = express.Router();

router.post('/log-analytics', async (req, res) => {
    try {
        const { transaction_id, value } = req.body;

        if (!transaction_id || !value) {
            return res.status(400).json({ message: 'Необходимы transaction_id и value' });
        }

        const analytics = new Analytics({ transaction_id, value });
        await analytics.save();

        res.status(201).json({ message: 'Событие успешно залогировано' });
    } catch (error) {
        console.error('Ошибка при логировании события:', error);
        res.status(500).json({ message: 'Ошибка сервера', error: error.message });
    }
});

router.get('/analytics/:transaction_id', async (req, res) => {
    try {
        const { transaction_id } = req.params;
        const event = await Analytics.findByTransactionId(transaction_id);
        
        if (!event) {
            return res.status(404).json({ message: 'Событие не найдено' });
        }

        res.json(event);
    } catch (error) {
        console.error('Ошибка при получении события:', error);
        res.status(500).json({ message: 'Ошибка сервера', error: error.message });
    }
});

module.exports = router;