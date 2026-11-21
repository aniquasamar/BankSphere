module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000, // first run downloads a mongod binary for mongodb-memory-server
  collectCoverageFrom: [
    'services/transaction.service.js',
    'controller/transaction.controller.js',
    'routes/transaction.routes.js',
    'middlewares/middleware.js',
  ],
};