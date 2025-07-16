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

// Создаем HTTP сервер
const server = http.createServer(app);


server.listen(process.env.PORT || 3001, () => {

});
