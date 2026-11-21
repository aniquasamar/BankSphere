const mongoose = require('mongoose');
const { Schema } = mongoose;

const transactionsSchema = new Schema(
  {
    accountNumber: { type: Number, required: true },
    customerId: { type: String, required: true },
    type: { type: String, required: true, enum: ['credit', 'debit'] },
    amount: { type: Number, required: true, min: 0.01 },
    remark: { type: String, required: true },
    currentBalance: { type: Number, required: true }, // balance before this entry
    finalBalance: { type: Number, required: true },   // balance after this entry
    branch: { type: String, required: true },
    createdBy: { type: String, required: true },

    // ---- new fields (all optional so old documents stay valid) ----
    kind: { type: String, enum: ['deposit', 'withdrawal', 'transfer'] },
    transferId: { type: String },            // links the debit + credit legs of one transfer
    counterpartyAccount: { type: Number },   // the "other side" of a transfer
    idempotencyKey: { type: String },        // makes client retries safe
  },
  { timestamps: true }
);

// Same key can never be posted twice. Partial index => old docs without a key are ignored.
transactionsSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
// Speeds up the paginated/filtered statement queries used by the dashboards.
transactionsSchema.index({ accountNumber: 1, createdAt: -1 });
transactionsSchema.index({ branch: 1, createdAt: -1 });
transactionsSchema.index({ transferId: 1 }, { sparse: true });

module.exports = mongoose.model('Transaction', transactionsSchema);