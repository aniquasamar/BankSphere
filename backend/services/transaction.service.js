const mongoose = require('mongoose');
const Customers = require('../model/customers.model');
const Transactions = require('../model/transaction.model');

class TxError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Runs `work(session)` inside a MongoDB multi-document transaction.
// withTransaction() automatically retries on transient errors / write conflicts.
async function runInTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

// Keys are scoped per user so two users can never collide on the same UUID.
const scopedKey = (actor, key) => `${actor._id}:${key}`;

/**
 * Atomically moves money on ONE account and writes ONE ledger row.
 * The balance check and the update happen in a single findOneAndUpdate, so two
 * concurrent withdrawals can never both succeed against the same funds.
 */
async function applyEntry(session, { accountNumber, type, amount, remark, actor, branchGuard, meta = {} }) {
  const delta = type === 'credit' ? amount : -amount;

  const filter = { accountNumber, isActive: true };
  if (branchGuard) filter.branch = branchGuard;
  if (type === 'debit') filter.finalBalance = { $gte: amount }; // no overdrafts

  const customer = await Customers.findOneAndUpdate(
    filter,
    // Pipeline update + $round => no floating-point drift (0.1 + 0.2 style bugs)
    [{ $set: { finalBalance: { $round: [{ $add: ['$finalBalance', delta] }, 2] }, updatedAt: '$$NOW' } }],
    { new: true, session }
  );

  if (!customer) {
    // Work out *why* it failed so the API returns a useful error.
    const acct = await Customers.findOne({ accountNumber }).session(session).lean();
    if (!acct) throw new TxError(404, `Account ${accountNumber} not found`);
    if (!acct.isActive) throw new TxError(409, `Account ${accountNumber} is inactive`);
    if (branchGuard && acct.branch !== branchGuard) {
      throw new TxError(403, 'This account belongs to a different branch');
    }
    if (type === 'debit') throw new TxError(422, 'Insufficient account balance');
    throw new TxError(409, 'Account could not be updated');
  }

  const [entry] = await Transactions.create(
    [
      {
        accountNumber,
        customerId: String(customer._id),
        type,
        amount,
        remark,
        currentBalance: round2(customer.finalBalance - delta),
        finalBalance: customer.finalBalance,
        branch: customer.branch,
        createdBy: actor.fullname || actor.email || 'system',
        ...meta,
      },
    ],
    { session }
  );
  return entry;
}

// If the same Idempotency-Key is reused with a different request, reject it.
function assertSamePayload(entries, { accountNumber, amount }) {
  const first = entries[0];
  if (first.accountNumber !== accountNumber || first.amount !== amount) {
    throw new TxError(409, 'Idempotency-Key was already used for a different request');
  }
}

// Two simultaneous requests with the same key can both pass the "already exists?"
// check. The unique index rejects the loser (E11000) and its transaction rolls back
// completely, so we simply return the winner's result.
async function withReplayGuard(keys, payload, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === 11000) {
      const entries = await Transactions.find({ idempotencyKey: { $in: keys } }).sort({ createdAt: 1 });
      if (entries.length) {
        assertSamePayload(entries, payload);
        return { entries, replayed: true };
      }
    }
    throw err;
  }
}

async function postSingle({ type, kind, accountNumber, amount, remark, actor, idempotencyKey }) {
  const key = scopedKey(actor, idempotencyKey);
  const branchGuard = actor.userType === 'employee' ? actor.branch : null; // admin = any branch
  const payload = { accountNumber, amount };

  return withReplayGuard([key], payload, () =>
    runInTransaction(async (session) => {
      const existing = await Transactions.find({ idempotencyKey: key }).session(session);
      if (existing.length) {
        assertSamePayload(existing, payload);
        return { entries: existing, replayed: true };
      }
      const entry = await applyEntry(session, {
        accountNumber, type, amount, remark, actor, branchGuard,
        meta: { kind, idempotencyKey: key },
      });
      return { entries: [entry], replayed: false };
    })
  );
}

const deposit = (args) => postSingle({ ...args, type: 'credit', kind: 'deposit' });
const withdraw = (args) => postSingle({ ...args, type: 'debit', kind: 'withdrawal' });

/**
 * Account-to-account transfer: a debit leg and a credit leg that commit together or
 * not at all (double-entry ledger). Both legs share a transferId.
 */
async function transfer({ fromAccount, toAccount, amount, remark, actor, idempotencyKey }) {
  if (fromAccount === toAccount) throw new TxError(400, 'Cannot transfer to the same account');

  // Customers may only move money out of their own account.
  if (actor.userType === 'customer' && Number(actor.accountNumber) !== fromAccount) {
    throw new TxError(403, 'You can only transfer from your own account');
  }
  // Employees may only debit accounts in their own branch (credit side can be any branch).
  const debitBranchGuard = actor.userType === 'employee' ? actor.branch : null;

  const base = scopedKey(actor, idempotencyKey);
  const keys = [`${base}:debit`, `${base}:credit`];
  const transferId = new mongoose.Types.ObjectId().toString();
  const payload = { accountNumber: fromAccount, amount };

  return withReplayGuard(keys, payload, () =>
    runInTransaction(async (session) => {
      const existing = await Transactions.find({ idempotencyKey: { $in: keys } })
        .sort({ createdAt: 1 })
        .session(session);
      if (existing.length) {
        assertSamePayload(existing, payload);
        return { entries: existing, replayed: true };
      }

      const debit = await applyEntry(session, {
        accountNumber: fromAccount, type: 'debit', amount, actor,
        remark: remark || `Transfer to ${toAccount}`,
        branchGuard: debitBranchGuard,
        meta: { kind: 'transfer', transferId, counterpartyAccount: toAccount, idempotencyKey: keys[0] },
      });
      const credit = await applyEntry(session, {
        accountNumber: toAccount, type: 'credit', amount, actor,
        remark: remark || `Transfer from ${fromAccount}`,
        meta: { kind: 'transfer', transferId, counterpartyAccount: fromAccount, idempotencyKey: keys[1] },
      });
      return { entries: [debit, credit], replayed: false };
    })
  );
}

module.exports = { TxError, deposit, withdraw, transfer };