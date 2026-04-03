const express = require('express');
const ShortLink = require('../models/ShortLink');
const router = express.Router();

// Redirect short link: GET /r/:code
router.get('/:code', async (req, res) => {
    try {
        const link = await ShortLink.findByCode(req.params.code);
        if (!link) {
            return res.status(404).send('Link not found');
        }

        // Track click (async, don't wait)
        ShortLink.incrementClicks(req.params.code).catch(() => {});

        // 302 redirect to target URL
        res.redirect(302, link.target_url);
    } catch (error) {
        console.error('Redirect error:', error);
        res.status(500).send('Server error');
    }
});

module.exports = router;
