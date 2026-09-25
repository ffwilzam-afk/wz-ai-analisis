/* Smoke test handler API tanpa database sungguhan.
   Modul pg / web-push / firebase-admin diganti stub, lalu handler catch-all
   dipanggil seperti dipanggil Vercel. Tujuannya: memastikan file API tetap
   bisa dimuat, require ke lib/helpers.js terselesaikan, dan routing dasar jalan.
   Jalankan: node --test tests/  (atau: npm test) */
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const emptyResult = () => ({ rowCount: 0, rows: [] });

function stubExternalModules() {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'pg') {
      return {
        Pool: class {
          async query() { return emptyResult(); }
          async connect() { return { query: async () => emptyResult(), release() {} }; }
        }
      };
    }
    if (request === 'web-push') {
      return { setVapidDetails() {}, sendNotification: async () => {} };
    }
    if (request === 'firebase-admin/app') {
      return { getApps: () => [], initializeApp: () => ({}), cert: () => ({}) };
    }
    if (request === 'firebase-admin/messaging') {
      return { getMessaging: () => null };
    }
    return originalLoad.apply(this, arguments);
  };
  return () => { Module._load = originalLoad; };
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    writableEnded: false,
    setHeader(key, value) { this.headers[key] = value; },
    end(payload) {
      this.writableEnded = true; // dipakai dispatcher modul rute untuk berhenti
      this.body = payload ? JSON.parse(payload) : null;
    }
  };
}

function makeReq(url, method = 'GET', cookie = '') {
  const req = {
    url,
    method,
    headers: cookie ? { cookie } : {},
    async *[Symbol.asyncIterator]() {}
  };
  return req;
}

process.env.WZDATABASE = process.env.WZDATABASE || 'postgres://stub:stub@localhost:5432/stub';
const restore = stubExternalModules();
const handler = require('../api/[...path].js');
restore();

test('handler API termuat sebagai fungsi', () => {
  assert.equal(typeof handler, 'function');
});

test('GET /api/ready menjawab 200 ok', async () => {
  const res = makeRes();
  await handler(makeReq('/api/ready'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

test('endpoint tidak dikenal menjawab 404', async () => {
  const res = makeRes();
  await handler(makeReq('/api/endpoint-ngawur'), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
});

test('POST /api/auth/login tanpa kredensial menjawab 400', async () => {
  const res = makeRes();
  await handler(makeReq('/api/auth/login', 'POST'), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Username dan password/i);
});

test('GET /api/auth/me tanpa sesi menjawab 401', async () => {
  const res = makeRes();
  await handler(makeReq('/api/auth/me'), res);
  assert.equal(res.statusCode, 401);
});

test('respons API selalu ber-header JSON', async () => {
  const res = makeRes();
  await handler(makeReq('/api/ready'), res);
  assert.match(res.headers['Content-Type'], /application\/json/);
});

// Dua test berikut memastikan dispatcher modul rute (lib/routes/*) benar-benar
// terpasang: kalau modul tidak jalan, respons akan jatuh ke 404.
test('rute auth/logout ditangani modul auth', async () => {
  const res = makeRes();
  await handler(makeReq('/api/auth/logout', 'POST'), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

test('rute push/vapid-public-key ditangani modul push', async () => {
  const res = makeRes();
  await handler(makeReq('/api/push/vapid-public-key'), res);
  assert.notEqual(res.statusCode, 404);
  assert.equal(res.statusCode, 401);
});

test('modul rute tidak mengambil alih path lain', async () => {
  const res = makeRes();
  await handler(makeReq('/api/business'), res);
  assert.notEqual(res.statusCode, 404, 'rute business masih ada di file utama');
});

test('Admin API menolak request tanpa sesi Admin', async () => {
  const res = makeRes();
  await handler(makeReq('/api/admin/dashboard'), res);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /Admin login diperlukan/i);
});

test('Admin login tanpa kredensial ditolak', async () => {
  const res = makeRes();
  await handler(makeReq('/api/admin/login', 'POST'), res);
  assert.equal(res.statusCode, 400);
});

test('session tenant tidak mendapat akses Admin', async () => {
  const res = makeRes();
  await handler(makeReq('/api/admin/me', 'GET', 'wz_session=tenant-session'), res);
  assert.equal(res.statusCode, 401);
});
