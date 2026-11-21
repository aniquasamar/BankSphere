const express = require('express');
const router = express.Router();
const Transactions = require('../model/transaction.model');
const controller = require('../controller/controller');
const txController = require('../controller/transaction.controller');
const { verifyToken, isAdminEmployee, isAdminEmployeeCustomer } = require('../middlewares/middleware');

// ---- Money movement: all balance logic lives on the server ----
router.post('/deposit', verifyToken, isAdminEmployee, txController.deposit);
router.post('/withdraw', verifyToken, isAdminEmployee, txController.withdraw);
router.post('/transfer', verifyToken, isAdminEmployeeCustomer, txController.transfer);

// ---- Read-only reporting (unchanged) ----
router.get('/summary', verifyToken, isAdminEmployeeCustomer, (req, res) =>
  controller.getTransactionSummary(req, res, Transactions)
);
router.get('/pagination', verifyToken, isAdminEmployeeCustomer, (req, res) =>
  controller.getPaginatedTransactions(req, res, Transactions)
);

// The ledger is append-only: the old generic POST / PUT / DELETE / GET-all routes are
// intentionally removed so a transaction can never be edited or deleted over the API.

module.exports = router;