/* ------------------------------------------------------------------
   Lưu trữ FILE ẢNH.
   - Có biến môi trường CLOUDINARY_URL  -> đẩy ảnh lên Cloudinary (khuyên dùng)
   - Không có                           -> lưu vào thư mục uploads/ + tạo thumbnail
                                           bằng sharp (chỉ nên dùng khi chạy máy cá nhân)
------------------------------------------------------------------ */
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const CLOUDINARY_ON = !!process.env.CLOUDINARY_URL;
const FOLDER = process.env.CLOUDINARY_FOLDER || 'thuvien-anh';

let cloudinary = null;
if (CLOUDINARY_ON) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({ secure: true }); // key/secret/cloud lấy tự động từ CLOUDINARY_URL
}

/* ---------- Chế độ lưu cục bộ (sharp) ---------- */
const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const THUMB_DIR = path.join(UPLOAD_DIR, 'thumb');
const MED_DIR = path.join(UPLOAD_DIR, 'med');

let sharp = null;
if (!CLOUDINARY_ON) {
  for (const dir of [UPLOAD_DIR, THUMB_DIR, MED_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  try {
    sharp = require('sharp');
  } catch {
    console.warn('!  Không nạp được "sharp" — lưới ảnh sẽ dùng ảnh gốc thay cho bản thu nhỏ.');
  }
}

function label() {
  return CLOUDINARY_ON ? `Cloudinary (folder: ${FOLDER})` : 'thư mục uploads/ + sharp';
}

/* ---------- Tạo thumbnail + bản vừa cho ảnh lưu cục bộ ---------- */
async function localVariants(id, filePath, mimetype) {
  const url = `/uploads/${path.basename(filePath)}`;
  const fallback = { width: null, height: null, thumbUrl: url, mediumUrl: url };
  if (!sharp || mimetype === 'image/svg+xml') return fallback;

  try {
    const meta = await sharp(filePath, { failOn: 'none' }).metadata();
    const animated = (meta.pages || 1) > 1;
    let w = meta.width || null;
    let h = meta.height || null;
    if (meta.orientation && meta.orientation >= 5 && w && h) [w, h] = [h, w];

    const tInfo = await sharp(filePath, { failOn: 'none' })
      .rotate()
      .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 74 })
      .toFile(path.join(THUMB_DIR, id + '.webp'));

    let mediumUrl = url;
    const longEdge = Math.max(meta.width || 0, meta.height || 0);
    if (!animated && longEdge > 1600) {
      await sharp(filePath, { failOn: 'none' })
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(path.join(MED_DIR, id + '.webp'));
      mediumUrl = `/uploads/med/${id}.webp`;
    }

    return {
      width: w || tInfo.width,
      height: h || tInfo.height,
      thumbUrl: `/uploads/thumb/${id}.webp`,
      mediumUrl,
    };
  } catch (e) {
    console.warn(`!  Không tạo được thumbnail cho ${id}: ${e.message}`);
    return fallback;
  }
}

/* ---------- Đẩy 1 ảnh (buffer) vào kho ---------- */
async function put(buffer, file) {
  if (CLOUDINARY_ON) {
    const r = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: FOLDER, resource_type: 'image' },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(buffer);
    });

    const variant = (px) =>
      cloudinary.url(r.public_id, {
        secure: true,
        resource_type: 'image',
        version: r.version,
        format: r.format,
        transformation: [{ width: px, height: px, crop: 'limit' }, { quality: 'auto' }],
      });

    return {
      storageId: r.public_id,
      filename: r.public_id,
      url: r.secure_url,
      thumbUrl: variant(640),
      mediumUrl: variant(1600),
      width: r.width || null,
      height: r.height || null,
    };
  }

  // ----- lưu cục bộ -----
  const id = crypto.randomBytes(8).toString('hex');
  let ext = path.extname(file.originalname || '').toLowerCase();
  if (!/^\.[a-z0-9]{2,5}$/.test(ext)) ext = '.' + ((file.mimetype || '').split('/')[1] || 'jpg');
  const filename = id + ext;
  const filePath = path.join(UPLOAD_DIR, filename);
  await fs.promises.writeFile(filePath, buffer);
  const v = await localVariants(id, filePath, file.mimetype);
  return {
    storageId: id,
    filename,
    url: `/uploads/${filename}`,
    thumbUrl: v.thumbUrl,
    mediumUrl: v.mediumUrl,
    width: v.width,
    height: v.height,
  };
}

/* ---------- Xoá file ảnh khỏi kho ---------- */
async function remove(img) {
  if (!img) return;
  if (CLOUDINARY_ON) {
    if (img.storageId) {
      await cloudinary.uploader.destroy(img.storageId, { resource_type: 'image' }).catch(() => {});
    }
    return;
  }
  const unlink = (p) => fs.promises.unlink(p).catch(() => {});
  if (img.filename) unlink(path.join(UPLOAD_DIR, img.filename));
  const base = img.storageId || (img.filename ? path.parse(img.filename).name : img.id);
  if (base) {
    unlink(path.join(THUMB_DIR, base + '.webp'));
    unlink(path.join(MED_DIR, base + '.webp'));
  }
}

module.exports = { put, remove, label, CLOUDINARY_ON, UPLOAD_DIR };
