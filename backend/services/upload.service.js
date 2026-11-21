const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Extension comes from the (checked) mimetype, NEVER from the user's filename,
// so an upload can never be stored as .html / .js / .exe and served back.
const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};
const FOLDER_NAME = /^[A-Za-z0-9_-]{1,40}$/; // blocks "../" path traversal

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folderName = req.query.folderName;
    if (typeof folderName !== 'string' || !FOLDER_NAME.test(folderName)) {
      return cb(new Error('Invalid folder name'));
    }
    const uploadPath = path.join(__dirname, '../public', folderName);
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    cb(null, `${file.fieldname}-${unique}${ALLOWED_TYPES[file.mimetype]}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }, // 2 MB
  fileFilter: (req, file, cb) =>
    ALLOWED_TYPES[file.mimetype] ? cb(null, true) : cb(new Error('Only JPG, PNG, WEBP or PDF files are allowed')),
});

module.exports = upload;