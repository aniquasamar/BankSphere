const express = require('express');
const router = express.Router();
const controller = require('../controller/controller');
const Currency = require('../model/currency.model');
const { verifyToken, isAdmin, isAdminEmployeeCustomer } = require('../middlewares/middleware');
const { validId, stripOperators } = require('../middlewares/guards');

router.param('id', validId);

router.get('/', verifyToken, isAdminEmployeeCustomer, (req, res) => controller.getData(req, res, Currency));
router.post('/', verifyToken, isAdmin, (req, res) => controller.createData(req, res, Currency));
router.put('/:id', verifyToken, isAdmin, stripOperators, (req, res) => controller.updateData(req, res, Currency));
router.delete('/:id', verifyToken, isAdmin, (req, res) => controller.deleteData(req, res, Currency));

module.exports = router;