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
const analyticsRoutes = require("./src/routes/analytics");
const monoCheckoutRoutes = require("./src/routes/monoCheckout");
const courseRoutes = require("./src/routes/course");
const printerRoutes = require("./src/routes/printer");
const promoCodeRoutes = require("./src/routes/promoCodes");
const abandonedRoutes = require("./src/routes/abandoned");
// Short link redirects moved to separate service (short-links repo)
// const redirectRoutes = require("./src/routes/redirect");
const app = express();

app.use(cors());
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/user', userRoutes);
app.use('/api', checkSessionRouter);
app.use('/shops', shopRoutes);
app.use('/shopify', shopifyRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/mono', monoCheckoutRoutes);
app.use('/course', courseRoutes);
app.use('/printer', printerRoutes);
app.use('/promo-codes', promoCodeRoutes);
app.use('/abandoned', abandonedRoutes);
// app.use('/r', redirectRoutes); // moved to short-links service

// Cron moved to separate service: cart-recovery (Railway)
// API endpoints for manual send/test/preview stay here

// Создаем HTTP сервер
const server = http.createServer(app);

server.listen(process.env.PORT || 3001, () => {
    console.log(`Server running on port ${process.env.PORT || 3001}`);
});
