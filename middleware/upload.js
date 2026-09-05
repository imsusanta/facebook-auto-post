const multer = require('multer');
const media = require('../security/media');
const parse = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: media.MAX_BYTES,
    files: 1,
    fields: 20,
    fieldSize: 64 * 1024,
    parts: 21
  }
});
module.exports = {
  single(field) {
    return [
      parse.single(field),
      async (req, res, next) => {
        if (req.file) req.file = await media.store(req.file.buffer);
        next();
      }
    ];
  }
};
