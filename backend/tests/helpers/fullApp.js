// Mirrors app.js: same security setup, same routers, same mount order.
// Call AFTER startTestDb() has set DB_URL / JWT_SECRET.
function buildFullApp() {
  const express = require('express');
  const app = express();
  require('../../config/security')(app);

  app.use('/api/verify-token', require('../../routes/verify.routes'));
  app.use('/api/users', require('../../routes/users.routes'));
  app.use('/api/upload', require('../../routes/upload.routes'));
  app.use('/api/send-email', require('../../routes/send-email.routes'));
  app.use('/api/branding', require('../../routes/branding.routes'));
  app.use('/api/branch', require('../../routes/branch.routes'));
  app.use('/api/currency', require('../../routes/currency.routes'));
  app.use('/api/login', require('../../routes/login.routes'));
  app.use('/api/customers', require('../../routes/customers.routes'));
  app.use('/api/customers/find-account', require('../../routes/findByAccount.routes'));
  app.use('/api/transactions', require('../../routes/transaction.routes'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  return app;
}

module.exports = { buildFullApp };