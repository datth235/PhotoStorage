/* ------------------------------------------------------------------
   Thư viện ảnh - máy chủ lưu trữ / chia sẻ ảnh kiểu Imgur
   - Ai cũng xem được thư viện ảnh
   - Đăng nhập để tải lên & xoá ảnh
   - Tự tạo ảnh thu nhỏ (thumbnail) + bản vừa để xem nhanh trên điện thoại
------------------------------------------------------------------ */
'use strict';

const express = require('express');
const session = require('express-session');
const compression = require('compression');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// sharp là gói tạo thumbnail. Nạp "mềm": nếu máy không cài được thì web vẫn chạy,
// chỉ là lưới ảnh sẽ tải ảnh gốc thay vì bản thu nhỏ.
let sharp = null;
try {
  sharp = require('sharp');
} catch {
  console.warn('!  Không nạp được "sharp" — bỏ qua việc tạo thumbnail (web vẫn chạy).');
}

const app = express();
const PORT = process.env.PORT || 5000;

/* ---------- Cấu hình ---------- */
const MAX_FILE_MB = 25;

/* ---------- Tài khoản đăng nhập ----------
   Thêm / bớt tài khoản ở đây theo dạng  "tên đăng nhập": "mật khẩu".
   Mọi tài khoản đều có quyền tải lên & xoá ảnh.                        */
const USERS = {
  admin: 'admin',
  linhxinhgai: 'yeubelinh',
};
// Tuỳ chọn: ghi đè / bổ sung qua biến môi trường, ví dụ
//   $env:USERS='{"sep":"matkhaumanh","linh":"123456"}'
try {
  if (process.env.USERS) Object.assign(USERS, JSON.parse(process.env.USERS));
} catch {
  console.warn('!  Biến môi trường USERS không phải JSON hợp lệ — bỏ qua.');
}

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const THUMB_DIR = path.join(UPLOAD_DIR, 'thumb');
const MED_DIR = path.join(UPLOAD_DIR, 'med');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'images.json');

/* ---------- Chuẩn bị thư mục & "database" ---------- */
for (const dir of [UPLOAD_DIR, THUMB_DIR, MED_DIR, DATA_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return [];
  }
}
function writeDB(items) {
  fs.writeFileSync(DB_FILE, JSON.stringify(items, null, 2));
}

/* ---------- Multer: nhận file ảnh ---------- */
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
  'image/heic',
  'image/heif',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const id = crypto.randomBytes(8).toString('hex');
    let ext = path.extname(file.originalname).toLowerCase();
    if (!/^\.[a-z0-9]{2,5}$/.test(ext)) ext = '.' + (file.mimetype.split('/')[1] || 'jpg');
    cb(null, id + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Định dạng không hỗ trợ: ${file.mimetype || 'không rõ'}. Hãy chọn ảnh JPG, PNG, GIF, WebP, HEIC…`));
  },
});

/* ---------- Tạo thumbnail + bản vừa cho 1 ảnh ---------- */
async function makeVariants(id, filePath, mimetype) {
  const url = `/uploads/${path.basename(filePath)}`;
  const fallback = { width: null, height: null, thumbUrl: url, mediumUrl: url };

  if (!sharp || mimetype === 'image/svg+xml') return fallback;

  try {
    const meta = await sharp(filePath, { failOn: 'none' }).metadata();
    const animated = (meta.pages || 1) > 1;

    // Kích thước hiển thị thật (xét xoay EXIF)
    let w = meta.width || null;
    let h = meta.height || null;
    if (meta.orientation && meta.orientation >= 5 && w && h) [w, h] = [h, w];

    // Thumbnail (~640px, khung đầu nếu ảnh động)
    const tInfo = await sharp(filePath, { failOn: 'none' })
      .rotate()
      .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 74 })
      .toFile(path.join(THUMB_DIR, id + '.webp'));

    // Bản vừa cho lightbox (chỉ khi ảnh tĩnh & lớn hơn 1600px)
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

/* ---------- Middleware ---------- */
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    name: 'iv.sid',
    secret: process.env.SESSION_SECRET || crypto.randomBytes(24).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

function authed(req) {
  const u = req.session && req.session.user;
  return !!(u && Object.hasOwn(USERS, u));
}
function requireAuth(req, res, next) {
  if (authed(req)) return next();
  return res.status(401).json({ error: 'Bạn cần đăng nhập để thực hiện thao tác này.' });
}

/* ---------- Trang (mặc định là màn hình đăng nhập khi chưa đăng nhập) ---------- */
const page = (name) => path.join(PUBLIC_DIR, name);

app.get(['/', '/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(page(authed(req) ? 'index.html' : 'login.html'));
});
app.get('/login', (req, res) => {
  if (authed(req)) return res.redirect('/');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(page('login.html'));
});
app.get('/i/:id', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(page(authed(req) ? 'image.html' : 'login.html'));
});

/* ---------- File tĩnh ---------- */
// Ảnh upload: tên ngẫu nhiên, không đổi -> cache vĩnh viễn.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '365d', immutable: true }));
// CSS/JS/HTML: luôn kiểm tra bản mới (dùng ETag -> 304 nếu chưa đổi) để sửa là thấy ngay.
app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    etag: true,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

/* ---------- API: xác thực ---------- */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username && Object.hasOwn(USERS, username) && USERS[username] === password) {
    req.session.user = username;
    return res.json({ ok: true, user: username });
  }
  return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu.' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('iv.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  res.json({ user: (req.session && req.session.user) || null });
});

/* ---------- API: ảnh (đều cần đăng nhập) ---------- */
app.get('/api/images', requireAuth, (req, res) => {
  const all = readDB().sort((a, b) => b.uploadedAt - a.uploadedAt);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  const items = all.slice(offset, offset + limit);
  const nextOffset = offset + limit < all.length ? offset + limit : null;
  res.json({ items, total: all.length, nextOffset });
});

app.get('/api/images/:id', requireAuth, (req, res) => {
  const item = readDB().find((x) => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Không tìm thấy ảnh.' });
  res.json(item);
});

app.post('/api/upload', requireAuth, (req, res) => {
  upload.array('images', 20)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ error: 'Chưa chọn file ảnh nào.' });

    const title = (req.body.title || '').trim();
    const added = [];
    for (const f of req.files) {
      const id = path.parse(f.filename).name;
      const v = await makeVariants(id, f.path, f.mimetype);
      added.push({
        id,
        filename: f.filename,
        originalName: f.originalname,
        title: title || f.originalname,
        size: f.size,
        mimetype: f.mimetype,
        url: `/uploads/${f.filename}`,
        thumbUrl: v.thumbUrl,
        mediumUrl: v.mediumUrl,
        width: v.width,
        height: v.height,
        uploadedAt: Date.now(),
      });
    }

    const db = readDB();
    db.push(...added);
    writeDB(db);
    res.json({ ok: true, images: added });
  });
});

app.delete('/api/images/:id', requireAuth, (req, res) => {
  const db = readDB();
  const idx = db.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy ảnh.' });
  const [removed] = db.splice(idx, 1);
  writeDB(db);

  const unlink = (p) => fs.promises.unlink(p).catch(() => {});
  unlink(path.join(UPLOAD_DIR, removed.filename));
  unlink(path.join(THUMB_DIR, removed.id + '.webp'));
  unlink(path.join(MED_DIR, removed.id + '.webp'));

  res.json({ ok: true });
});

/* ---------- Khởi động ---------- */
app.listen(PORT, () => {
  console.log(`
  Thư viện ảnh đang chạy  ->  http://localhost:${PORT}
  Tài khoản: ${Object.keys(USERS).join(', ')}
  Thumbnail: ${sharp ? 'bật (sharp)' : 'TẮT — không có sharp'}
`);
});
