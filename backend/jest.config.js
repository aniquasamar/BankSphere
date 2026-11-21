module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000, // first run downloads a mongod binary for mongodb-memory-server
  collectCoverageFrom: [
    'services/transaction.service.js',
    'controller/transaction.controller.js',
    'middlewares/*.js',
    'config/security.js',
    'routes/*.js',
    'services/upload.service.js',
  ],
};