const Customers = require('../model/customers.model');

const OBJECT_ID = /^[a-f\d]{24}$/i;

// router.param('id', validId): malformed ids get a clean 400 instead of a Mongoose CastError 500.
const validId = (req, res, next, id) =>
  OBJECT_ID.test(id) ? next() : res.status(400).json({ message: 'Invalid id' });

// Removes Mongo operators ($inc, $set, ...) from a body. Without this,
// findByIdAndUpdate(id, { $inc: { finalBalance: 1e9 } }) would be executed as written.
const stripOperators = (req, res, next) => {
  const body = { ...req.body };
  Object.keys(body).forEach((k) => k.startsWith('$') && delete body[k]);
  req.body = body;
  next();
};

// ---- customers -------------------------------------------------------------
// Balances can only change through the transaction endpoints.
const sanitizeCustomerCreate = (req, res, next) => {
  const body = { ...req.body };
  ['_id', 'createdAt', 'updatedAt'].forEach((f) => delete body[f]);
  body.finalBalance = 0;
  if (req.user.userType === 'employee') body.branch = req.user.branch; // employees can't create in other branches
  req.body = body;
  next();
};

const sanitizeCustomerUpdate = (req, res, next) => {
  const body = { ...req.body };
  ['_id', 'finalBalance', 'accountNumber', 'createdAt', 'updatedAt'].forEach((f) => delete body[f]);
  if (req.user.userType === 'employee') delete body.branch; // can't move customers between branches
  req.body = body;
  next();
};

// Employees may only act on customers of their own branch; admins on any.
const ensureCustomerInScope = async (req, res, next) => {
  try {
    const customer = await Customers.findById(req.params.id).lean();
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    if (req.user.userType === 'employee' && customer.branch !== req.user.branch) {
      return res.status(403).json({ message: 'Access denied' });
    }
    req.customer = customer;
    next();
  } catch (err) {
    console.error('ensureCustomerInScope:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ---- transactions ------------------------------------------------------------
// Rewrites req.query from the JWT so nobody can read outside their own scope,
// regardless of what ?branch= / ?accountNumber= the client sends.
const scopeTransactionQuery = (req, res, next) => {
  const { userType, branch, accountNumber } = req.user;
  const q = { ...req.query };

  // Only plain strings: blocks operator injection such as ?branch[$ne]=x
  ['branch', 'accountNumber', 'fromDate', 'toDate', 'page', 'limit'].forEach((k) => {
    if (q[k] !== undefined && typeof q[k] !== 'string') delete q[k];
  });

  if (userType === 'customer') {
    if (!accountNumber) return res.status(403).json({ message: 'Access denied' });
    q.accountNumber = String(accountNumber); // always their own account
    delete q.branch;
  } else if (userType === 'employee') {
    q.branch = branch; // always their own branch
  }

  // Bad dates would otherwise crash the query with a 500.
  if (isNaN(new Date(q.fromDate)) || isNaN(new Date(q.toDate))) {
    delete q.fromDate;
    delete q.toDate;
  }
  q.page = String(Math.max(parseInt(q.page, 10) || 1, 1));
  q.limit = String(Math.min(Math.max(parseInt(q.limit, 10) || 10, 1), 100)); // cap page size

  req.query = q;
  next();
};

module.exports = {
  validId,
  stripOperators,
  sanitizeCustomerCreate,
  sanitizeCustomerUpdate,
  ensureCustomerInScope,
  scopeTransactionQuery,
};