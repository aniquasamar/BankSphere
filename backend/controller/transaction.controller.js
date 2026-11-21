const { z } = require('zod'); // npm i zod
const service = require('../services/transaction.service');

const accountNo = z.coerce.number().int().positive();
const amount = z.coerce
  .number()
  .positive()
  .max(10_000_000)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Max 2 decimal places');
const remark = z.string().trim().min(1).max(200);
const idemKey = z.string().min(8).max(100);

const schemas = {
  single: z.object({ accountNumber: accountNo, amount, remark }),
  transfer: z.object({ fromAccount: accountNo, toAccount: accountNo, amount, remark: remark.optional() }),
};

// Wraps a handler: validates input, maps TxError -> HTTP status, hides internals on 500.
const handle = (schema, run) => async (req, res) => {
  const parsed = schema.safeParse(req.body);
  const key = idemKey.safeParse(req.get('Idempotency-Key'));
  if (!parsed.success || !key.success) {
    const issues = [
      ...(parsed.error?.issues || []),
      ...(key.error?.issues || []).map((i) => ({ ...i, path: ['Idempotency-Key'] })),
    ];
    return res.status(400).json({
      success: false,
      message: 'Invalid request',
      errors: issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  try {
    const { entries, replayed } = await run({ ...parsed.data, actor: req.user, idempotencyKey: key.data });
    return res.status(replayed ? 200 : 201).json({
      success: true,
      replayed, // true => this was a retry; nothing was posted twice
      message: replayed ? 'Request already processed' : 'Transaction successful',
      data: entries,
    });
  } catch (err) {
    if (err instanceof service.TxError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error('Transaction error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  deposit: handle(schemas.single, service.deposit),
  withdraw: handle(schemas.single, service.withdraw),
  transfer: handle(schemas.transfer, service.transfer),
};