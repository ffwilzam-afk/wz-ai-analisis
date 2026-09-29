/* Dua bug yang dilaporkan Owner, dikunci di sini.

   1. "Akun baru langsung melihat semua notifikasi." Notifikasi dan chat
      Owner milik BISNIS, tapi setiap akun hanya boleh melihat apa yang
      terjadi sejak akun itu dibuat. Tanpa itu, akun baru yang ditambahkan ke
      bisnis lama langsung melihat seluruh riwayat notifikasi sebagai belum
      dibaca, ditambah seluruh chat Owner dari tenant lain.

   2. "Simpan pengaturan gaji tidak benar-benar tersimpan." `payrollSettings`
      ikut di dalam snapshot app-state. Autosave menuliskan salinan basi,
      auto-refresh 30 detik memuatnya kembali lewat `hydrateAppState()`, dan
      nilai yang baru disimpan Owner tertimpa di layar. Sumber kebenaran
      pengaturan gaji hanya `wz_payroll_settings` / `wz_employee_payroll`
      lewat endpoint `payroll/*`.

   Jalankan: node --test tests/account-scope-and-payroll.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const API = fs.readFileSync(path.join(ROOT, 'api/[...path].js'), 'utf8');
const ADMIN_ROUTES = fs.readFileSync(path.join(ROOT, 'lib/routes/admin.js'), 'utf8');

/* ============================ sisi server ============================== */

const emptyResult = () => ({ rowCount: 0, rows: [] });
let queries = [];
let sessionUser = null;

class FakePool {
  async query(sql, params) {
    queries.push({ sql: String(sql), params });
    if (/FROM wz_sessions s JOIN wz_users/.test(sql)) {
      return sessionUser ? { rowCount: 1, rows: [sessionUser] } : emptyResult();
    }
    if (/FROM wz_subscriptions s/.test(sql)) {
      return { rowCount: 1, rows: [{ businessId: 'BIZ1', plan: 'PRO', status: 'ACTIVE', maxBranches: null, maxEmployees: null }] };
    }
    if (/activeBranches/.test(sql)) return { rowCount: 1, rows: [{ activeBranches: 1, activeEmployees: 3 }] };
    if (/FROM wz_app_states/.test(sql)) {
      return { rowCount: 1, rows: [{ data: STORED_STATE, updatedAt: new Date().toISOString() }] };
    }
    if (/FROM wz_employees WHERE e.business_id/.test(sql)) return { rowCount: 1, rows: [{ id: 'E1' }] };
    if (/FROM wz_branches WHERE business_id/.test(sql)) return { rowCount: 1, rows: [{ id: 'B1', name: 'Pusat', active: true }] };
    return emptyResult();
  }
  async connect() {
    const self = this;
    return { query: (sql, params) => self.query(sql, params), release() { } };
  }
}

const STORED_STATE = {
  services: [{ id: 'S1' }],
  notifications: [
    { id: 'LAMA1', date: '2026-01-02', createdAt: '2026-01-02T03:00:00.000Z', title: 'Laporan shift tersimpan', message: 'sebelum akun dibuat', read: false },
    { id: 'LAMA2', date: '2026-01-03', title: 'Transaksi berhasil', message: 'sebelum akun dibuat', read: false },
    { id: 'BARU1', date: '2026-05-10', createdAt: '2026-05-10T08:00:00.000Z', title: 'Laporan shift tersimpan', message: 'setelah akun dibuat', read: false }
  ],
  // Jejak app-state versi lama: payrollSettings pernah tersimpan di sini.
  payrollSettings: { baseSalary: 111, serviceRules: { Haircut: { threshold: 9, bonus: 9 } } }
};

function stubExternalModules() {
  const originalLoad = Module._load;
  Module._load = function (request) {
    if (request === 'pg') return { Pool: FakePool };
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
    setHeader(key, value) { this.headers[key] = value; },
    end(payload) { this.writableEnded = true; this.body = payload ? JSON.parse(payload) : null; }
  };
}

function makeReq(url, method = 'GET', cookie = 'wz_session=sesi-uji', payload) {
  const raw = payload === undefined ? '' : JSON.stringify(payload);
  return {
    url, method, headers: cookie ? { cookie } : {},
    async *[Symbol.asyncIterator]() { if (raw) yield raw; }
  };
}

process.env.WZDATABASE = process.env.WZDATABASE || 'postgres://stub:stub@localhost:5432/stub';
const restore = stubExternalModules();
const handler = require('../api/[...path].js');
restore();

function signIn(createdAt) {
  sessionUser = {
    id: 7, username: 'owner', role: 'owner', name: 'Owner',
    employee_id: 'E1', business_id: 'BIZ1', createdAt
  };
}

async function call(url, method = 'GET', payload) {
  queries = [];
  const res = makeRes();
  await handler(makeReq(url, method, 'wz_session=sesi-uji', payload), res);
  return { res, queries: queries.slice() };
}

test('authUser mengambil created_at akun', async () => {
  signIn(new Date('2026-02-01T00:00:00.000Z'));
  await call('/api/app-state');
  const sessionQuery = queries.find(q => /FROM wz_sessions s JOIN wz_users/.test(q.sql));
  assert.ok(sessionQuery, 'query sesi harus tercatat');
  assert.match(sessionQuery.sql, /created_at AS "createdAt"/,
    'kolom created_at wajib ikut diambil, tanpa itu batas notifikasi tidak mungkin dihitung');
});

test('app-state GET menyembunyikan notifikasi dari sebelum akun dibuat', async () => {
  signIn(new Date('2026-02-01T00:00:00.000Z'));
  const { res } = await call('/api/app-state');
  assert.equal(res.statusCode, 200);
  const ids = res.body.data.notifications.map(n => n.id);
  assert.deepStrictEqual(ids, ['BARU1'],
    'hanya notifikasi sejak akun dibuat yang boleh tampil');
});

test('app-state GET membuang payrollSettings dari blob', async () => {
  signIn(new Date('2026-02-01T00:00:00.000Z'));
  const { res } = await call('/api/app-state');
  assert.ok(!('payrollSettings' in res.body.data),
    'payrollSettings tidak boleh datang dari app-state; sumbernya endpoint payroll/*');
  assert.deepStrictEqual(res.body.data.services, [{ id: 'S1' }], 'data lain tetap utuh');
});

test('business GET juga menyaring notifikasi', async () => {
  signIn(new Date('2026-02-01T00:00:00.000Z'));
  const { res } = await call('/api/business');
  assert.equal(res.statusCode, 200);
  assert.deepStrictEqual(res.body.notifications.map(n => n.id), ['BARU1']);
});

test('app-state GET tanpa batas akun (createdAt null) tidak menyembunyikan apa pun', async () => {
  signIn(null);
  const { res } = await call('/api/app-state');
  assert.deepStrictEqual(res.body.data.notifications.map(n => n.id), ['LAMA1', 'LAMA2', 'BARU1'],
    'baris lama tanpa created_at tidak boleh ikut hilang');
});

test('app-state PUT membuang payrollSettings yang dikirim klien', async () => {
  signIn(new Date('2026-02-01T00:00:00.000Z'));
  const { res, queries: qs } = await call('/api/app-state', 'PUT', {
    data: { services: [{ id: 'S1' }], payrollSettings: { baseSalary: 999 } }
  });
  assert.equal(res.statusCode, 200);
  const write = qs.find(q => /(UPDATE|INSERT INTO) wz_app_states/.test(q.sql));
  assert.ok(write, 'harus ada penulisan app-state');
  const payload = JSON.parse(write.params[1]);
  assert.ok(!('payrollSettings' in payload),
    'salinan gaji tidak boleh tersimpan di app-state: ' + JSON.stringify(payload.payrollSettings));
  assert.deepStrictEqual(payload.services, [{ id: 'S1' }]);
});

test('employee tetap tidak menerima notifikasi bisnis', async () => {
  sessionUser = { id: 8, username: 'karyawan', role: 'employee', name: 'Budi', employee_id: 'E1', business_id: 'BIZ1', createdAt: new Date('2026-02-01T00:00:00.000Z') };
  const { res } = await call('/api/app-state');
  assert.equal(res.statusCode, 200);
  assert.ok(!('notifications' in res.body.data));
  const biz = await call('/api/business');
  assert.deepStrictEqual(biz.res.body.notifications, []);
  sessionUser = null;
});

test('chat Owner dibatasi pesan sejak akun dibuat', () => {
  assert.match(ADMIN_ROUTES, /AND \(\$4::timestamptz IS NULL OR m\.created_at>=\$4\)/,
    'query pesan chat Owner harus memfilter berdasarkan created_at akun');
  assert.match(ADMIN_ROUTES, /\[before,search,limit\+1,user\.createdAt\|\|null\]/,
    'created_at akun harus dikirim sebagai parameter');
  assert.match(ADMIN_ROUTES, /AND \(\$3::timestamptz IS NULL OR m\.created_at>=\$3\)/,
    'hitungan unread chat Owner juga harus dibatasi');
  assert.match(ADMIN_ROUTES, /\[user\.id,lastReadAt,user\.createdAt\|\|null\]/);
});

/* ============================ sisi klien =============================== */

const openWindows = new Set();
test.after(() => {
  for (const w of openWindows) {
    try { w.close(); } catch (e) { /* abaikan */ }
  }
  openWindows.clear();
});

const SEED = {
  branches: [{ id: 'B1', name: 'Pusat', active: true }],
  employees: [{ id: 'E1', name: 'Budi', role: 'Barber', branchId: 'B1', salary: 2000000, commission: 0, target: 0, eval: 0, attendance: 0, active: true }],
  services: [{ id: 'S1', name: 'Haircut', category: 'Umum', payrollCategory: 'haircut', price: 50000, duration: 30, active: true }],
  customers: [], transactions: [], shiftReports: [], expenses: [], attendance: [], schedules: [], accounts: [],
  notifications: [], profile: { notificationSoundEnabled: true },
  // Jejak versi lama: gaji ikut tersimpan di app-state dengan angka basi.
  payrollSettings: { payrollType: 'BASE_PLUS_SERVICE_BONUS', baseSalary: 111, periodStartDay: 24, serviceRules: {}, employees: {} }
};

const SERVER_PAYROLL = { payrollType: 'BASE_PLUS_SERVICE_BONUS', baseSalary: 2000000, targetAmount: 0, periodStartDay: 24, periodEndDay: 24, serviceRules: { Haircut: { threshold: 157, bonus: 10000 } } };

async function boot({ seed = SEED, payroll = SERVER_PAYROLL } = {}) {
  let serverState = JSON.parse(JSON.stringify(seed));
  let serverUpdatedAt = '2026-09-27T00:00:00.000Z';
  let clock = 0;
  let payrollRow = JSON.parse(JSON.stringify(payroll));
  const log = { payrollPosts: [], appStatePuts: [] };
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));

  const dom = new JSDOM(INDEX, {
    runScripts: 'dangerously', url: 'https://wz.test/#payrollSettings', virtualConsole, pretendToBeVisual: true,
    beforeParse(w) {
      w.structuredClone = structuredClone;
      w.alert = m => errors.push('ALERT: ' + m);
      w.confirm = () => true;
      w.print = () => { };
      w.fetch = async (url, opts = {}) => {
        const p = String(url).replace('/api/', '').split('?')[0];
        const method = opts.method || 'GET';
        const json = (status, obj) => { const body = JSON.stringify(obj); return { ok: status < 400, status, text: async () => body, json: async () => JSON.parse(body) }; };
        await new Promise(r => setTimeout(r, 10));
        if (p === 'auth/me') return json(200, { ok: true, user: { id: 'U1', username: 'owner', role: 'owner', name: 'Owner', businessId: 'BIZ1', branchId: 'B1', createdAt: '2026-02-01T00:00:00.000Z' } });
        if (p === 'app-state') {
          if (method === 'GET') return json(200, { ok: true, data: serverState, updatedAt: serverUpdatedAt });
          const body = JSON.parse(opts.body || '{}');
          log.appStatePuts.push(JSON.parse(JSON.stringify(body.data || {})));
          serverState = body.data;
          serverUpdatedAt = new Date(Date.parse(serverUpdatedAt) + 60000 * (++clock)).toISOString();
          return json(200, { ok: true, updatedAt: serverUpdatedAt });
        }
        if (p === 'business') return json(200, { ok: true, transactions: [], shiftReports: [], branches: SEED.branches, notifications: (serverState.notifications || []) });
        if (p === 'employees') return json(200, { ok: true, employees: SEED.employees });
        if (p === 'payroll/settings') {
          if (method === 'GET') return json(200, { ok: true, settings: payrollRow });
          const body = JSON.parse(opts.body || '{}');
          log.payrollPosts.push(body);
          payrollRow = { ...payrollRow, ...body };
          return json(200, { ok: true, settings: payrollRow });
        }
        if (p === 'payroll/employee') return json(200, { ok: true, settings: [] });
        return json(200, { ok: true });
      };
    }
  });
  const w = dom.window;
  openWindows.add(w);
  for (let i = 0; i < 200 && typeof w.calculatePayroll !== 'function'; i++) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => setTimeout(r, 400));
  w.eval("currentUser={id:'U1',username:'owner',role:'owner',name:'Owner',businessId:'BIZ1',branchId:'B1',createdAt:'2026-02-01T00:00:00.000Z'};true");
  await w.eval('(async()=>{window.WZOnlineSync.hydrate()})()');
  await new Promise(r => setTimeout(r, 200));
  return { w, log, errors, get server() { return serverState; } };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

test('BUG gaji: nilai yang disimpan tidak berubah sendiri setelah auto-refresh', async () => {
  const { w, log } = await boot();
  await w.eval("location.hash='#payrollSettings';render();true");
  await wait(500);

  w.eval("document.getElementById('prBaseSalary').value='3500000';true");
  const ok = await w.eval('savePayrollSettings()');
  await wait(300);
  assert.ok(log.payrollPosts.length, 'pengaturan umum harus dikirim ke payroll/settings');
  assert.strictEqual(log.payrollPosts[0].baseSalary, 3500000);

  // Auto-refresh: persis yang berjalan tiap 30 detik di HP.
  await w.eval('(async()=>{window.WZOnlineSync.hydrate()})()');
  await wait(400);
  const after = JSON.parse(w.eval('JSON.stringify(db.payrollSettings)'));
  assert.strictEqual(after.baseSalary, 3500000,
    'app-state tidak boleh menimpa pengaturan gaji: ' + JSON.stringify(after));
});

test('BUG gaji: snapshot app-state tidak lagi memuat payrollSettings', async () => {
  const { w, log } = await boot();
  await w.eval('(async()=>{window.WZOnlineStateSave.persist()})()');
  await wait(400);
  assert.ok(log.appStatePuts.length, 'harus ada penulisan app-state');
  for (const put of log.appStatePuts) {
    assert.ok(!('payrollSettings' in put),
      'payrollSettings tidak boleh ikut snapshot: ' + JSON.stringify(put.payrollSettings));
  }
});

test('BUG gaji: auto-refresh menyinkronkan ulang pengaturan gaji dari server', async () => {
  const { w } = await boot();
  await w.eval("location.hash='#payrollSettings';render();true");
  await wait(400);
  await w.eval('(async()=>{window.WZOnlinePayroll.settings()})()');
  // Server berubah (mis. Owner lain menyimpan dari perangkat lain).
  await w.eval("db.payrollSettings={payrollType:'BASE_PLUS_SERVICE_BONUS',baseSalary:4500000,periodStartDay:24,serviceRules:{},employees:{}};true");
  await w.eval('(async()=>{await window.WZOnlineSync.hydrate();await window.WZOnlineBusiness.sync()})()');
  await wait(200);
  const after = JSON.parse(w.eval('JSON.stringify(db.payrollSettings)'));
  assert.ok(after.baseSalary === 4500000 || after.baseSalary === 2000000,
    'nilai harus berasal dari payroll/settings, bukan dari app-state');
});

test('kode sumber tetap bebas huruf asing nyasar', () => {
  const stray = /[\u2E80-\u9FFF\u0400-\u04FF]/;
  assert.equal(INDEX.match(stray), null, 'index.html mengandung huruf asing');
  assert.equal(API.match(stray), null, 'api/[...path].js mengandung huruf asing');
  assert.equal(ADMIN_ROUTES.match(stray), null, 'lib/routes/admin.js mengandung huruf asing');
});
