const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const applySecurity = require('./config/security');

const app = express();
const usersRouter = require("./routes/users.routes");
const uploadRouter = require("./routes/upload.routes");
const emailRouter = require('./routes/send-email.routes');
const brandingRouter = require('./routes/branding.routes');
const branchRouter = require('./routes/branch.routes');
const currencyRouter = require('./routes/currency.routes');
const loginRouter = require('./routes/login.routes');
const verifyRouter = require('./routes/verify.routes');
const customerRouter = require('./routes/customers.routes');
const findByAccountRouter = require('./routes/findByAccount.routes');
const transactionRouter = require('./routes/transaction.routes');


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

applySecurity(app);       // trust proxy, helmet, CORS allow-list, rate limit, 100kb JSON limit
app.use(logger('dev'));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

//route level middleware
app.use('/api/verify-token', verifyRouter);
app.use("/api/users" , usersRouter);
app.use("/api/upload" , uploadRouter);
app.use('/api/send-email', emailRouter);
app.use('/api/branding', brandingRouter);
app.use('/api/branch', branchRouter);
app.use('/api/currency', currencyRouter);
app.use('/api/login', loginRouter);
app.use('/api/customers', customerRouter);
app.use('/api/customers/find-account', findByAccountRouter);
app.use('/api/transactions', transactionRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
// error handler: JSON, stack traces only in development
app.use(function (err, req, res, next) {
  const status = err.status || 500;
  res.status(status).json({
    message: status === 500 ? 'Internal server error' : err.message,
    ...(req.app.get('env') === 'development' && { stack: err.stack }),
  });
});

module.exports = app;
