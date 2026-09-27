/* Alur autentikasi: login, registrasi, sesi, logout.
 *
 * Ini jalan pertama yang dilewati pengguna baru setelahETE install dari Play
 * Store, jadi harus diperiksa dari sisi server (bukan hanya DOM).
 * Stub pg yang bisa diprogram supaya query yang benar-benar terkirim terlihat.
 *   Jalankan: node --test tests/auth.test.js */
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const { hashPassword } = require('../lib/helpers.js');

const PW = 'rahasia-owner-1';
const HASH_A = hashPassword(PW, 'a'.repeat(32));
const HASH_B = hashPassword('rahasia-owner-2', 'b'.repeat(32));

let queryLog = [];
let loginRows = [];
let userRows = [
  { id: 1, username: 'owner-a', password_hash: HASH_A, role: 'owner', name: 'Owner A', business_id: 'BIZ1', employee_id: null, branch_id: null, active: true },
  { id: 2, username: 'owner-a', password_hash: HASH_B, role: 'owner', name: 'Owner A2', business_id: 'BIZ2', employee_id: null, branch_id: null, active: true }
];
let sessionUser = null;

function result(rows) { return { rowCount: rows.length, rows }; }

function stubExternalModules() {
  const originalLoad = Module._load;
  Module._load = function (request) {
    if (request === 'pg') {
      return {
        Pool: class {
          async query(text, params) {
            const sql = String(text);
            queryLog.push({ sql, params });
            if (/CREATE TABLE IF NOT EXISTS wz_businesses/i.test(sql)) return Promise.resolve(result([]));
            if (/FROM wz_sessions s/i.test(sql)) return Promise.resolve(result(sessionUser ? [sessionUser] : []));
            if (/SELECT u\.\*,e\.branch_id/i.test(sql)) {
              const [username, businessId] = params;
              return Promise.resolve(result(loginRows.filter(u =>
                String(u.username) === username && (!businessId || u.business_id === businessId))));
            }
            if (/INSERT INTO wz_users\(/i.test(sql)) {
              const [username, , role, name, employeeId, businessId] = params;
              const row = { id: 100 + userRows.length, username, role, name, business_id: businessId, employee_id: employeeId, branch_id: null, active: true };
              userRows.push(row);
              return Promise.resolve(result([{ id: row.id }]));
            }
            if (/INSERT INTO wz_businesses/i.test(sql)) { userRows.push; return Promise.resolve(result([])); }
            if (/DELETE FROM wz_sessions/i.test(sql)) return Promise.resolve(result([]));
            if (/INSERT INTO wz_app_states|INSERT INTO wz_admin_notifications|INSERT INTO wz_subscriptions/i.test(sql)) return Promise.resolve(result([]));
            return Promise.resolve(result([]));
          }
          async connect() { return { query: async (t, p) => this.query(t, p), release() { } }; }
        }
      };
    }
    if (request === 'web-push') return { setVapidDetails() { }, sendNotification: async () => { } };
    if (request === 'firebase-admin/app') return { getApps: () => [], initializeApp: () => ({}), cert: () => ({}) };
    if (request === 'firebase-admin/messaging') return { getMessaging: () => null };
    return originalLoad.apply(this, arguments);
  };
  return () => { Module._load = originalLoad; };
}

function makeRes() {
  return {
    statusCode: 0, headers: {}, body: null, writableEnded: false,
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    end(payload) { this.writableEnded = true; this.body = payload ? JSON.parse(payload) : null; }
  };
}
function makeReq(url, method = 'GET', body) {
  return {
    url, method, headers: { cookie: 'wz_session=stub-token' },
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); }
  };
}

process.env.WZDATABASE = process.env.WZDATABASE || 'postgres://stub:stub@localhost:5432/stub';
const restore = stubExternalModules();
const handler = require('../api/[...path].js');
restore();

test.beforeEach(() => {
  queryLog = [];
  loginRows = [
    { id: 1, username: 'owner-a', password_hash: HASH_A, role: 'owner', name: 'Owner A', business_id: 'BIZ1', employee_id: null, branch_id: null, active: true },
    { id: 2, username: 'owner-a', password_hash: HASH_B, role: 'owner', name: 'Owner A2', business_id: 'BIZ2', employee_id: null, branch_id: null, active: true }
  ];
  sessionUser = null;
});

test('login: username dipakai dua bisnis wajib minta kode bisnis', async () => {
  const res = makeRes();
  await handler(makeReq('/api/auth/login', 'POST', { username: 'owner-a', password: PW }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Kode Bisnis/i);
  assert.equal(queryLog.filter(q => /INSERT INTO wz_sessions/i.test(q.sql)).length, 0,
    'tidak boleh membuat sesi kalau bisnisnya belum dipastikan');
});

test('login: kode bisnis yang benar memilih akun yang tepat', async () => {
  const res = makeRes();
  await handler(makeReq('/api/auth/login', 'POST', { username: 'owner-a', password: PW, businessId: 'BIZ1' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.businessId, 'BIZ1');
  assert.ok(res.headers['Set-Cookie'], 'cookie sesi harus diterbitkan');
});

test('login: kode bisnis salah tidak bisa masuk ke akun lain', async () => {
  // Password milik BIZ1 dicoba pada BIZ2. verifyPassword harus menolak.
  const res = makeRes();
  await handler(makeReq('/api/auth/login', 'POST', { username: 'owner-a', password: PW, businessId: 'BIZ2' }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.user, undefined, 'user tidak boleh ikut dikembalikan');
});

test('login: password salah ditolak tanpa membocorkan pesan berbeda', async () => {
  const wrong = makeRes();
  await handler(makeReq('/api/auth/login', 'POST', { username: 'owner-a', password: 'salah', businessId: 'BIZ1' }), wrong);
  const unknown = makeRes();
  await handler(makeReq('/api/auth/login', 'POST', { username: 'entah', password: 'salah', businessId: 'BIZ1' }), unknown);
  assert.equal(wrong.statusCode, 401);
  assert.equal(unknown.statusCode, 401);
  // Pesan harus sama supaya tidak bisa dipakai menebak username mana yang ada.
  assert.equal(wrong.body.error, unknown.body.error);
});

test('login: kredensial kosong ditolak 400 tanpa menyentuh database', async () => {
  for (const body of [{}, { username: 'owner-a' }, { password: 'x' }]) {
    const res = makeRes();
    await handler(makeReq('/api/auth/login', 'POST', body), res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
  assert.equal(queryLog.filter(q => /INSERT INTO wz_sessions/i.test(q.sql)).length, 0);
});

test('login: upaya SQL injection lewat kode bisnis dinetralkan', async () => {
  // normalizeBusinessId menyaring ke huruf/angka kapital, jadi payload ini
  // tidak pernah sampai ke SQL apa adanya. Yang diuji adalah hasilnya: tidak
  // ada perintah yang bocor ke database, dan akun orang lain tidak bisa dibuka.
  const res = makeRes();
  await handler(makeReq('/api/auth/login', 'POST', { username: 'owner-a', password: PW, businessId: "BIZ1'; DROP TABLE wz_users;--" }), res);
  assert.ok(res.statusCode === 400 || res.statusCode === 401, 'harus ditolak, bukan diterima');

  for (const q of queryLog) {
    assert.ok(!/DROP TABLE/i.test(q.sql), 'SQL mentah dari input pengguna tidak boleh dipakai: ' + q.sql);
  }
  // Kalau query tetap jalan, parameternya harus berupa hasil saringan, bukan
  // input mentah.
  const lookup = queryLog.find(q => /SELECT u\.\*,e\.branch_id/i.test(q.sql));
  if (lookup) {
    assert.ok(/^[A-Z0-9]+$/.test(String(lookup.params[1])), 'kode bisnis harus huruf/angka kapital: ' + lookup.params[1]);
  }
  assert.equal(res.body.user, undefined, 'user tidak boleh ikut dikembalikan');
  assert.equal(queryLog.filter(q => /INSERT INTO wz_sessions/i.test(q.sql)).length, 0, 'tidak boleh ada sesi baru');
});

test('auth/me: tanpa sesi 401, dengan sesi mengembalikan user yang benar', async () => {
  const anon = makeRes();
  await handler(makeReq('/api/auth/me', 'GET'), anon);
  assert.equal(anon.statusCode, 401);

  sessionUser = { id: 1, username: 'owner-a', role: 'owner', name: 'Owner A', business_id: 'BIZ1', employee_id: null, branch_id: null, active: true };
  const me = makeRes();
  await handler(makeReq('/api/auth/me', 'GET'), me);
  assert.equal(me.statusCode, 200);
  assert.equal(me.body.user.username, 'owner-a');
  assert.equal(me.body.user.businessId, 'BIZ1');
  // password_hash tidak boleh ikut keluar.
  assert.equal(me.body.user.password_hash, undefined);
  assert.equal(me.body.user.passwordHash, undefined);
});

test('logout: sesi dihapus dari server dan cookie dikosongkan', async () => {
  const res = makeRes();
  await handler(makeReq('/api/auth/logout', 'POST'), res);
  assert.equal(res.statusCode, 200);
  const del = queryLog.find(q => /DELETE FROM wz_sessions WHERE token_hash/i.test(q.sql));
  assert.ok(del, 'sesi tidak dihapus dari server');
  assert.match(String(res.headers['Set-Cookie']), /wz_session=;/, 'cookie harus dikosongkan');
});

test('registrasi: username tidak valid ditolak sebelum membuat bisnis', async () => {
  for (const username of ['ab', 'Ada Spasi', 'saya@email', 'x'.repeat(51), '']) {
    const res = makeRes();
    await handler(makeReq('/api/auth/register', 'POST', {
      businessName: 'Barbershop A', ownerName: 'Owner', branchName: 'Pusat', username, password: 'rahasia123'
    }), res);
    assert.equal(res.statusCode, 400, `username ${JSON.stringify(username)} harus ditolak`);
  }
  assert.equal(queryLog.filter(q => /INSERT INTO wz_businesses/i.test(q.sql)).length, 0,
    'bisnis tidak boleh dibuat kalau username tidak valid');
});

test('registrasi: password pendek ditolak', async () => {
  const res = makeRes();
  await handler(makeReq('/api/auth/register', 'POST', {
    businessName: 'Barbershop A', ownerName: 'Owner', branchName: 'Pusat', username: 'ownerbaru', password: '123'
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(queryLog.filter(q => /INSERT INTO wz_businesses/i.test(q.sql)).length, 0);
});

test('registrasi: akun lengkap dibuat dalam satu transaksi dan dapat cookie', async () => {
  loginRows = [];
  const res = makeRes();
  await handler(makeReq('/api/auth/register', 'POST', {
    businessName: 'Barbershop A', ownerName: 'Owner Baru', branchName: 'Pusat', username: 'ownerbaru', password: 'rahasia123'
  }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(res.body.business.businessId, 'kode bisnis harus dikembalikan');
  assert.equal(res.body.user.username, 'ownerbaru');
  assert.equal(res.body.user.role, 'owner');
  assert.ok(res.headers['Set-Cookie'], 'cookie sesi harus diterbitkan');
  // Semua penulisan harus dalam satu transaksi: kalau gagal di tengah, tidak
  // boleh ada bisnis yatim tanpa akun owner.
  assert.ok(queryLog.some(q => /BEGIN/i.test(q.sql)), 'transaksi database harus dibuka');
  assert.ok(queryLog.some(q => /COMMIT/i.test(q.sql)), 'transaksi harus di-commit');
  // Password owner baru harus disimpan sebagai hash, bukan teks polos.
  const insert = queryLog.find(q => /INSERT INTO wz_users\(/i.test(q.sql));
  assert.ok(insert);
  assert.notEqual(insert.params[1], 'rahasia123', 'password tersimpan apa adanya');
  assert.match(String(insert.params[1]), /^[0-9a-f]{32}:[0-9a-f]{128}$/, 'hash tidak berbentuk scrypt');
});
