const express = require('express');
const router = express.Router();
const uploadController = require('../controller/upload.controller');
const upload = require('../services/upload.service');
const { verifyToken, isAdminEmployee } = require('../middlewares/middleware');

// Run multer ourselves so its errors (bad type, too large, bad folder) come back as JSON 400s.
const handleUpload = (req, res, next) =>
  upload.single('file')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 2 MB)' : err.message;
      return res.status(400).json({ message });
    }
    next();
  });

router.post('/', verifyToken, isAdminEmployee, handleUpload, uploadController.uploadFile);

module.exports = router;