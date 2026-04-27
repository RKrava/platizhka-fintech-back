require('@shopify/shopify-api/adapters/node');
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const http = require('http');
const authRoutes = require("./src/routes/auth");
const userRoutes = require("./src/routes/user");
const checkSessionRouter = require("./src/routes/checkSession");
const shopRoutes = require("./src/routes/shop");
const shopifyRoutes = require("./src/routes/shopify");
const shopifyOAuthRoutes = require("./src/routes/shopify-oauth");
const analyticsRoutes = require("./src/routes/analytics");
const monoCheckoutRoutes = require("./src/routes/monoCheckout");
const paymentsRoutes = require("./src/routes/payments");
const courseRoutes = require("./src/routes/course");
const printerRoutes = require("./src/routes/printer");
const promoCodeRoutes = require("./src/routes/promoCodes");
const abandonedRoutes = require("./src/routes/abandoned");
const abandonedTrackRoutes = require("./src/routes/abandoned-track");
const reviewRoutes = require("./src/routes/reviews");
// Short link redirects moved to separate service (short-links repo)
// const redirectRoutes = require("./src/routes/redirect");
const app = express();

// ngrok / cloudflared terminate HTTPS before forwarding to this local server.
// Trust proxy headers so req.protocol stays "https" for Shopify OAuth URLs.
app.set('trust proxy', true);

app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.options('*', cors());

// Payment webhooks need the RAW request body to verify provider signatures
// (Monobank uses ECDSA over the exact bytes). Mount the raw parser BEFORE
// express.json() so JSON parsing doesn't strip the original payload.
app.use('/payments/webhook', express.raw({ type: '*/*' }));

app.use(express.json());

app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/api', checkSessionRouter);
app.use('/shops', shopRoutes);
app.use('/shopify', shopifyRoutes);
app.use('/shopify-oauth', shopifyOAuthRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/mono', monoCheckoutRoutes);
app.use('/payments', paymentsRoutes);
app.use('/course', courseRoutes);
app.use('/printer', printerRoutes);
app.use('/promo-codes', promoCodeRoutes);
app.use('/abandoned', abandonedRoutes);
app.use('/abandoned-track', abandonedTrackRoutes);
app.use('/reviews', reviewRoutes);
// app.use('/r', redirectRoutes); // moved to short-links service

// Cron moved to separate service: cart-recovery (Railway)
// API endpoints for manual send/test/preview stay here

// Создаем HTTP сервер
const server = http.createServer(app);

server.listen(process.env.PORT || 3001, () => {
    console.log(`Server running on port ${process.env.PORT || 3001}`);
});
