const express = require('express');
const router = express.Router();
const { z } = require('zod');
const userSchema = require('../model/users.model');
const loginController = require('../controller/login.controller');
const { loginLimiter } = require('../middlewares/rateLimiters');

// email/password MUST be strings: otherwise {"email": {"$ne": null}} becomes a Mongo query.
const loginBody = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(200),
});

const validateLogin = (req, res, next) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid credentials', isLogged: false });
  req.body = parsed.data;
  next();
};

router.post('/', loginLimiter, validateLogin, (req, res) => loginController.loginFunc(req, res, userSchema));

module.exports = router;