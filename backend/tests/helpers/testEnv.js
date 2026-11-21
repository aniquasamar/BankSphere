const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const express = require('express');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const JWT_SECRET = 'test-secret';
let replSet;

// Starts a throw-away single-node replica set (needed for MongoDB transactions).
// Env vars MUST be set before the app code is required, because db.service.js
// connects to process.env.DB_URL the moment it is imported.
async function startTestDb() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.DB_URL = replSet.getUri('banksphere_test');
  process.env.JWT_SECRET = JWT_SECRET;
}

async function ensureConnected() {
  if (mongoose.connection.readyState === 0) await mongoose.connect(process.env.DB_URL);
  else await mongoose.connection.asPromise();
}

async function stopTestDb() {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}

// Minimal Express app that mounts the REAL transaction router + real middleware.
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/transactions', require('../../routes/transaction.routes'));
  return app;
}

const makeToken = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });

const tokens = {
  admin: makeToken({ _id: 'admin-1', userType: 'admin', fullname: 'Admin User' }),
  employeeKolkata: makeToken({ _id: 'emp-k', userType: 'employee', branch: 'kolkata', fullname: 'Emp Kolkata' }),
  employeeDelhi: makeToken({ _id: 'emp-d', userType: 'employee', branch: 'delhi', fullname: 'Emp Delhi' }),
  customerA: makeToken({ _id: 'cust-a', userType: 'customer', accountNumber: 1001, fullname: 'Customer A' }),
  customerB: makeToken({ _id: 'cust-b', userType: 'customer', accountNumber: 1002, fullname: 'Customer B' }),
};

// Fresh, known data before every test.
async function seed() {
  const Customers = require('../../model/customers.model');
  const Transactions = require('../../model/transaction.model');
  await Promise.all([Customers.deleteMany({}), Transactions.deleteMany({})]);

  const base = {
    fathername: 'x', dob: '2000-01-01', gender: 'f', currency: 'inr',
    key: 'x', address: 'x', userType: 'customer',
  };
  await Customers.create([
    { ...base, accountNumber: 1001, fullname: 'Customer A', branch: 'kolkata', finalBalance: 1000 },
    { ...base, accountNumber: 1002, fullname: 'Customer B', branch: 'kolkata', finalBalance: 500 },
    { ...base, accountNumber: 2001, fullname: 'Customer C', branch: 'delhi', finalBalance: 300 },
    { ...base, accountNumber: 3001, fullname: 'Customer D', branch: 'kolkata', finalBalance: 100, isActive: false },
  ]);
}

module.exports = { startTestDb, ensureConnected, stopTestDb, buildApp, tokens, seed };