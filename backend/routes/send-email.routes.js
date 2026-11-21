const express = require('express');
const router = express.Router();
const { z } = require('zod');
const emailController = require('../controller/email.controller');
const { verifyToken, isAdminEmployee } = require('../middlewares/middleware');
const { emailLimiter } = require('../middlewares/rateLimiters');

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const body = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(100),
});

// Validate + HTML-escape here so email.controller.js needs no changes.
const validateEmail = (req, res, next) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid email request', emailSent: false });
  req.body = { email: parsed.data.email, password: escapeHtml(parsed.data.password) };
  next();
};

// Was completely open: anyone could make the bank's Gmail send arbitrary HTML to any address.
router.post('/', verifyToken, isAdminEmployee, emailLimiter, validateEmail, emailController.sendEmail);

module.exports = router;