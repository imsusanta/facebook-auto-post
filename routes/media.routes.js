const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const upload = require('../middleware/upload');
const { UPLOADS_DIR } = require('../config/constants');

const uploadPath = path.join(__dirname, '..', UPLOADS_DIR);

// GET /api/media
router.get('/', (req, res, next) => {
  try {
    const files = fs.readdirSync(uploadPath);
    const mediaList = files
      .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
      .map(f => {
        const stats = fs.statSync(path.join(uploadPath, f));
        return {
          fileName: f,
          url: `/uploads/${f}`,
          size: stats.size,
          createdAt: stats.mtime
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(mediaList);
  } catch (err) {
    next(err);
  }
});

// POST /api/media/upload
router.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No image file uploaded' });
  }
  res.json({
    success: true,
    fileName: req.file.filename,
    url: `/uploads/${req.file.filename}`,
    size: req.file.size
  });
});

// DELETE /api/media/:fileName
router.delete('/:fileName', (req, res, next) => {
  try {
    const target = path.join(uploadPath, path.basename(req.params.fileName));
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      return res.json({ success: true });
    }
    res.status(404).json({ error: 'File not found' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
