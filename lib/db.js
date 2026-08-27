/* ------------------------------------------------------------------
   Lưu METADATA (danh sách ảnh, kỷ niệm, tình trạng hẹn hò).
   - Có biến môi trường MONGODB_URI -> MongoDB (khuyên dùng, dữ liệu bền)
   - Không có                       -> file JSON trong data/ (chỉ dùng khi chạy máy cá nhân)
------------------------------------------------------------------ */
'use strict';

const path = require('path');
const fs = require('fs');

const MONGO_ON = !!process.env.MONGODB_URI;
const DATA_DIR = path.join(__dirname, '..', 'data');

/* Cặp đôi mặc định: web chỉ có 2 người, ghép sẵn để deploy lại vẫn còn. */
const DEFAULT_REL = {
  requests: [],
  couples: [
    {
      id: 'c_datlinh',
      members: ['anhdatdeptrai', 'linhxinhgai'],
      since: new Date('2026-02-01T00:00:00+07:00').getTime(),
    },
  ],
};

let col = null; // { images, memories, meta }

/* ================= JSON (chế độ cục bộ) ================= */
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

/* ================= Khởi tạo ================= */
async function init() {
  if (MONGO_ON) {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const database = client.db(process.env.MONGODB_DB || 'thuvien_anh');
    col = {
      images: database.collection('images'),
      memories: database.collection('memories'),
      meta: database.collection('meta'),
    };
    await col.images.createIndex({ id: 1 }, { unique: true });
    await col.images.createIndex({ scope: 1, uploadedAt: -1 });
    await col.images.createIndex({ memoryId: 1 });
    await col.memories.createIndex({ id: 1 }, { unique: true });
    await col.memories.createIndex({ scope: 1, createdAt: -1 });

    if (!(await col.meta.findOne({ _id: 'relationship' }))) {
      await col.meta.insertOne({ _id: 'relationship', ...DEFAULT_REL });
    }
  } else {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(path.join(DATA_DIR, 'images.json'))) writeJson('images.json', []);
    if (!fs.existsSync(path.join(DATA_DIR, 'memories.json'))) writeJson('memories.json', []);
    if (!fs.existsSync(path.join(DATA_DIR, 'relationships.json'))) writeJson('relationships.json', DEFAULT_REL);
  }
}

function label() {
  return MONGO_ON ? `MongoDB (db: ${process.env.MONGODB_DB || 'thuvien_anh'})` : 'file JSON trong data/';
}

const NO_ID = { projection: { _id: 0 } };

/* ================= Tình trạng hẹn hò ================= */
async function getRelationship() {
  if (MONGO_ON) {
    const doc = await col.meta.findOne({ _id: 'relationship' }, NO_ID);
    return doc
      ? { requests: doc.requests || [], couples: doc.couples || [] }
      : { requests: [], couples: [] };
  }
  const r = readJson('relationships.json', DEFAULT_REL);
  return { requests: r.requests || [], couples: r.couples || [] };
}
async function saveRelationship(state) {
  const clean = { requests: state.requests || [], couples: state.couples || [] };
  if (MONGO_ON) {
    await col.meta.updateOne({ _id: 'relationship' }, { $set: clean }, { upsert: true });
    return;
  }
  writeJson('relationships.json', clean);
}

/* ================= Ảnh ================= */
async function loosePhotos(scope, offset, limit) {
  if (MONGO_ON) {
    const q = { scope, memoryId: { $exists: false } };
    const total = await col.images.countDocuments(q);
    const items = await col.images
      .find(q, NO_ID)
      .sort({ uploadedAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
    return { items, total, nextOffset: offset + limit < total ? offset + limit : null };
  }
  const all = readJson('images.json', [])
    .filter((x) => (x.scope || x.owner) === scope && !x.memoryId)
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
  return {
    items: all.slice(offset, offset + limit),
    total: all.length,
    nextOffset: offset + limit < all.length ? offset + limit : null,
  };
}

async function addPhotos(records) {
  if (!records.length) return;
  if (MONGO_ON) {
    await col.images.insertMany(records.map((r) => ({ ...r })));
    return;
  }
  const db = readJson('images.json', []);
  db.push(...records);
  writeJson('images.json', db);
}

async function getPhoto(id) {
  if (MONGO_ON) return col.images.findOne({ id }, NO_ID);
  return readJson('images.json', []).find((x) => x.id === id) || null;
}

async function deletePhoto(id) {
  if (MONGO_ON) return col.images.findOneAndDelete({ id }, NO_ID);
  const db = readJson('images.json', []);
  const i = db.findIndex((x) => x.id === id);
  if (i === -1) return null;
  const [removed] = db.splice(i, 1);
  writeJson('images.json', db);
  return removed;
}

async function photosInMemory(memoryId) {
  if (MONGO_ON) return col.images.find({ memoryId }, NO_ID).sort({ uploadedAt: -1 }).toArray();
  return readJson('images.json', [])
    .filter((x) => x.memoryId === memoryId)
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
}

async function memoryPhotos(scope) {
  if (MONGO_ON) {
    return col.images
      .find({ scope, memoryId: { $exists: true } }, NO_ID)
      .sort({ uploadedAt: -1 })
      .toArray();
  }
  return readJson('images.json', [])
    .filter((x) => (x.scope || x.owner) === scope && x.memoryId)
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
}

async function deletePhotosOfMemory(memoryId) {
  const removed = await photosInMemory(memoryId);
  if (MONGO_ON) {
    await col.images.deleteMany({ memoryId });
  } else {
    writeJson('images.json', readJson('images.json', []).filter((x) => x.memoryId !== memoryId));
  }
  return removed;
}

async function rescopePhotosByOwner(owners, scope) {
  if (MONGO_ON) {
    await col.images.updateMany({ owner: { $in: owners } }, { $set: { scope } });
    return;
  }
  const db = readJson('images.json', []);
  let changed = false;
  for (const x of db) {
    if (owners.includes(x.owner || x.scope)) {
      x.scope = scope;
      changed = true;
    }
  }
  if (changed) writeJson('images.json', db);
}

async function splitPhotosFromCouple(coupleId) {
  if (MONGO_ON) {
    const docs = await col.images.find({ scope: coupleId }, { projection: { _id: 0, id: 1, owner: 1 } }).toArray();
    for (const d of docs) await col.images.updateOne({ id: d.id }, { $set: { scope: d.owner } });
    return;
  }
  const db = readJson('images.json', []);
  let changed = false;
  for (const x of db) {
    if (x.scope === coupleId) {
      x.scope = x.owner || coupleId;
      changed = true;
    }
  }
  if (changed) writeJson('images.json', db);
}

/* ================= Kỷ niệm ================= */
async function listMemories(scope) {
  if (MONGO_ON) return col.memories.find({ scope }, NO_ID).sort({ createdAt: -1 }).toArray();
  return readJson('memories.json', [])
    .filter((m) => m.scope === scope)
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function getMemory(id) {
  if (MONGO_ON) return col.memories.findOne({ id }, NO_ID);
  return readJson('memories.json', []).find((m) => m.id === id) || null;
}

async function addMemory(mem) {
  if (MONGO_ON) {
    await col.memories.insertOne({ ...mem });
    return;
  }
  const all = readJson('memories.json', []);
  all.push(mem);
  writeJson('memories.json', all);
}

async function deleteMemory(id) {
  if (MONGO_ON) return col.memories.findOneAndDelete({ id }, NO_ID);
  const all = readJson('memories.json', []);
  const i = all.findIndex((m) => m.id === id);
  if (i === -1) return null;
  const [removed] = all.splice(i, 1);
  writeJson('memories.json', all);
  return removed;
}

async function rescopeMemoriesByCreator(creators, scope) {
  if (MONGO_ON) {
    await col.memories.updateMany({ createdBy: { $in: creators } }, { $set: { scope } });
    return;
  }
  const all = readJson('memories.json', []);
  let changed = false;
  for (const m of all) {
    if (creators.includes(m.createdBy || m.scope)) {
      m.scope = scope;
      changed = true;
    }
  }
  if (changed) writeJson('memories.json', all);
}

async function splitMemoriesFromCouple(coupleId) {
  if (MONGO_ON) {
    const docs = await col.memories.find({ scope: coupleId }, { projection: { _id: 0, id: 1, createdBy: 1 } }).toArray();
    for (const d of docs) await col.memories.updateOne({ id: d.id }, { $set: { scope: d.createdBy } });
    return;
  }
  const all = readJson('memories.json', []);
  let changed = false;
  for (const m of all) {
    if (m.scope === coupleId) {
      m.scope = m.createdBy || coupleId;
      changed = true;
    }
  }
  if (changed) writeJson('memories.json', all);
}

module.exports = {
  init,
  label,
  MONGO_ON,
  getRelationship,
  saveRelationship,
  loosePhotos,
  addPhotos,
  getPhoto,
  deletePhoto,
  photosInMemory,
  memoryPhotos,
  deletePhotosOfMemory,
  rescopePhotosByOwner,
  splitPhotosFromCouple,
  listMemories,
  getMemory,
  addMemory,
  deleteMemory,
  rescopeMemoriesByCreator,
  splitMemoriesFromCouple,
};
