const express = require('express');
const router = express.Router();
const { z } = require('zod');
const Customers = require('../model/customers.model');
const { verifyToken, isAdminEmployeeCustomer } = require('../middlewares/middleware');

// Only an account NUMBER is accepted. The old version passed req.body straight into
// findOne(), so {"accountNumber": {"$ne": 0}} (or any other field) worked as a query.
const schema = z.object({ accountNumber: z.coerce.number().int().positive() });

router.post('/', verifyToken, isAdminEmployeeCustomer, async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'A valid account number is required' });

  const { userType, branch, accountNumber } = req.user;
  const query = { accountNumber: parsed.data.accountNumber };
  if (userType === 'customer') query.accountNumber = Number(accountNumber); // only their own account
  if (userType === 'employee') query.branch = branch;                       // only their own branch

  try {
    const data = await Customers.findOne(query);
    return res.status(200).json({ message: 'Record Found!', data });
  } catch (err) {
    console.error('find-account:', err);
    return res.status(500).json({ message: 'Internal Server Error!' });
  }
});

module.exports = router;