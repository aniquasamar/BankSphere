const express = require('express');
const cors = require('cors');
const helmet = require('helmet'); // npm i helmet
const { allowedOrigins } = require('../middlewares/middleware');
const { globalLimiter } = require('../middlewares/rateLimiters');

// Call once from app.js (replaces the old cors({origin:"*"}) and express.json() lines).
module.exports = function applySecurity(app) {
  app.set('trust proxy', 1); // Render sits behind one proxy; needed for correct client IPs

  // Security headers. "cross-origin" is REQUIRED so the Vercel frontend can still
  // load profile photos and logos served from this backend's /public folder.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // Only the real frontend (and local dev) may call the API from a browser.
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    })
  );

  if (process.env.NODE_ENV !== 'test') app.use(globalLimiter);

  app.use(express.json({ limit: '100kb' }));
};