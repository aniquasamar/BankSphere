const express = require('express');
const router = express.Router();
const controller = require('../controller/controller');
const Branch = require('../model/branch.model');
const { verifyToken, isAdmin, isAdminEmployeeCustomer } = require('../middlewares/middleware');
const { validId, stripOperators } = require('../middlewares/guards');

router.param('id', validId);

router.get('/', verifyToken, isAdminEmployeeCustomer, (req, res) => controller.getData(req, res, Branch));
router.post('/', verifyToken, isAdmin, (req, res) => controller.createData(req, res, Branch));
router.put('/:id', verifyToken, isAdmin, stripOperators, (req, res) => controller.updateData(req, res, Branch));
router.delete('/:id', verifyToken, isAdmin, (req, res) => controller.deleteData(req, res, Branch));

module.exports = router;