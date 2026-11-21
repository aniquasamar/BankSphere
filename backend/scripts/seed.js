/**
 * Seeds a DEMO database so a fresh `docker compose up` is usable immediately.
 * Idempotent: safe to run more than once.
 *
 *   docker compose exec backend node scripts/seed.js
 *   (or, without Docker)  npm run seed
 *
 * Refuses to run against an Atlas (mongodb+srv) URI unless you pass --force,
 * so you can't accidentally create demo admin accounts in a real database.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Users = require('../model/users.model');
const Customers = require('../model/customers.model');
const Transactions = require('../model/transaction.model');
const Branch = require('../model/branch.model');
const Currency = require('../model/currency.model');
const Branding = require('../model/branding.model');

const url = process.env.DB_URL;
if (!url) {
  console.error('DB_URL is not set.');
  process.exit(1);
}
if (/^mongodb\+srv:/.test(url) && !process.argv.includes('--force')) {
  console.error('Refusing to seed a mongodb+srv (Atlas) database. Re-run with --force if you really mean it.');
  process.exit(1);
}

// Creates the document only if nothing matches `filter`. Uses save() so passwords get hashed.
async function ensure(Model, filter, doc) {
  const existing = await Model.findOne(filter);
  if (existing) return existing;
  return new Model(doc).save();
}

const BRANCH = 'main';
const base = { key: 'demo', address: 'Kolkata, India', branch: BRANCH, isActive: true };

async function seedCustomer({ n, name, email, balance }) {
  const accountNumber = 100000 + n;
  const login = await ensure(Users, { email }, {
    ...base, fullname: name, email, password: 'customer123', userType: 'customer', mobile: `90000000${n}0`,
  });
  const customer = await ensure(Customers, { accountNumber }, {
    ...base, accountNumber, fullname: name, fathername: 'demo', dob: '1998-01-01', gender: 'female',
    currency: 'inr', email, mobile: `90000000${n}0`, userType: 'customer', finalBalance: 0,
    customerLoginId: String(login._id),
  });

  // Opening balance goes through the ledger so balance and history agree.
  const key = `seed:opening:${accountNumber}`;
  if (!(await Transactions.findOne({ idempotencyKey: key }))) {
    await Transactions.create({
      accountNumber, customerId: String(customer._id), type: 'credit', kind: 'deposit',
      amount: balance, remark: 'Opening balance', currentBalance: 0, finalBalance: balance,
      branch: BRANCH, createdBy: 'seed', idempotencyKey: key,
    });
    await Customers.updateOne({ _id: customer._id }, { finalBalance: balance });
  }
  return accountNumber;
}

(async () => {
  await mongoose.connect(url);
  await Transactions.init(); // make sure indexes exist

  await ensure(Branch, { branchName: BRANCH }, { branchName: BRANCH, branchAddress: 'Kolkata, India', key: 'demo' });
  await ensure(Currency, { currencyName: 'inr' }, { currencyName: 'inr', currencyDesc: 'Indian Rupee', key: 'demo' });
  await ensure(Branding, {}, {
    bankName: 'Demo Bank', bankTagline: 'Banking made simple', bankAccountNumber: '100002',
    bankAddress: 'Kolkata, India', bankDesc: 'Demo data created by scripts/seed.js',
  });

  await ensure(Users, { email: 'admin@bank.test' }, {
    ...base, fullname: 'Demo Admin', email: 'admin@bank.test', password: 'admin123', userType: 'admin', mobile: '9000000001',
  });
  await ensure(Users, { email: 'employee@bank.test' }, {
    ...base, fullname: 'Demo Employee', email: 'employee@bank.test', password: 'employee123', userType: 'employee', mobile: '9000000002',
  });

  await seedCustomer({ n: 1, name: 'Demo Customer One', email: 'customer1@bank.test', balance: 10000 });
  await seedCustomer({ n: 2, name: 'Demo Customer Two', email: 'customer2@bank.test', balance: 5000 });

  console.log('\nSeed complete. Demo logins (CHANGE OR DELETE THESE before any real use):');
  console.log('  admin     admin@bank.test      / admin123');
  console.log('  employee  employee@bank.test   / employee123');
  console.log('  customer  customer1@bank.test  / customer123   (account 100001, balance 10000)');
  console.log('  customer  customer2@bank.test  / customer123   (account 100002, balance 5000)\n');

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('Seed failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});