const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { startTestDb, ensureConnected, stopTestDb, tokens, seed } = require('./helpers/testEnv');
const { buildFullApp } = require('./helpers/fullApp');

let app, Users, Customers, Transactions, Branding;
const FAKE_ID = '64b64c4f9f1b2a0012345678';
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const idOf = async (acct) => String((await Customers.findOne({ accountNumber: acct }))._id);

beforeAll(async () => {
  process.env.LOGIN_RATE_LIMIT = '5'; // must be set before the routers are required
  await startTestDb();
  app = buildFullApp();
  Users = require('../model/users.model');
  Customers = require('../model/customers.model');
  Transactions = require('../model/transaction.model');
  Branding = require('../model/branding.model');
  await ensureConnected();
});

afterAll(async () => {
  fs.rmSync(path.join(__dirname, '../public/testuploads'), { recursive: true, force: true });
  await stopTestDb();
});

beforeEach(async () => {
  await seed();
  await Promise.all([Users.deleteMany({}), Branding.deleteMany({})]);
});

// =====================================================================
describe('every protected route rejects anonymous requests', () => {
  test.each([
    ['get', '/api/customers'],
    ['post', '/api/customers'],
    ['put', `/api/customers/${FAKE_ID}`],
    ['delete', `/api/customers/${FAKE_ID}`],
    ['post', '/api/customers/find-account'],
    ['get', '/api/branch'],
    ['post', '/api/branch'],
    ['put', `/api/branch/${FAKE_ID}`],
    ['delete', `/api/branch/${FAKE_ID}`],
    ['get', '/api/currency'],
    ['post', '/api/currency'],
    ['put', `/api/currency/${FAKE_ID}`],
    ['delete', `/api/currency/${FAKE_ID}`],
    ['post', '/api/branding'],
    ['put', `/api/branding/${FAKE_ID}`],
    ['post', '/api/upload'],
    ['post', '/api/send-email'],
    ['get', '/api/users'],
    ['post', '/api/users'],
    ['get', '/api/transactions/summary'],
    ['get', '/api/transactions/pagination'],
  ])('%s %s -> 401', async (method, url) => {
    const res = await request(app)[method](url).send({});
    expect(res.status).toBe(401);
  });

  test('branding GET stays public (login page needs the logo)', async () => {
    expect((await request(app).get('/api/branding')).status).toBe(200);
  });
});

// =====================================================================
describe('role checks', () => {
  test('customers cannot use staff/admin endpoints', async () => {
    const t = tokens.customerA;
    expect((await request(app).get('/api/customers').set(auth(t))).status).toBe(403);
    expect((await request(app).post('/api/branch').set(auth(t)).send({})).status).toBe(403);
    expect((await request(app).post('/api/upload').set(auth(t))).status).toBe(403);
    expect((await request(app).post('/api/send-email').set(auth(t)).send({})).status).toBe(403);
    expect((await request(app).get('/api/users').set(auth(t))).status).toBe(403);
  });

  test('employees cannot use admin-only endpoints', async () => {
    const t = tokens.employeeKolkata;
    expect((await request(app).post('/api/branch').set(auth(t)).send({})).status).toBe(403);
    expect((await request(app).get('/api/users').set(auth(t))).status).toBe(403);
    expect((await request(app).post('/api/branding').set(auth(t)).send({})).status).toBe(403);
  });

  test('any logged-in role can read the branch list', async () => {
    expect((await request(app).get('/api/branch').set(auth(tokens.customerA))).status).toBe(200);
  });

  test('an employee may only update the account-number counter on branding', async () => {
    const doc = await Branding.create({ bankName: 'JFC', bankAccountNumber: '100' });
    const res = await request(app)
      .put(`/api/branding/${doc._id}`)
      .set(auth(tokens.employeeKolkata))
      .send({ bankName: 'HACKED', bankAccountNumber: '101' });
    expect(res.status).toBe(200);
    const after = await Branding.findById(doc._id);
    expect(after.bankName).toBe('JFC');
    expect(after.bankAccountNumber).toBe('101');
  });
});

// =====================================================================
describe('customers: branch scoping and mass-assignment protection', () => {
  const list = async (token) =>
    (await request(app).get('/api/customers').set(auth(token))).body.data.map((c) => c.accountNumber).sort();

  test('employees see only their own branch; admin sees all', async () => {
    expect(await list(tokens.employeeDelhi)).toEqual([2001]);
    expect(await list(tokens.employeeKolkata)).toEqual([1001, 1002, 3001]);
    expect(await list(tokens.admin)).toHaveLength(4);
  });

  test("employee cannot edit another branch's customer", async () => {
    const res = await request(app)
      .put(`/api/customers/${await idOf(1001)}`)
      .set(auth(tokens.employeeDelhi))
      .send({ address: 'hacked' });
    expect(res.status).toBe(403);
    expect((await Customers.findOne({ accountNumber: 1001 })).address).toBe('x');
  });

  test('balance / account number / operators in an update body are ignored', async () => {
    const res = await request(app)
      .put(`/api/customers/${await idOf(1001)}`)
      .set(auth(tokens.employeeKolkata))
      .send({ address: 'new address', finalBalance: 999999, accountNumber: 7, $inc: { finalBalance: 1000000 } });
    expect(res.status).toBe(200);

    const c = await Customers.findOne({ accountNumber: 1001 });
    expect(c.address).toBe('new address'); // legitimate change applied
    expect(c.finalBalance).toBe(1000);     // balance untouched
  });

  test('new customers always start at 0 and in the employee\'s own branch', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set(auth(tokens.employeeKolkata))
      .send({
        accountNumber: 5555, fullname: 'New Person', fathername: 'x', dob: '2000-01-01', gender: 'f',
        currency: 'inr', key: 'x', address: 'x', branch: 'delhi', finalBalance: 5000,
      });
    expect(res.status).toBe(200);
    const c = await Customers.findOne({ accountNumber: 5555 });
    expect(c.finalBalance).toBe(0);
    expect(c.branch).toBe('kolkata');
  });

  test('accounts holding money cannot be deleted; empty ones can', async () => {
    const blocked = await request(app).delete(`/api/customers/${await idOf(1001)}`).set(auth(tokens.admin));
    expect(blocked.status).toBe(409);

    await Customers.updateOne({ accountNumber: 1002 }, { finalBalance: 0 });
    const denied = await request(app).delete(`/api/customers/${await idOf(1002)}`).set(auth(tokens.employeeDelhi));
    expect(denied.status).toBe(403); // wrong branch

    const ok = await request(app).delete(`/api/customers/${await idOf(1002)}`).set(auth(tokens.admin));
    expect(ok.status).toBe(200);
    expect(await Customers.findOne({ accountNumber: 1002 })).toBeNull();
  });

  test('malformed ids return 400, not a 500 with internals', async () => {
    const res = await request(app).put('/api/customers/not-an-id').set(auth(tokens.admin)).send({});
    expect(res.status).toBe(400);
  });
});

// =====================================================================
describe('find-account', () => {
  const find = (token, body) => request(app).post('/api/customers/find-account').set(auth(token)).send(body);

  test('employee finds accounts in own branch only', async () => {
    expect((await find(tokens.employeeKolkata, { accountNumber: 1001 })).body.data.accountNumber).toBe(1001);
    expect((await find(tokens.employeeDelhi, { accountNumber: 1001 })).body.data).toBeNull();
  });

  test('operator injection is rejected', async () => {
    expect((await find(tokens.admin, { accountNumber: { $ne: 0 } })).status).toBe(400);
    expect((await find(tokens.admin, { fullname: 'Customer A' })).status).toBe(400);
  });

  test('a customer can only ever look up their own account', async () => {
    const res = await find(tokens.customerA, { accountNumber: 1002 });
    expect(res.body.data.accountNumber).toBe(1001);
  });
});

// =====================================================================
describe('transaction reports are scoped by the token, not the query string', () => {
  const row = (accountNumber, branch) => ({
    accountNumber, customerId: 'x', type: 'credit', amount: 10, remark: 'r',
    currentBalance: 0, finalBalance: 10, branch, createdBy: 't',
  });

  beforeEach(async () => {
    await Transactions.create([row(1001, 'kolkata'), row(1001, 'kolkata'), row(1002, 'kolkata'), row(2001, 'delhi')]);
  });

  test("customer asking for someone else's account still gets only their own", async () => {
    const res = await request(app).get('/api/transactions/pagination?accountNumber=1002').set(auth(tokens.customerA));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data.every((t) => t.accountNumber === 1001)).toBe(true);

    const sum = await request(app).get('/api/transactions/summary?accountNumber=1002').set(auth(tokens.customerA));
    expect(sum.body.totalTransactions).toBe(2);
  });

  test("employee asking for another branch still gets only their own", async () => {
    const res = await request(app).get('/api/transactions/pagination?branch=kolkata').set(auth(tokens.employeeDelhi));
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].branch).toBe('delhi');
  });

  test('admin can see everything and filter freely', async () => {
    const all = await request(app).get('/api/transactions/pagination').set(auth(tokens.admin));
    expect(all.body.total).toBe(4);
    const one = await request(app).get('/api/transactions/pagination?branch=delhi').set(auth(tokens.admin));
    expect(one.body.total).toBe(1);
  });

  test('operator injection and silly paging values do not crash or leak', async () => {
    const inj = await request(app).get('/api/transactions/pagination?branch[$ne]=zzz').set(auth(tokens.admin));
    expect(inj.status).toBe(200);
    const bad = await request(app).get('/api/transactions/pagination?limit=-5&page=abc&fromDate=nope&toDate=nope').set(auth(tokens.admin));
    expect(bad.status).toBe(200);
  });
});

// =====================================================================
describe('users', () => {
  const makeUser = (extra = {}) =>
    Users.create({ fullname: 'Staff', email: 'staff@test.com', password: 'oldsecret', userType: 'employee', isActive: true, ...extra });

  test('the user list never contains password hashes', async () => {
    await makeUser();
    const res = await request(app).get('/api/users').set(auth(tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data.every((u) => u.password === undefined)).toBe(true);
  });

  test('creating a user does not echo the hash back', async () => {
    const res = await request(app).post('/api/users').set(auth(tokens.admin))
      .send({ fullname: 'N', email: 'n@test.com', password: 'abc123', userType: 'employee', isActive: true });
    expect(res.status).toBe(200);
    expect(res.body.data.password).toBeUndefined();
    expect(res.body.data._id).toBeDefined(); // frontend needs the id
  });

  test('changing a password hashes it (login works with the new one only)', async () => {
    const user = await makeUser();
    const put = await request(app).put(`/api/users/${user._id}`).set(auth(tokens.admin)).send({ password: 'newsecret' });
    expect(put.status).toBe(200);

    const stored = await Users.findById(user._id);
    expect(stored.password).not.toBe('newsecret'); // not plain text
    expect(stored.password.startsWith('$2')).toBe(true); // bcrypt

    const good = await request(app).post('/api/login').send({ email: 'staff@test.com', password: 'newsecret' });
    expect(good.status).toBe(200);
    const old = await request(app).post('/api/login').send({ email: 'staff@test.com', password: 'oldsecret' });
    expect(old.status).toBe(401);
  });

  test('admins cannot delete their own account', async () => {
    const res = await request(app).delete(`/api/users/${'a'.repeat(24)}`).set({
      Authorization: `Bearer ${require('jsonwebtoken').sign({ _id: 'a'.repeat(24), userType: 'admin' }, process.env.JWT_SECRET)}`,
    });
    expect(res.status).toBe(409);
  });
});

// =====================================================================
describe('uploads', () => {
  const upload = (token, folder, file, opts = {}) =>
    request(app).post('/api/upload').query({ folderName: folder }).set(auth(token))
      .attach('file', file, { filename: opts.filename || 'a.png', contentType: opts.contentType || 'image/png' });

  test('a valid image is stored with a random server-chosen name', async () => {
    const res = await upload(tokens.employeeKolkata, 'testuploads', Buffer.from('fake-png-bytes'));
    expect(res.status).toBe(200);
    expect(res.body.filePath).toMatch(/^\/testuploads\/file-\d+-[a-f0-9]{16}\.png$/);
    expect(fs.existsSync(path.join(__dirname, '../public', res.body.filePath))).toBe(true);
  });

  test('path traversal in folderName is rejected', async () => {
    const res = await upload(tokens.admin, '../evil', Buffer.from('x'));
    expect(res.status).toBe(400);
    expect(fs.existsSync(path.join(__dirname, '..', 'evil'))).toBe(false);
  });

  test('HTML / script uploads are rejected', async () => {
    const res = await upload(tokens.admin, 'testuploads', Buffer.from('<script>alert(1)</script>'), {
      filename: 'x.html', contentType: 'text/html',
    });
    expect(res.status).toBe(400);
  });

  test('files over 2 MB are rejected', async () => {
    const res = await upload(tokens.admin, 'testuploads', Buffer.alloc(2 * 1024 * 1024 + 100));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too large/i);
  });
});

// =====================================================================
describe('headers & CORS', () => {
  test('browsers on unknown origins get no CORS permission', async () => {
    const res = await request(app).options('/api/branding')
      .set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('the real frontend origin is allowed', async () => {
    const res = await request(app).get('/api/branding').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  test('helmet headers are present and x-powered-by is gone', async () => {
    const res = await request(app).get('/api/branding');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('images stay loadable cross-origin (frontend on a different domain)', async () => {
    const res = await request(app).get('/api/branding');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});

// =====================================================================
// Keep these LAST: they exhaust the (test-sized) login rate limit for this IP.
describe('login', () => {
  const login = (body) => request(app).post('/api/login').send(body);

  test('NoSQL operator in the email field is rejected', async () => {
    const res = await login({ email: { $ne: null }, password: 'x' });
    expect(res.status).toBe(400);
  });

  test('wrong password -> 401 without leaking internals', async () => {
    await Users.create({ fullname: 'S', email: 'staff@test.com', password: 'secret1', userType: 'employee', isActive: true });
    const res = await login({ email: 'staff@test.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.isLogged).toBe(false);
    expect(res.body.error).toBeUndefined();
  });

  test('correct credentials return a token (successful logins do not count toward the limit)', async () => {
    await Users.create({ fullname: 'S', email: 'staff@test.com', password: 'secret1', userType: 'employee', isActive: true });
    const res = await login({ email: '  STAFF@test.com ', password: 'secret1' }); // email is normalised
    expect(res.status).toBe(200);
    expect(res.body.isLogged).toBe(true);
    expect(typeof res.body.token).toBe('string');
  });

  test('repeated failures are rate limited (429)', async () => {
    let limited;
    for (let i = 0; i < 12 && !limited; i++) {
      const res = await login({ email: 'nobody@test.com', password: 'bad' });
      if (res.status === 429) limited = res;
    }
    expect(limited).toBeDefined();
    expect(limited.body.isLogged).toBe(false);
  });
});