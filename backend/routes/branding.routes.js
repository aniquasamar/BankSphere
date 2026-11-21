const express = require('express');
const router = express.Router();
const controller = require('../controller/controller');
const Branding = require('../model/branding.model');
const { verifyToken, isAdmin, isAdminEmployee } = require('../middlewares/middleware');
const { validId, stripOperators } = require('../middlewares/guards');

router.param('id', validId);

// Employees only ever need to bump the account-number counter when opening an account.
const employeeCounterOnly = (req, res, next) => {
  if (req.user.userType === 'employee') {
    req.body = { bankAccountNumber: req.body.bankAccountNumber };
  }
  next();
};

router.get('/', (req, res) => controller.getData(req, res, Branding)); // public: logo / bank name
router.post('/', verifyToken, isAdmin, (req, res) => controller.createData(req, res, Branding));
router.put('/:id', verifyToken, isAdminEmployee, stripOperators, employeeCounterOnly, (req, res) =>
  controller.updateData(req, res, Branding)
);

module.exports = router;