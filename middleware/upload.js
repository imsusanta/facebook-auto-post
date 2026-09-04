const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { UPLOADS_DIR, FACEBOOK } = require('../config/constants');

const uploadPath = path.join(__dirname, '..', UPLOADS_DIR);
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadPath),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  if (FACEBOOK.ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF images are allowed.'));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: FACEBOOK.MAX_IMAGE_SIZE_MB * 1024 * 1024 },
  fileFilter
});

module.exports = upload;
