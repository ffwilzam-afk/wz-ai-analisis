/* Regresi: presisi timestamp pada app-state.

   Kolom `updated_at` bertipe timestamptz, jadi NOW() menyimpan mikrodetik yang
   hampir selalu bukan nol. Nilai yang dikirim klien -- dan yang kembali lagi
   lewat JSON -- hanya punya milidetik, karena objek Date di JavaScript tidak
   menyimpan mikrodetik. Membandingkan `updated_at = $3` secara langsung
   karena itu hampir tidak pernah cocok, sehingga SETIAP penyimpanan kedua dan
   seterusnya dijawab 409 "Data server sudah berubah" padahal tidak ada yang
   berubah. Gejalanya: Owner mengubah sesuatu, aplikasi bilang "Tersimpan",
   lalu perubahan hilang begitu aplikasi ditutup.

   Stub pg di sini membandingkan persis seperti Postgres sunggunha, yaitu pada
   presisi mikrodetik -- bukan seperti Date#getTime() yang hanya milidetik.

   Jalankan: node --test tests/app-state-conflict.test.js */
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const toMicros = value => {
  const m = String(value).match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})\.(\d+)/);
  if (!m) return NaN;
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${(m[5] + '000').slice(0, 6)}`;
};

const sentSql = [];
function loadHandlerWithMicrosecondDb() {
  // Nilai realistis: NOW() di Postgres hampir selalu punya mikrodetik != 0.
  let current = '2026-09-27T10:15:30.123456+00:00';
  const originalLoad = Module._load;
  Module._load = function (request) {
    if (request === 'pg') {
      return {
        Pool: class {
          async query(text, params) {
            const sql = String(text);
            sentSql.push(sql);
            const rows = (r, c) => ({ rowCount: c === undefined ? r.length : c, rows: r });
            if (/CREATE TABLE IF NOT EXISTS wz_businesses/i.test(sql)) return Promise.resolve(rows([]));
            if (/FROM wz_sessions s/i.test(sql)) return Promise.resolve(rows([{ id: 1, username: 'o', role: 'owner', name: 'O', business_id: 'BIZ1', employee_id: null, branch_id: null, active: true }]));
            if (/AS "activeBranches"/i.test(sql)) return Promise.resolve(rows([{ activeBranches: 1, activeEmployees: 1 }]));
            if (/FROM wz_subscriptions s/i.test(sql)) return Promise.resolve(rows([{ businessId: 'BIZ1', plan: 'PRO', billingPeriod: 'MONTH', status: 'ACTIVE', trialStartedAt: null, trialEndsAt: null, currentPeriodStart: null, currentPeriodEnd: null, durationDays: null, maxBranches: null, maxEmployees: null, priceMonthly: 0, priceYearly: 0 }]));
            if (/SELECT data,updated_at AS "updatedAt" FROM wz_app_states/i.test(sql)) return Promise.resolve(rows([{ data: {}, updatedAt: new Date(current) }]));
            if (/UPDATE wz_app_states SET data/i.test(sql)) {
              // pg mengubah parameter Date menjadi ISO milidetik sebelum dikirim,
              // jadi bentuknya sama seperti yang benar-benar diterima database.
              const sent = params[2] instanceof Date ? params[2].toISOString() : String(params[2]);
              // Postgres membandingkan dua timestamptz pada presisi mikrodetik.
              if (toMicros(sent) !== toMicros(current)) return Promise.resolve(rows([]));
              current = new Date(Date.parse(current) + 1).toISOString();
              return Promise.resolve(rows([{ updatedAt: new Date(current) }]));
            }
            if (/INSERT INTO wz_app_states/i.test(sql)) {
              current = new Date(Date.parse('2026-09-27T11:00:00.987654+00:00')).toISOString();
              return Promise.resolve(rows([{ updatedAt: new Date(current) }]));
            }
            return Promise.resolve(rows([]));
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
  const handler = require('../api/[...path].js');
  Module._load = originalLoad;
  return handler;
}

function fakeRes() {
  return {
    statusCode: 0, headers: {}, body: null, writableEnded: false,
    setHeader(k, v) { this.headers[k] = v; },
    end(p) { this.writableEnded = true; this.body = p ? JSON.parse(p) : null; }
  };
}
function fakeReq(url, method = 'GET', body) {
  return {
    url, method, headers: { cookie: 'wz_session=t' },
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); }
  };
}

test('penyimpanan berulang tidak boleh gagal konflik karena beda presisi milidetik', async () => {
  const handler = loadHandlerWithMicrosecondDb();

  // Simpan #1 tanpa expectedUpdatedAt (mis. setelah install baru).
  const first = fakeRes();
  await handler(fakeReq('/api/app-state', 'PUT', { data: { services: [{ id: 'S1', payrollCategory: 'hairwash' }] } }), first);
  assert.strictEqual(first.statusCode, 200, 'simpan pertama harus berhasil');
  const stamp = first.body.updatedAt;
  assert.ok(stamp, 'server harus mengembalikan updatedAt');

  // Simpan #2 memakai timestamp yang dikembalikan server. Nilainya hanya punya
  // milidetik, sementara kolomnya mikrodetik -- di sinilah konflik palsu
  // pernah muncul terus-menerus.
  const second = fakeRes();
  await handler(fakeReq('/api/app-state', 'PUT', {
    data: { services: [{ id: 'S1', payrollCategory: 'haircut' }] }, expectedUpdatedAt: stamp
  }), second);
  assert.strictEqual(second.statusCode, 200,
    'simpan kedua gagal: ' + JSON.stringify(second.body) + ' (pencocokan harus toleran milidetik)');

  // Dan seterusnya, karena updatedAt terus bergerak.
  let cursor = second.body.updatedAt;
  for (let i = 0; i < 3; i++) {
    const next = fakeRes();
    await handler(fakeReq('/api/app-state', 'PUT', { data: { services: [], products: [{ n: i }] }, expectedUpdatedAt: cursor }), next);
    assert.strictEqual(next.statusCode, 200, 'simpan #' + (i + 3) + ' gagal: ' + JSON.stringify(next.body));
    cursor = next.body.updatedAt;
  }
});

test('penulisan state harus membandingkan timestamp pada presisi milidetik', async () => {
  // Perilaku di atas tidak cukup sebagai bukti: stub membandingkan parameter
  // sehingga hasilnya sama apa pun SQL-nya. Yang diuji di sini adalah SQL-nya
  // benar-benar toleran milidetik -- inilah yang membuat bug itu kembali.
  const handler = loadHandlerWithMicrosecondDb();
  const r = fakeRes();
  await handler(fakeReq('/api/app-state', 'PUT', { data: {}, expectedUpdatedAt: '2026-09-27T11:00:00.987Z' }), r);
  const update = sentSql.find(q => /UPDATE wz_app_states SET data/i.test(q));
  assert.ok(update, 'query UPDATE harus terkirim');
  assert.match(update, /date_trunc\('milliseconds',updated_at\)/,
    "pencocokan harus memakai date_trunc('milliseconds',updated_at);.updated_at=$3 tidak pernah cocok karena kolomnya mikrodetik");
  assert.ok(!/WHERE business_id=\$1 AND updated_at=\$3/.test(update),
    'perbandingan timestamp mentah akan selalu gagal');
});

test('konflik yang sesungguhnya (perangkat lain menulis duluan) tetap ditolak', async () => {
  const handler = loadHandlerWithMicrosecondDb();
  const stale = fakeRes();
  // Timestamp lama yang jelas tidak cocok dengan baris di database.
  await handler(fakeReq('/api/app-state', 'PUT', { data: {}, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }), stale);
  assert.strictEqual(stale.statusCode, 409, 'konflik asli harus tetap terdeteksi, bukan dibiarkan lewat');
  assert.strictEqual(stale.body.code, 'STATE_CONFLICT');
});
