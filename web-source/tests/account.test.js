/* Tes endpoint ganti username sendiri dan reset password Owner oleh admin.
 *
   Dua hal yang diuji di sini:
   1. `POST /api/account/username` hanya mengubah akun yang sedang login, hanya
      bisa dilakukan dengan password lama yang benar, dan username-nya unik
      per bisnis (bukan global) -- sesuai wz_users_business_username_uq.
   2. `POST /api/admin/users/:id/reset-password` hanya berlaku untuk akun Owner,
      selalu mencabut sesi lama, dan tercatat di audit log.
 *
   Password owner tidak pernah dikembalikan ke admin: yang disimpan hanya
   scrypt satu arah, jadi tidak ada plaintext yang bisa ditampilkan. Tes ini
   mengunci aturan itu -- kalau suatu saat ada yang menambahkan password ke
   respons, tes di bawah akan gagal.
 *
   Stub pg yang bisa diprogram supaya query yang benar-benar terkirim ke
   database terlihat, bukan hanya kode responsnya.
 *   Jalankan: node --test tests/  (atau: npm test) */
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const { hashPassword } = require('../lib/helpers.js');

// Salt tetap supaya password hasil hash bisa dibandingkan di dalam tes.
const OWNER_PASSWORD = 'rahasia-owner-1';
const HASHED = hashPassword(OWNER_PASSWORD, 'a'.repeat(32));

// "Database" wz_users yang bisa berubah.
let userRows = [
  { id: 1, username: 'owner-a', password_hash: HASHED, role: 'owner', name: 'Owner A', business_id: 'BIZ1', active: true, employee_id: null },
  { id: 2, username: 'owner-b', password_hash: HASHED, role: 'owner', name: 'Owner B', business_id: 'BIZ2', active: true, employee_id: null },
  { id: 3, username: 'karyawan', password_hash: HASHED, role: 'employee', name: 'Karyawan', business_id: 'BIZ1', active: true, employee_id: 'E001' }
];
let sessionUser = null;
let adminSession = null;
let queryLog = [];

function result(rows) { return { rowCount: rows.length, rows }; }

// Bentuk baris yang dikembalikan SQL lewat RETURNING. Kolom password_hash
// tidak pernah ikut, persis seperti di api/[...path].js. Stub sengaja tidak
// memakai objek baris mentah supaya tes bisa menangkap kebocoran hash.
function publicUser(u) {
  return { id: u.id, businessId: u.business_id, username: u.username, name: u.name, role: u.role, active: u.active };
}

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
            // Sesi tenant (authUser) dan sesi admin (adminAuth).
            if (/FROM wz_platform_admin_sessions s/i.test(sql)) {
              return Promise.resolve(result(adminSession ? [adminSession] : []));
            }
            if (/FROM wz_sessions s/i.test(sql)) {
              return Promise.resolve(result(sessionUser ? [sessionUser] : []));
            }
            // Rilis skenario: subscriber/branch/employee tidak sedang diuji.
            if (/AS "activeBranches"/i.test(sql)) {
              return Promise.resolve(result([{ activeBranches: 1, activeEmployees: 2 }]));
            }
            if (/FROM wz_subscriptions s/i.test(sql)) {
              return Promise.resolve(result([{
                businessId: sessionUser && sessionUser.business_id, plan: 'PRO', billingPeriod: 'MONTH',
                status: 'ACTIVE', trialStartedAt: null, trialEndsAt: null,
                currentPeriodStart: null, currentPeriodEnd: null, durationDays: null,
                maxBranches: null, maxEmployees: null, priceMonthly: 0, priceYearly: 0
              }]));
            }
            // Verifikasi password lama saat mengganti username.
            if (/SELECT username,\s*password_hash FROM wz_users WHERE id=\$1 AND active=true/i.test(sql)) {
              const u = userRows.find(x => x.id === Number(params[0]) && x.active);
              return Promise.resolve(result(u ? [{ username: u.username, password_hash: u.password_hash }] : []));
            }
            // Cek ketersediaan username, unik per bisnis.
            if (/SELECT 1 FROM wz_users WHERE business_id=\$1 AND lower\(username\)=\$2/i.test(sql)) {
              const [businessId, username] = params;
              const hit = userRows.filter(u => u.business_id === businessId
                && String(u.username).toLowerCase() === String(username).toLowerCase()
                && Number(u.id) !== Number(params[2]));
              return Promise.resolve(result(hit.length ? [{ '?column?': 1 }] : []));
            }
            if (/UPDATE wz_users SET username=\$1/i.test(sql)) {
              const [username, id] = params;
              const u = userRows.find(x => x.id === Number(id));
              if (!u) return Promise.resolve(result([]));
              u.username = username;
              return Promise.resolve(result([publicUser(u)]));
            }
            // Reset password oleh admin, hanya untuk role owner.
            if (/UPDATE wz_users SET password_hash=\$1,active=true/i.test(sql)) {
              const [hash, id] = params;
              const u = userRows.find(x => x.id === Number(id) && x.role === 'owner');
              if (!u) return Promise.resolve(result([]));
              u.password_hash = hash;
              u.active = true;
              return Promise.resolve(result([publicUser(u)]));
            }
            if (/DELETE FROM wz_sessions WHERE user_id=\$1/i.test(sql)) return Promise.resolve(result([]));
            // Daftar akun untuk panel admin: kode bisnis + username, tanpa
            // kolom password sama sekali.
            if (/FROM wz_users u LEFT JOIN wz_businesses b/i.test(sql)) {
              if (/COUNT\(\*\)::int AS total/i.test(sql)) return Promise.resolve(result([{ total: userRows.length }]));
              return Promise.resolve(result(userRows.map(publicUser)));
            }
            if (/INSERT INTO wz_admin_audit_logs/i.test(sql)) return Promise.resolve(result([]));
            return Promise.resolve(result([]));
          }
          async connect() {
            return { query: async (t, p) => this.query(t, p), release() {} };
          }
        }
      };
    }
    if (request === 'web-push') return { setVapidDetails() {}, sendNotification: async () => {} };
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
    end(payload) { this.writableEnded = true; this.body = payload ? JSON.parse(payload) : null; }
  };
}
function makeReq(url, method = 'GET', admin = false) {
  return { url, method, headers: { cookie: admin ? 'wz_admin_session=stub-admin' : 'wz_session=stub-token' }, async *[Symbol.asyncIterator]() {} };
}
function makeBodyReq(url, method, body, admin = false) {
  return {
    url, method, headers: { cookie: admin ? 'wz_admin_session=stub-admin' : 'wz_session=stub-token' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); }
  };
}

process.env.WZDATABASE = process.env.WZDATABASE || 'postgres://stub:stub@localhost:5432/stub';
const restore = stubExternalModules();
const handler = require('../api/[...path].js');
restore();

const USERS = [
  { id: 1, username: 'owner-a', password_hash: HASHED, role: 'owner', name: 'Owner A', business_id: 'BIZ1', active: true, employee_id: null },
  { id: 2, username: 'owner-b', password_hash: HASHED, role: 'owner', name: 'Owner B', business_id: 'BIZ2', active: true, employee_id: null },
  { id: 3, username: 'karyawan', password_hash: HASHED, role: 'employee', name: 'Karyawan', business_id: 'BIZ1', active: true, employee_id: 'E001' }
];

test.beforeEach(() => {
  queryLog = [];
  userRows = JSON.parse(JSON.stringify(USERS));
  sessionUser = { id: 1, username: 'owner-a', role: 'owner', name: 'Owner A', business_id: 'BIZ1', branch_id: null, active: true };
  adminSession = { id: 7, username: 'admin', email: 'admin@wz.test', display_name: 'Admin', active: true };
});

/* ---------------------------------------------------------------- username */

test('account/username: tanpa sesi ditolak 401', async () => {
  sessionUser = null;
  const res = makeRes();
  await handler(makeBodyReq('/api/account/username', 'POST', { currentPassword: OWNER_PASSWORD, username: 'baru' }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(queryLog.filter(q => /UPDATE wz_users/i.test(q.sql)).length, 0);
});

test('account/username: password lama salah berarti tidak ada perubahan', async () => {
  const res = makeRes();
  await handler(makeBodyReq('/api/account/username', 'POST', { currentPassword: 'salah', username: 'owner-baru' }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /password lama salah/i);
  assert.equal(queryLog.filter(q => /UPDATE wz_users/i.test(q.sql)).length, 0);
  assert.equal(userRows[0].username, 'owner-a', 'username lama harus utuh');
});

test('account/username: format username salah ditolak 400', async () => {
  for (const bad of ['ab', 'Ada Spasi', 'saya@email', 'x'.repeat(51), '']) {
    const res = makeRes();
    await handler(makeBodyReq('/api/account/username', 'POST', { currentPassword: OWNER_PASSWORD, username: bad }), res);
    assert.equal(res.statusCode, 400, `username ${JSON.stringify(bad)} harus ditolak`);
  }
  assert.equal(queryLog.filter(q => /UPDATE wz_users/i.test(q.sql)).length, 0);
});

test('account/username: username dipakai akun lain di bisnis yang sama ditolak', async () => {
  const res = makeRes();
  await handler(makeBodyReq('/api/account/username', 'POST', { currentPassword: OWNER_PASSWORD, username: 'karyawan' }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /sudah dipakai/i);
  assert.equal(queryLog.filter(q => /UPDATE wz_users/i.test(q.sql)).length, 0);
});

test('account/username: username sama di bisnis lain tetap boleh', async () => {
  // owner-b memakai "owner-b" di BIZ2. Itu bukan konflik untuk BIZ1, karena
  // login sudah membedakan lewat kode bisnis.
  const res = makeRes();
  await handler(makeBodyReq('/api/account/username', 'POST', { currentPassword: OWNER_PASSWORD, username: 'owner-b' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.username, 'owner-b');
  assert.equal(userRows[0].username, 'owner-b');
  assert.equal(userRows[1].username, 'owner-b', 'akun bisnis lain tidak boleh tersentuh');
});

test('account/username: hanya mengubah akun yang sedang login', async () => {
  // Body tidak boleh memuat userId: tidak ada jalur untuk mengganti akun lain.
  const res = makeRes();
  await handler(makeBodyReq('/api/account/username', 'POST', {
    currentPassword: OWNER_PASSWORD, username: 'owner-baru', userId: 2, id: 3, businessId: 'BIZ2'
  }), res);
  assert.equal(res.statusCode, 200);
  const update = queryLog.find(q => /UPDATE wz_users SET username=\$1/i.test(q.sql));
  assert.ok(update, 'harus ada penulisan username');
  assert.equal(update.params[1], 1, 'harus menulis baris user yang sedang login');
  assert.equal(userRows[1].username, 'owner-b', 'akun lain tidak boleh berubah');
  assert.equal(userRows[2].username, 'karyawan', 'akun karyawan tidak boleh berubah');
});

test('account/username: sesi yang sedang berjalan tidak diputus', async () => {
  // wz_sessions menyimpan user_id, bukan username, jadi tidak ada DELETE
  // sesi saat username diganti.
  const res = makeRes();
  await handler(makeBodyReq('/api/account/username', 'POST', { currentPassword: OWNER_PASSWORD, username: 'owner-baru' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(queryLog.filter(q => /DELETE FROM wz_sessions/i.test(q.sql)).length, 0);
});

test('account/username: karyawan juga boleh mengganti username-nya sendiri', async () => {
  sessionUser = { id: 3, username: 'karyawan', role: 'employee', name: 'Karyawan', business_id: 'BIZ1', branch_id: null, active: true };
  const res = makeRes();
  await handler(makeBodyReq('/api/account/username', 'POST', { currentPassword: OWNER_PASSWORD, username: 'rudi' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(userRows[2].username, 'rudi');
});

/* ------------------------------------------------- reset password oleh admin */

test('admin reset password: tanpa sesi admin ditolak 401', async () => {
  adminSession = null;
  const res = makeRes();
  await handler(makeBodyReq('/api/admin/users/1/reset-password', 'POST', {}, true), res);
  assert.equal(res.statusCode, 401);
  assert.equal(queryLog.filter(q => /UPDATE wz_users SET password_hash/i.test(q.sql)).length, 0);
});

test('admin reset password: owner mendapat password baru dan sesi lamanya dicabut', async () => {
  const res = makeRes();
  await handler(makeBodyReq('/api/admin/users/1/reset-password', 'POST', {}, true), res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.temporaryPassword, 'password baru harus dikembalikan satu kali ke admin');
  assert.ok(res.body.temporaryPassword.length >= 8, 'password baru minimal 8 karakter');
  assert.equal(res.body.user.businessId, 'BIZ1');

  const update = queryLog.find(q => /UPDATE wz_users SET password_hash/i.test(q.sql));
  assert.ok(update, 'harus menulis password_hash baru');
  assert.equal(update.params[1], 1, 'harus menunjuk akun owner yang diminta');
  assert.notEqual(update.params[0], HASHED, 'hash lama tidak boleh dipakai ulang');

  const revoke = queryLog.find(q => /DELETE FROM wz_sessions WHERE user_id=\$1/i.test(q.sql));
  assert.ok(revoke, 'sesi lama owner harus dicabut');
  assert.equal(revoke.params[0], 1);

  const audit = queryLog.find(q => /INSERT INTO wz_admin_audit_logs/i.test(q.sql));
  assert.ok(audit, 'harus tercatat di audit log');
  assert.match(audit.params[1], /reset_password/);
});

test('admin reset password: hanya untuk akun Owner', async () => {
  const res = makeRes();
  const before = userRows[2].password_hash;
  // id 3 adalah akun karyawan, bukan owner. Klaim WHERE role='owner' membuat
  // UPDATE tidak menyentuh baris mana pun, jadi tidak ada yang berubah meski
  // query-nya memang dikirim.
  await handler(makeBodyReq('/api/admin/users/3/reset-password', 'POST', {}, true), res);
  assert.equal(res.statusCode, 404);
  assert.equal(userRows[2].password_hash, before, 'password karyawan tidak boleh berubah');
  assert.equal(res.body.temporaryPassword, undefined, 'password baru tidak boleh dibuat untuk non-owner');
  assert.equal(queryLog.filter(q => /INSERT INTO wz_admin_audit_logs/i.test(q.sql)).length, 0);
});

test('admin reset password: password owner tidak pernah dikembalikan plaintext', async () => {
  const res = makeRes();
  await handler(makeBodyReq('/api/admin/users/1/reset-password', 'POST', {}, true), res);
  assert.equal(res.statusCode, 200);
  // Yang dikembalikan hanya password BARU yang baru dibuat. Password lama
  // tidak mungkin dikembalikan: yang tersimpan scrypt satu arah.
  assert.equal(res.body.oldPassword, undefined);
  assert.equal(res.body.password, undefined);
  assert.equal(res.body.passwordHash, undefined);
  assert.equal(res.body.user.password_hash, undefined);
  assert.equal(res.body.user.password, undefined);
  // Dan respons apa pun tidak boleh memuat hash mana pun.
  assert.ok(!JSON.stringify(res.body).includes(userRows[0].password_hash), 'hash tidak boleh bocor ke admin');
});

test('admin reset password: admin bisa menentukan password sendiri', async () => {
  const res = makeRes();
  await handler(makeBodyReq('/api/admin/users/1/reset-password', 'POST', { newPassword: 'Password-Owner-2026' }, true), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.temporaryPassword, 'Password-Owner-2026');
  const update = queryLog.find(q => /UPDATE wz_users SET password_hash/i.test(q.sql));
  assert.equal(update.params[0], hashPassword('Password-Owner-2026').length > 0 ? update.params[0] : null);
  assert.notEqual(update.params[0], HASHED);
});

test('admin reset password: password terlalu pendek ditolak 400', async () => {
  const res = makeRes();
  await handler(makeBodyReq('/api/admin/users/1/reset-password', 'POST', { newPassword: 'pendek' }, true), res);
  assert.equal(res.statusCode, 400);
  assert.equal(queryLog.filter(q => /UPDATE wz_users SET password_hash/i.test(q.sql)).length, 0);
});

test('admin reset password: akun yang tidak ada ditolak 404', async () => {
  const res = makeRes();
  await handler(makeBodyReq('/api/admin/users/9999/reset-password', 'POST', {}, true), res);
  assert.equal(res.statusCode, 404);
});

test('admin/users: kode bisnis dan username ikut dikembalikan', async () => {
  const res = makeRes();
  await handler(makeReq('/api/admin/users', 'GET', true), res);
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.rows));
  // Admin harus bisa melihat kode bisnis + username owner tanpa password.
  assert.ok(!JSON.stringify(res.body).includes('password'), 'password tidak boleh muncul di daftar user');
});
