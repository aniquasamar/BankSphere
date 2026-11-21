const rateLimit = require('express-rate-limit'); // npm i express-rate-limit

const base = { standardHeaders: true, legacyHeaders: false };

// Brute-force protection: only FAILED logins count (successful ones are skipped).
const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT) || 10,
  skipSuccessfulRequests: true,
  message: { message: 'Too many login attempts. Try again in 15 minutes.', isLogged: false },
});

// The email endpoint sends from the bank's Gmail account: keep it tight.
const emailLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  message: { message: 'Too many emails sent. Try again later.' },
});

// Blanket protection for every other endpoint.
const globalLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 300,
  message: { message: 'Too many requests. Please slow down.' },
});

module.exports = { loginLimiter, emailLimiter, globalLimiter };