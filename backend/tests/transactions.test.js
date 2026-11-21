const request = require('supertest');
const { randomUUID } = require('crypto');
const { startTestDb, ensureConnected, stopTestDb, buildApp, tokens, seed } = require('./helpers/testEnv');

let app, Customers, Transactions;

beforeAll(async () => {
  await startTestDb();
  app = buildApp(); // requires the app code AFTER env vars are set
  Customers = require('../model/customers.model');
  Transactions = require('../model/transaction.model');
  await ensureConnected();
  await Transactions.init(); // make sure the unique idempotency index exists
});

afterAll(stopTestDb);
beforeEach(seed);

// ---------- helpers ----------
// key === null => omit the Idempotency-Key header entirely
const call = (path, token, body, key = randomUUID()) => {
  const req = request(app).post(`/api/transactions/${path}`).send(body);
  if (token) req.set('Authorization', `Bearer ${token}`);
  if (key) req.set('Idempotency-Key', key);
  return req;
};
const balance = async (acct) => (await Customers.findOne({ accountNumber: acct })).finalBalance;
const ledger = (acct) => Transactions.find({ accountNumber: acct }).sort({ createdAt: 1 });
const wd = (amount, acct = 1001) => ({ accountNumber: acct, amount, remark: 'test' });

// =====================================================================
describe('deposit & withdraw', () => {
  test('deposit credits the account and writes a ledger entry', async () => {
    const res = await call('deposit', tokens.admin, wd(250));
    expect(res.status).toBe(201);
    expect(res.body.replayed).toBe(false);
    expect(await balance(1001)).toBe(1250);

    const [entry] = await ledger(1001);
    expect(entry).toMatchObject({
      type: 'credit', kind: 'deposit', amount: 250,
      currentBalance: 1000, finalBalance: 1250, branch: 'kolkata', createdBy: 'Admin User',
    });
  });

  test('withdraw debits the account and writes a ledger entry', async () => {
    const res = await call('withdraw', tokens.employeeKolkata, wd(400));
    expect(res.status).toBe(201);
    expect(await balance(1001)).toBe(600);
    const [entry] = await ledger(1001);
    expect(entry).toMatchObject({ type: 'debit', kind: 'withdrawal', currentBalance: 1000, finalBalance: 600 });
  });

  test('overdraft is rejected (422) and nothing changes', async () => {
    const res = await call('withdraw', tokens.admin, wd(1000.01));
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/insufficient/i);
    expect(await balance(1001)).toBe(1000);
    expect(await ledger(1001)).toHaveLength(0);
  });

  test('withdrawing the exact balance is allowed', async () => {
    const res = await call('withdraw', tokens.admin, wd(1000));
    expect(res.status).toBe(201);
    expect(await balance(1001)).toBe(0);
  });

  test('decimal amounts do not drift (0.1 + 0.2)', async () => {
    await call('deposit', tokens.admin, wd(0.1));
    await call('deposit', tokens.admin, wd(0.2));
    expect(await balance(1001)).toBe(1000.3);
  });

  test('unknown account -> 404, inactive account -> 409', async () => {
    expect((await call('deposit', tokens.admin, wd(10, 9999))).status).toBe(404);
    expect((await call('deposit', tokens.admin, wd(10, 3001))).status).toBe(409);
    expect(await balance(3001)).toBe(100);
  });
});

// =====================================================================
describe('validation', () => {
  test.each([
    ['negative amount', { accountNumber: 1001, amount: -5, remark: 'x' }],
    ['zero amount', { accountNumber: 1001, amount: 0, remark: 'x' }],
    ['3 decimal places', { accountNumber: 1001, amount: 10.555, remark: 'x' }],
    ['non-numeric amount', { accountNumber: 1001, amount: 'abc', remark: 'x' }],
    ['missing remark', { accountNumber: 1001, amount: 10 }],
    ['missing account', { amount: 10, remark: 'x' }],
  ])('rejects %s with 400 and changes nothing', async (_name, body) => {
    const res = await call('withdraw', tokens.admin, body);
    expect(res.status).toBe(400);
    expect(await balance(1001)).toBe(1000);
    expect(await Transactions.countDocuments()).toBe(0);
  });

  test('missing Idempotency-Key -> 400', async () => {
    const res = await call('deposit', tokens.admin, wd(10), null);
    expect(res.status).toBe(400);
    expect(await balance(1001)).toBe(1000);
  });
});

// =====================================================================
describe('authentication & authorization', () => {
  test('no token -> 401', async () => {
    expect((await call('deposit', null, wd(10))).status).toBe(401);
  });

  test('garbage token -> 401', async () => {
    expect((await call('deposit', 'not.a.jwt', wd(10))).status).toBe(401);
  });

  test('customers cannot deposit or withdraw (403)', async () => {
    expect((await call('deposit', tokens.customerA, wd(10))).status).toBe(403);
    expect((await call('withdraw', tokens.customerA, wd(10))).status).toBe(403);
    expect(await balance(1001)).toBe(1000);
  });

  test("employee cannot touch another branch's account (403); admin can", async () => {
    const denied = await call('withdraw', tokens.employeeDelhi, wd(10, 1001));
    expect(denied.status).toBe(403);
    expect(await balance(1001)).toBe(1000);

    const ok = await call('withdraw', tokens.admin, wd(10, 2001));
    expect(ok.status).toBe(201);
    expect(await balance(2001)).toBe(290);
  });

  test('ledger is append-only: no edit/delete/generic-create routes exist', async () => {
    const auth = { Authorization: `Bearer ${tokens.admin}` };
    expect((await request(app).post('/api/transactions').set(auth).send({})).status).toBe(404);
    expect((await request(app).put('/api/transactions/abc').set(auth).send({})).status).toBe(404);
    expect((await request(app).delete('/api/transactions/abc').set(auth)).status).toBe(404);
    expect((await request(app).get('/api/transactions').set(auth)).status).toBe(404);
  });
});

// =====================================================================
describe('idempotency', () => {
  test('same key twice posts only once and flags the replay', async () => {
    const key = randomUUID();
    const first = await call('withdraw', tokens.admin, wd(50), key);
    const second = await call('withdraw', tokens.admin, wd(50), key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(await balance(1001)).toBe(950);
    expect(await ledger(1001)).toHaveLength(1);
  });

  test('same key with a different payload -> 409', async () => {
    const key = randomUUID();
    await call('withdraw', tokens.admin, wd(50), key);
    const res = await call('withdraw', tokens.admin, wd(75), key);
    expect(res.status).toBe(409);
    expect(await balance(1001)).toBe(950);
  });

  test('10 simultaneous identical requests post exactly once', async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => call('withdraw', tokens.admin, wd(50), key))
    );

    expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await balance(1001)).toBe(950);
    expect(await ledger(1001)).toHaveLength(1);
  });
});

// =====================================================================
describe('concurrency (race conditions)', () => {
  test('20 concurrent withdrawals of 100 against a balance of 1000: exactly 10 succeed, never negative', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => call('withdraw', tokens.admin, wd(100)))
    );

    const ok = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 422);
    expect(ok).toHaveLength(10);
    expect(rejected).toHaveLength(10);
    expect(await balance(1001)).toBe(0);
    expect(await ledger(1001)).toHaveLength(10);
  });

  test('ledger always reconciles with the balance', async () => {
    await Promise.all([
      ...Array.from({ length: 8 }, () => call('deposit', tokens.admin, wd(30))),
      ...Array.from({ length: 8 }, () => call('withdraw', tokens.admin, wd(20))),
    ]);

    const entries = await ledger(1001);
    const net = entries.reduce((sum, e) => sum + (e.type === 'credit' ? e.amount : -e.amount), 0);
    expect(await balance(1001)).toBe(1000 + net);
    expect(await balance(1001)).toBe(1000 + 8 * 30 - 8 * 20);
  });

  test('opposing concurrent transfers conserve total money', async () => {
    const results = await Promise.all([
      ...Array.from({ length: 10 }, () =>
        call('transfer', tokens.admin, { fromAccount: 1001, toAccount: 1002, amount: 10 })),
      ...Array.from({ length: 10 }, () =>
        call('transfer', tokens.admin, { fromAccount: 1002, toAccount: 1001, amount: 10 })),
    ]);

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect((await balance(1001)) + (await balance(1002))).toBe(1500);
    expect(await balance(1001)).toBe(1000); // 10 out, 10 in
    expect(await balance(1002)).toBe(500);

    const rows = await Transactions.find({ kind: 'transfer' });
    expect(rows).toHaveLength(40); // 20 transfers x 2 legs
    const byTransfer = rows.reduce((m, r) => ({ ...m, [r.transferId]: (m[r.transferId] || 0) + 1 }), {});
    expect(Object.values(byTransfer).every((n) => n === 2)).toBe(true);
  });
});

// =====================================================================
describe('transfers', () => {
  test('moves money and writes two linked ledger rows', async () => {
    const res = await call('transfer', tokens.admin, { fromAccount: 1001, toAccount: 1002, amount: 200 });
    expect(res.status).toBe(201);
    expect(await balance(1001)).toBe(800);
    expect(await balance(1002)).toBe(700);

    const [debit] = await ledger(1001);
    const [credit] = await ledger(1002);
    expect(debit).toMatchObject({ type: 'debit', kind: 'transfer', counterpartyAccount: 1002, finalBalance: 800 });
    expect(credit).toMatchObject({ type: 'credit', kind: 'transfer', counterpartyAccount: 1001, finalBalance: 700 });
    expect(debit.transferId).toBe(credit.transferId);
  });

  test('insufficient funds -> 422, neither account changes', async () => {
    const res = await call('transfer', tokens.admin, { fromAccount: 1001, toAccount: 1002, amount: 5000 });
    expect(res.status).toBe(422);
    expect(await balance(1001)).toBe(1000);
    expect(await balance(1002)).toBe(500);
    expect(await Transactions.countDocuments()).toBe(0);
  });

  test('ATOMICITY: if the credit leg fails, the debit leg is rolled back', async () => {
    const res = await call('transfer', tokens.admin, { fromAccount: 1001, toAccount: 9999, amount: 100 });
    expect(res.status).toBe(404);
    expect(await balance(1001)).toBe(1000); // debit was undone
    expect(await Transactions.countDocuments()).toBe(0);
  });

  test('ATOMICITY: transfer to an inactive account is rolled back', async () => {
    const res = await call('transfer', tokens.admin, { fromAccount: 1001, toAccount: 3001, amount: 100 });
    expect(res.status).toBe(409);
    expect(await balance(1001)).toBe(1000);
    expect(await balance(3001)).toBe(100);
    expect(await Transactions.countDocuments()).toBe(0);
  });

  test('transfer to the same account -> 400', async () => {
    const res = await call('transfer', tokens.admin, { fromAccount: 1001, toAccount: 1001, amount: 10 });
    expect(res.status).toBe(400);
  });

  test('a customer can transfer from their own account', async () => {
    const res = await call('transfer', tokens.customerA, { fromAccount: 1001, toAccount: 1002, amount: 100 });
    expect(res.status).toBe(201);
    expect(await balance(1001)).toBe(900);
    const [debit] = await ledger(1001);
    expect(debit.createdBy).toBe('Customer A');
  });

  test("a customer cannot transfer out of someone else's account (403)", async () => {
    const res = await call('transfer', tokens.customerA, { fromAccount: 1002, toAccount: 1001, amount: 100 });
    expect(res.status).toBe(403);
    expect(await balance(1002)).toBe(500);
    expect(await balance(1001)).toBe(1000);
  });

  test("employee cannot debit another branch's account, but can transfer into one", async () => {
    const denied = await call('transfer', tokens.employeeDelhi, { fromAccount: 1001, toAccount: 2001, amount: 50 });
    expect(denied.status).toBe(403);
    expect(await balance(1001)).toBe(1000);

    const ok = await call('transfer', tokens.employeeKolkata, { fromAccount: 1001, toAccount: 2001, amount: 50 });
    expect(ok.status).toBe(201); // inter-branch transfer
    expect(await balance(1001)).toBe(950);
    expect(await balance(2001)).toBe(350);
  });

  test('retrying a transfer with the same key moves money only once', async () => {
    const key = randomUUID();
    const body = { fromAccount: 1001, toAccount: 1002, amount: 100 };
    const first = await call('transfer', tokens.admin, body, key);
    const second = await call('transfer', tokens.admin, body, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(await balance(1001)).toBe(900);
    expect(await balance(1002)).toBe(600);
    expect(await Transactions.countDocuments()).toBe(2);
  });
});