const express = require('express');
const router = express.Router();
const Customers = require('../model/customers.model');
const controller = require('../controller/controller');
const { verifyToken, isAdminEmployee } = require('../middlewares/middleware');
const {
  validId, stripOperators, sanitizeCustomerCreate, sanitizeCustomerUpdate, ensureCustomerInScope,
} = require('../middlewares/guards');

router.param('id', validId);

// Employees see only their own branch's customers; admins see everyone.
router.get('/', verifyToken, isAdminEmployee, async (req, res) => {
  try {
    const filter = req.user.userType === 'employee' ? { branch: req.user.branch } : {};
    const data = await Customers.find(filter);
    res.status(200).json({ message: 'Record Found', data });
  } catch (err) {
    console.error('GET /customers:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

router.post('/', verifyToken, isAdminEmployee, stripOperators, sanitizeCustomerCreate, (req, res) =>
  controller.createData(req, res, Customers)
);

router.put('/:id', verifyToken, isAdminEmployee, ensureCustomerInScope, stripOperators, sanitizeCustomerUpdate,
  (req, res) => controller.updateData(req, res, Customers)
);

router.delete('/:id', verifyToken, isAdminEmployee, ensureCustomerInScope, (req, res, next) => {
  // Never delete an account that still holds money.
  if (req.customer.finalBalance !== 0) {
    return res.status(409).json({ message: 'Cannot delete an account with a non-zero balance' });
  }
  next();
}, (req, res) => controller.deleteData(req, res, Customers));

module.exports = router;