const express = require('express');
const Review = require('../models/Review');
const auth = require('../middleware/auth');
const router = express.Router();

// Public: submit review/complaint (called from review collection page)
router.post('/submit', async (req, res) => {
    try {
        const {
            storeId, type, rating, name, contact,
            orderId, problem, source, reorder,
            deliverySpeed, quality, packaging,
            improve, wishlist, urlParams
        } = req.body;

        if (!storeId || !type || !rating) {
            return res.status(400).json({ error: 'storeId, type, and rating are required' });
        }

        if (!['complaint', 'survey'].includes(type)) {
            return res.status(400).json({ error: 'type must be "complaint" or "survey"' });
        }

        if (rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'rating must be between 1 and 5' });
        }

        const review = new Review({
            storeId: Number(storeId),
            type,
            rating: Number(rating),
            name,
            contact,
            orderId,
            problem,
            source,
            reorder,
            deliverySpeed,
            quality,
            packaging,
            improve,
            wishlist,
            urlParams
        });

        const result = await review.save();
        res.json({ success: true, id: result.id });
    } catch (error) {
        console.error('Error submitting review:', error.message);
        res.status(500).json({ error: 'Failed to submit review' });
    }
});

// Protected: list reviews for a store (admin dashboard)
router.get('/list/:storeId', auth, async (req, res) => {
    try {
        const { storeId } = req.params;
        const { type, status, limit, offset } = req.query;

        const reviews = await Review.findByStore(Number(storeId), {
            type,
            status,
            limit: limit ? Number(limit) : 50,
            offset: offset ? Number(offset) : 0
        });

        res.json({ success: true, data: reviews });
    } catch (error) {
        console.error('Error fetching reviews:', error.message);
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
});

// Protected: get review stats for a store
router.get('/stats/:storeId', auth, async (req, res) => {
    try {
        const stats = await Review.countByStore(Number(req.params.storeId));
        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Error fetching review stats:', error.message);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Protected: update review status (mark as contacted/resolved)
router.patch('/status/:id', auth, async (req, res) => {
    try {
        const { status, notes } = req.body;

        if (!['new', 'contacted', 'resolved'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const review = await Review.updateStatus(Number(req.params.id), status, notes);
        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        res.json({ success: true, data: review });
    } catch (error) {
        console.error('Error updating review:', error.message);
        res.status(500).json({ error: 'Failed to update review' });
    }
});

module.exports = router;
