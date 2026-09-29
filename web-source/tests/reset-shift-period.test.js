/* Reset Laporan Tutup Shift harus bisa memilih periode.

   Endpoint `reset-business` sebelumnya selalu menghapus seluruh transaksi dan
   seluruh laporan tutup shift. Sekarang form di halaman "Sistem & Data" punya
   pilihan periode: seluruhnya, atau rentang tanggal tertentu.

   Dua sisi diuji di sini:
   1. Server menerima `from`/`to`, memfilter DELETE berdasarkan kolom DATE, dan
      menolak periode yang tidak valid (salah satu tanggal kosong, format
      salah, tanggal awal melewati tanggal akhir).
   2. UI punya kontrol periode, mengirim periode ke server, dan menyaring state
      lokal hanya pada periode itu -- bukan mengosongkan semua data.

   Jalankan: node --test tests/reset-shift-period.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const API = fs.readFileSync(path.join(ROOT, 'api/[...path].js'), 'utf8');

/* ------------------------------------------------------------------ server */

const emptyResult = () => ({ rowCount: 0, rows: [] });

function stubExternalModules() {
  const originalLoad = Module._load;
  Module._load = function (request) {
    if (request === 'pg') return { Pool: FakePool };
    if (request === 'web-push') return { setVapidDetails() {}, sendNotification: async () => {} };
    if (request === 'firebase-admin/app') return { getApps: () => [], initializeApp: () => ({}), cert: () => ({}) };
    if (request === 'firebase-admin/messaging') return { getMessaging: () => null };
    return originalLoad.apply(this, arguments);
  };
  return () => { Module._load = originalLoad; };
}

// Semua SQL yang dijalankan handler dicatat, jadi test bisa memeriksa DELETE
// mana yang benar-benar dikirim ke database.
let queries = [];

class FakePool {
  async query(sql, params) {
    queries.push({ sql: String(sql), params });
    if (/FROM wz_sessions s JOIN wz_users/.test(sql)) {
      return { rowCount: 1, rows: [{ id: 'u1', username: 'owner', role: 'owner', name: 'Owner', employee_id: null, business_id: 'BIZ1' }] };
    }
    if (/FROM wz_subscriptions s/.test(sql)) {
      return {
        rowCount: 1,
        rows: [{ businessId: 'BIZ1', plan: 'PRO', status: 'ACTIVE', maxBranches: null, maxEmployees: null, currentPeriodEnd: null, trialEndsAt: null }]
      };
    }
    if (/activeBranches/.test(sql)) return { rowCount: 1, rows: [{ activeBranches: 1, activeEmployees: 3 }] };
    if (/^DELETE FROM wz_transactions/.test(sql)) return { rowCount: 2, rows: [{ id: 't1' }, { id: 't2' }] };
    if (/^DELETE FROM wz_shift_reports/.test(sql)) return { rowCount: 1, rows: [{ id: 's1' }] };
    return emptyResult();
  }
  async connect() {
    const self = this;
    return { query: (sql, params) => self.query(sql, params), release() {} };
  }
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    writableEnded: false,
    setHeader(key, value) { this.headers[key] = value; },
    end(payload) { this.writableEnded = true; this.body = payload ? JSON.parse(payload) : null; }
  };
}

function makeReq(method, payload) {
  const raw = payload === undefined ? '' : JSON.stringify(payload);
  return {
    url: '/api/reset-business',
    method,
    headers: { cookie: 'wz_session=sesi-uji' },
    async *[Symbol.asyncIterator]() { if (raw) yield raw; }
  };
}

process.env.WZDATABASE = process.env.WZDATABASE || 'postgres://stub:stub@localhost:5432/stub';
const restore = stubExternalModules();
const handler = require('../api/[...path].js');
restore();

function deletes() {
  return queries.filter(q => /^DELETE FROM wz_/.test(q.sql.trim()));
}

async function postReset(payload) {
  queries = [];
  const res = makeRes();
  await handler(makeReq('POST', payload), res);
  return { res, queries: queries.slice(), deletes: deletes() };
}

test('reset tanpa periode tetap menghapus semua (perilaku lama)', async () => {
  const { res, deletes: del } = await postReset({});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.transactions, 2);
  assert.equal(res.body.shiftReports, 1);
  assert.equal(res.body.period, null, 'tanpa from/to jawaban harus menandai periode kosong');
  assert.equal(del.length, 2);
  for (const q of del) {
    assert.equal(q.params.length, 1, 'tanpa periode hanya business_id yang dikirim');
    assert.doesNotMatch(q.sql, /::date/);
  }
});

test('reset dengan periode memakai batas tanggal pada kedua tabel', async () => {
  const { res, deletes: del } = await postReset({ from: '2026-08-01', to: '2026-08-31' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.period, { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(del.length, 2);
  assert.match(del[0].sql, /DELETE FROM wz_transactions WHERE business_id=\$1 AND date >= \$2::date AND date <= \$3::date/);
  assert.match(del[1].sql, /DELETE FROM wz_shift_reports WHERE business_id=\$1 AND date >= \$2::date AND date <= \$3::date/);
  for (const q of del) {
    assert.deepEqual(q.params, ['BIZ1', '2026-08-01', '2026-08-31']);
  }
});

test('periode dengan tanggal yang tidak ada di kalender ditolak', async () => {
  const { res, deletes: del } = await postReset({ from: '2026-02-30', to: '2026-03-05' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'RESET_PERIOD_INVALID');
  assert.equal(del.length, 0, 'tidak boleh ada DELETE yang lolos');
});

test('periode dengan tanggal awal melewati tanggal akhir ditolak', async () => {
  const { res, deletes: del } = await postReset({ from: '2026-08-31', to: '2026-08-01' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'RESET_PERIOD_INVALID');
  assert.equal(del.length, 0);
});

test('hanya satu tanggal yang dikirim ditolak, bukan dianggap hapus semua', async () => {
  for (const payload of [{ from: '2026-08-01' }, { to: '2026-08-31' }]) {
    const { res, deletes: del } = await postReset(payload);
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    assert.equal(res.body.code, 'RESET_PERIOD_INVALID');
    assert.equal(del.length, 0, JSON.stringify(payload));
  }
});

test('reset tanpa sesi tetap 401 walau periode valid', async () => {
  queries = [];
  const res = makeRes();
  await handler({ url: '/api/reset-business', method: 'POST', headers: {}, async *[Symbol.asyncIterator]() { yield '{"from":"2026-08-01","to":"2026-08-31"}'; } }, res);
  assert.equal(res.statusCode, 401);
});

/* --------------------------------------------------------------------- UI  */

test('halaman Sistem & Data punya kontrol periode reset', () => {
  assert.match(INDEX, /id="resetPeriodMode"/);
  assert.match(INDEX, /<option value="all">Semua periode<\/option>/);
  assert.match(INDEX, /<option value="custom">Pilih periode/);
  assert.match(INDEX, /id="resetPeriodFrom" type="date"/);
  assert.match(INDEX, /id="resetPeriodTo" type="date"/);
  assert.match(INDEX, /id="resetPeriodInfo"/);
  assert.match(INDEX, /id="resetShiftTestingBtn"/);
});

test('jembatan reset mengirim periode dan menyaring state lokal', () => {
  assert.match(INDEX, /api\('reset-business',period\?\{method:'POST',body:JSON\.stringify\(period\)\}:\{method:'POST'\}\)/);
  assert.match(INDEX, /db\.transactions=\(db\.transactions\|\|\[\]\)\.filter\(x=>!inRange\(x\?\.date\)\)/);
  assert.match(INDEX, /db\.shiftReports=\(db\.shiftReports\|\|\[\]\)\.filter\(x=>!inRange\(x\?\.date\)\)/);
});

test('jembatan reset tidak lagi mengosongkan semua data tanpa periode', () => {
  // `resetAll()` di halaman Pengaturan memang masih reset penuh, jadi yang
  // diuji hanya jendela reset laporan tutup shift.
  const bridge = INDEX.slice(INDEX.indexOf('window.WZOnlineBusiness={'), INDEX.indexOf('window.WZOnlineSync='));
  assert.doesNotMatch(bridge, /db\.transactions=\[\];db\.shiftReports=\[\]/);
  assert.match(bridge, /\?\{method:'POST',body:JSON\.stringify\(period\)\}:\{method:'POST'\}/);
});

test('struktur kode sumber tetap utuh: tidak ada huruf asing nyasar', () => {
  const stray = /[\u2E80-\u9FFF\u0400-\u04FF]/;
  const index = INDEX.match(stray);
  const api = API.match(stray);
  assert.equal(index, null, 'index.html mengandung huruf CJK/Cyrillic');
  assert.equal(api, null, 'api/[...path].js mengandung huruf CJK/Cyrillic');
});
