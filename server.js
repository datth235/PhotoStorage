/* ------------------------------------------------------------------
   Thư viện ảnh — máy chủ lưu trữ / chia sẻ ảnh kiểu Imgur
   - Đăng nhập để xem / tải lên / xoá ảnh (web riêng của 2 người)
   - Kỷ niệm: album ảnh có tên, nằm trong Thư viện ảnh
   - Hẹn hò: 2 tài khoản ghép đôi -> dùng chung 1 thư viện

   LƯU TRỮ (xem lib/db.js và lib/storage.js):
   - MONGODB_URI   -> metadata lưu ở MongoDB   (không có -> file JSON trong data/)
   - CLOUDINARY_URL-> ảnh lưu ở Cloudinary     (không có -> thư mục uploads/ + sharp)
------------------------------------------------------------------ */
'use strict';

require('dotenv').config({ quiet: true });

const express = require('express');
const session = require('express-session');
const compression = require('compression');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const db = require('./lib/db');
const storage = require('./lib/storage');

const app = express();
const PORT = process.env.PORT || 5000;

/* ---------- Cấu hình ---------- */
const MAX_FILE_MB = 25;

/* ---------- Tài khoản đăng nhập ----------
   Thêm / bớt tài khoản ở đây theo dạng  "tên đăng nhập": "mật khẩu".        */
const USERS = {
  admin: 'admin',
  linhxinhgai: 'yeubelinh',
  anhdatdeptrai: 'yeuembelinh',
};
try {
  if (process.env.USERS) Object.assign(USERS, JSON.parse(process.env.USERS));
} catch {
  console.warn('!  Biến môi trường USERS không phải JSON hợp lệ — bỏ qua.');
}

const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------- Cache tình trạng hẹn hò (đọc từ DB 1 lần, cập nhật khi có thay đổi) ---------- */
let relState = { requests: [], couples: [] };
async function reloadRel() {
  relState = await db.getRelationship();
}

/** Cặp đôi mà user đang thuộc về, hoặc null */
function coupleOf(user) {
  return relState.couples.find((c) => c.members.includes(user)) || null;
}
/** "Phạm vi" thư viện: id cặp đôi nếu đang hẹn hò, ngược lại là tên đăng nhập */
function scopeOf(user) {
  const c = coupleOf(user);
  return c ? c.id : user;
}

/* ---------- Multer: nhận file ảnh vào bộ nhớ (rồi đẩy sang kho) ---------- */
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'image/bmp', 'image/svg+xml', 'image/heic', 'image/heif',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 50 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Định dạng không hỗ trợ: ${file.mimetype || 'không rõ'}. Hãy chọn ảnh JPG, PNG, GIF, WebP, HEIC…`));
  },
});

/** Đẩy các file vừa nhận lên kho + tạo bản ghi ảnh */
async function buildImageRecords(files, { owner, title, memoryId }) {
  const scope = scopeOf(owner);
  const records = [];
  for (const f of files) {
    const stored = await storage.put(f.buffer, f);
    const rec = {
      id: crypto.randomBytes(8).toString('hex'),
      storageId: stored.storageId,
      filename: stored.filename,
      originalName: f.originalname,
      title: title || f.originalname,
      owner,
      scope,
      size: f.size,
      mimetype: f.mimetype,
      url: stored.url,
      thumbUrl: stored.thumbUrl,
      mediumUrl: stored.mediumUrl,
      width: stored.width,
      height: stored.height,
      uploadedAt: Date.now(),
    };
    if (memoryId) rec.memoryId = memoryId;
    records.push(rec);
  }
  return records;
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
function onError(res, e) {
  console.error(e);
  if (!res.headersSent) res.status(500).json({ error: 'Lỗi máy chủ. Thử lại sau nhé.' });
}
/** Bọc route handler async */
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => onError(res, e));
/** Nhận file qua multer rồi chạy handler async (multer gọi callback với 1 tham số err) */
function receive(field, max, req, res, fn) {
  upload.array(field, max)(req, res, (err) => Promise.resolve(fn(err)).catch((e) => onError(res, e)));
}

/* ---------- Trang ---------- */
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
// Ảnh lưu cục bộ (chỉ dùng khi không bật Cloudinary)
app.use('/uploads', express.static(storage.UPLOAD_DIR, { maxAge: '365d', immutable: true }));
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

/* ---------- API: ảnh ---------- */
app.get(
  '/api/images',
  requireAuth,
  wrap(async (req, res) => {
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const page = await db.loosePhotos(scopeOf(req.session.user), offset, limit);
    res.json(page);
  })
);

app.get(
  '/api/images/:id',
  requireAuth,
  wrap(async (req, res) => {
    const item = await db.getPhoto(req.params.id);
    if (!item || (item.scope || item.owner) !== scopeOf(req.session.user))
      return res.status(404).json({ error: 'Không tìm thấy ảnh.' });
    res.json(item);
  })
);

app.post('/api/upload', requireAuth, (req, res) => {
  receive('images', 20, req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ error: 'Chưa chọn file ảnh nào.' });

    const added = await buildImageRecords(req.files, {
      owner: req.session.user,
      title: (req.body.title || '').trim(),
    });
    await db.addPhotos(added);
    res.json({ ok: true, images: added });
  });
});

app.delete(
  '/api/images/:id',
  requireAuth,
  wrap(async (req, res) => {
    const existing = await db.getPhoto(req.params.id);
    if (!existing || (existing.scope || existing.owner) !== scopeOf(req.session.user))
      return res.status(404).json({ error: 'Không tìm thấy ảnh.' });
    const removed = (await db.deletePhoto(req.params.id)) || existing;
    await storage.remove(removed);
    res.json({ ok: true });
  })
);

/* ---------- API: kỷ niệm (album ảnh) ---------- */
function packMemory(mem, photos) {
  const imgs = photos.slice().sort((a, b) => b.uploadedAt - a.uploadedAt);
  return { ...mem, images: imgs, count: imgs.length, cover: imgs[0] || null };
}

app.get(
  '/api/memories',
  requireAuth,
  wrap(async (req, res) => {
    const scope = scopeOf(req.session.user);
    const [mems, photos] = await Promise.all([db.listMemories(scope), db.memoryPhotos(scope)]);
    const byMem = {};
    for (const p of photos) (byMem[p.memoryId] || (byMem[p.memoryId] = [])).push(p);
    res.json({ items: mems.map((m) => packMemory(m, byMem[m.id] || [])) });
  })
);

app.get(
  '/api/memories/:id',
  requireAuth,
  wrap(async (req, res) => {
    const mem = await db.getMemory(req.params.id);
    if (!mem || mem.scope !== scopeOf(req.session.user))
      return res.status(404).json({ error: 'Không tìm thấy kỷ niệm.' });
    res.json(packMemory(mem, await db.photosInMemory(mem.id)));
  })
);

app.post('/api/memories', requireAuth, (req, res) => {
  receive('images', 50, req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Hãy đặt tên cho kỷ niệm.' });
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ error: 'Hãy chọn ít nhất 1 ảnh cho kỷ niệm.' });

    const owner = req.session.user;
    const memId = 'm_' + crypto.randomBytes(8).toString('hex');
    const added = await buildImageRecords(req.files, { owner, title: name, memoryId: memId });
    await db.addPhotos(added);

    const mem = {
      id: memId,
      name,
      scope: scopeOf(owner),
      createdBy: owner,
      createdAt: Date.now(),
    };
    await db.addMemory(mem);
    res.json({ ok: true, memory: packMemory(mem, added) });
  });
});

/** Thêm ảnh vào một kỷ niệm đã có */
app.post(
  '/api/memories/:id/images',
  requireAuth,
  wrap(async (req, res) => {
    const mem = await db.getMemory(req.params.id);
    if (!mem || mem.scope !== scopeOf(req.session.user))
      return res.status(404).json({ error: 'Không tìm thấy kỷ niệm.' });

    receive('images', 50, req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.files || req.files.length === 0)
        return res.status(400).json({ error: 'Chưa chọn ảnh nào.' });

      const added = await buildImageRecords(req.files, {
        owner: req.session.user,
        title: mem.name,
        memoryId: mem.id,
      });
      await db.addPhotos(added);
      res.json({ ok: true, memory: packMemory(mem, await db.photosInMemory(mem.id)) });
    });
  })
);

app.delete(
  '/api/memories/:id',
  requireAuth,
  wrap(async (req, res) => {
    const mem = await db.getMemory(req.params.id);
    if (!mem || mem.scope !== scopeOf(req.session.user))
      return res.status(404).json({ error: 'Không tìm thấy kỷ niệm.' });

    await db.deleteMemory(req.params.id);
    const removed = await db.deletePhotosOfMemory(mem.id);
    await Promise.all(removed.map((img) => storage.remove(img)));
    res.json({ ok: true });
  })
);

/* ---------- API: hẹn hò ---------- */
app.get('/api/relationship', requireAuth, (req, res) => {
  const me = req.session.user;
  const couple = coupleOf(me);
  const partner = couple ? couple.members.find((m) => m !== me) : null;
  res.json({
    me,
    partner,
    since: couple ? couple.since : null,
    incoming: relState.requests.filter((r) => r.to === me).map((r) => r.from),
    outgoing: relState.requests.filter((r) => r.from === me).map((r) => r.to),
    candidates: Object.keys(USERS).filter((u) => u !== me),
  });
});

app.post(
  '/api/relationship/request',
  requireAuth,
  wrap(async (req, res) => {
    const me = req.session.user;
    const to = ((req.body && req.body.to) || '').trim();

    if (!Object.hasOwn(USERS, to)) return res.status(400).json({ error: 'Không có tài khoản này.' });
    if (to === me) return res.status(400).json({ error: 'Không thể tự hẹn hò với chính mình 😅.' });
    if (coupleOf(me)) return res.status(400).json({ error: 'Bạn đang hẹn hò rồi. Hãy chia tay trước đã.' });
    if (coupleOf(to)) return res.status(400).json({ error: `${to} đang hẹn hò với người khác rồi.` });

    const reverse = relState.requests.find((r) => r.from === to && r.to === me);
    if (reverse) return res.json(await pairUp(to, me));

    if (relState.requests.some((r) => r.from === me && r.to === to))
      return res.status(400).json({ error: 'Đã gửi lời mời cho người này rồi.' });

    relState.requests.push({ from: me, to, at: Date.now() });
    await db.saveRelationship(relState);
    res.json({ ok: true, status: 'requested' });
  })
);

app.post(
  '/api/relationship/accept',
  requireAuth,
  wrap(async (req, res) => {
    const me = req.session.user;
    const from = ((req.body && req.body.from) || '').trim();
    if (!relState.requests.some((r) => r.from === from && r.to === me))
      return res.status(400).json({ error: 'Không tìm thấy lời mời này.' });
    if (coupleOf(me) || coupleOf(from))
      return res.status(400).json({ error: 'Một trong hai người đang hẹn hò rồi.' });
    res.json(await pairUp(from, me));
  })
);

async function pairUp(a, b) {
  const id = 'c_' + crypto.randomBytes(6).toString('hex');
  relState.couples.push({ id, members: [a, b], since: Date.now() });
  relState.requests = relState.requests.filter(
    (r) => ![a, b].includes(r.from) && ![a, b].includes(r.to)
  );
  await db.saveRelationship(relState);
  await db.rescopePhotosByOwner([a, b], id);
  await db.rescopeMemoriesByCreator([a, b], id);
  return { ok: true, status: 'together' };
}

app.post(
  '/api/relationship/decline',
  requireAuth,
  wrap(async (req, res) => {
    const me = req.session.user;
    const other = ((req.body && req.body.user) || '').trim();
    relState.requests = relState.requests.filter(
      (r) => !((r.from === me && r.to === other) || (r.from === other && r.to === me))
    );
    await db.saveRelationship(relState);
    res.json({ ok: true });
  })
);

app.post(
  '/api/relationship/breakup',
  requireAuth,
  wrap(async (req, res) => {
    const me = req.session.user;
    const idx = relState.couples.findIndex((c) => c.members.includes(me));
    if (idx === -1) return res.status(400).json({ error: 'Bạn đang không hẹn hò với ai.' });

    const [couple] = relState.couples.splice(idx, 1);
    await db.saveRelationship(relState);
    await db.splitPhotosFromCouple(couple.id);
    await db.splitMemoriesFromCouple(couple.id);
    res.json({ ok: true });
  })
);

/* ---------- Khởi động ---------- */
(async () => {
  await db.init();
  await reloadRel();
  app.listen(PORT, () => {
    console.log(`
  Thư viện ảnh đang chạy  ->  http://localhost:${PORT}
  Tài khoản  : ${Object.keys(USERS).join(', ')}
  Metadata   : ${db.label()}
  File ảnh   : ${storage.label()}
`);
  });
})().catch((e) => {
  console.error('Không khởi động được máy chủ:', e);
  process.exit(1);
});
