const express = require('express');
const router = express.Router();
const Transactions = require('../model/transaction.model');
const controller = require('../controller/controller');
const txController = require('../controller/transaction.controller');
const { verifyToken, isAdminEmployee, isAdminEmployeeCustomer } = require('../middlewares/middleware');
const { scopeTransactionQuery } = require('../middlewares/guards');

// ---- Money movement: all balance logic lives on the server ----
router.post('/deposit', verifyToken, isAdminEmployee, txController.deposit);
router.post('/withdraw', verifyToken, isAdminEmployee, txController.withdraw);
router.post('/transfer', verifyToken, isAdminEmployeeCustomer, txController.transfer);

// ---- Read-only reporting: scope comes from the JWT, never from the query string ----
router.get('/summary', verifyToken, isAdminEmployeeCustomer, scopeTransactionQuery, (req, res) =>
  controller.getTransactionSummary(req, res, Transactions)
);
router.get('/pagination', verifyToken, isAdminEmployeeCustomer, scopeTransactionQuery, (req, res) =>
  controller.getPaginatedTransactions(req, res, Transactions)
);

// The ledger is append-only: no generic POST / PUT / DELETE / GET-all routes.

module.exports = router;