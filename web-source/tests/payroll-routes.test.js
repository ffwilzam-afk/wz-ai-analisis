/* Tes batas tenant untuk endpoint pengaturan gaji per karyawan.
   Pertanyaan yang dijawab di sini: "apakah tiap owner benar-benar bisa
   mengatur karyawannya sendiri, tanpa bisa menyentuh karyawan bisnis lain?"

   Firme ini memakai stub pg yang bisa diprogram, sehingga kita bisa melihat
   query apa saja yang benar-benar dikirim ke database — bukan hanya kode
   responsnya. Jalankan: node --test tests/  (atau: npm test) */
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

// Dua bisnis sungguhan: masing-masing punya karyawan dengan ID sama.
// wz_employees.id adalah PRIMARY KEY global, jadi ini skenario yang nyata.
const EMPLOYEES = [
  { id: 'E001', name: 'Budi', business_id: 'BIZ1' },
  { id: 'E002', name: 'Sari', business_id: 'BIZ1' },
  { id: 'E900', name: 'Andi', business_id: 'BIZ2' }
];
const SESSIONS = {
  ownerA: { id: 1, username: 'owner-a', role: 'owner', name: 'Owner A', employee_id: null, business_id: 'BIZ1', branch_id: null },
  ownerB: { id: 2, username: 'owner-b', role: 'owner', name: 'Owner B', employee_id: null, business_id: 'BIZ2', branch_id: null },
  staff: { id: 3, username: 'karyawan', role: 'employee', name: 'Karyawan', employee_id: 'E001', business_id: 'BIZ1', branch_id: null }
};

let currentUser = SESSIONS.ownerA;
let queryLog = [];

// "Database" employees yang bisa berubah, supaya skenario bentrok ID
// antar tenant bisa benar-benar diuji.
let employeeRows = EMPLOYEES.slice();

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
            if (/FROM wz_sessions s/i.test(sql)) return Promise.resolve(result([currentUser]));
            if (/AS "activeBranches"/i.test(sql)) {
              // Query usage terpisah di getSubscriptionAccess.
              return Promise.resolve(result([{ activeBranches: 1, activeEmployees: EMPLOYEES.length }]));
            }
            if (/FROM wz_subscriptions s/i.test(sql)) {
              return Promise.resolve(result([{
                businessId: currentUser.business_id, plan: 'PRO', billingPeriod: 'MONTH',
                status: 'ACTIVE', trialStartedAt: null, trialEndsAt: null,
                currentPeriodStart: null, currentPeriodEnd: null,
                durationDays: null, maxBranches: null, maxEmployees: null,
                priceMonthly: 0, priceYearly: 0
              }]));
            }
            if (/SELECT id FROM wz_employees WHERE id=\$1 AND business_id=\$2/i.test(sql)) {
              const [id, businessId] = params;
              return Promise.resolve(result(employeeRows.filter(e => e.id === id && e.business_id === businessId).map(e => ({ id: e.id }))));
            }
            if (/FROM wz_branches WHERE id=\$1 AND business_id=\$2 AND active=true/i.test(sql)) {
              return Promise.resolve(result([{ id: params[0] }]));
            }
            if (/SELECT business_id FROM wz_employees WHERE id=\$1/i.test(sql)) {
              return Promise.resolve(result(employeeRows.filter(e => e.id === params[0]).map(e => ({ business_id: e.business_id }))));
            }
            if (/SELECT 1 FROM wz_employees WHERE id=\$1/i.test(sql)) {
              return Promise.resolve(result(employeeRows.filter(e => e.id === params[0]).map(() => ({ one: 1 }))));
            }
            if (/INSERT INTO wz_employees\(/i.test(sql)) {
              const [id, name, , branchId, salary, target, businessId] = params;
              employeeRows.push({ id, name, branch_id: branchId, salary, target, business_id: businessId });
              return Promise.resolve(result([]));
            }
            if (/active FROM wz_employees WHERE id=\$1 AND business_id=\$2/i.test(sql)) {
              return Promise.resolve(result(employeeRows.filter(e => e.id === params[0] && e.business_id === params[1]).map(e => ({
                id: e.id, name: e.name, role: 'Barber', branchId: e.branch_id,
                salary: e.salary, commission: 0, target: e.target, attendance: 0, eval: 0, active: true
              }))));
            }
            if (/FROM wz_employee_payroll/i.test(sql)) {
              // Rilis skenario:-my; ini bukan jalur yang sedang diuji.
              return Promise.resolve(result([]));
            }
            if (/INSERT INTO wz_employee_payroll/i.test(sql)) {
              const [employeeId, businessId, , baseSalary, periodStartDay, rules] = params;
              return Promise.resolve(result([{
                employeeId, businessId, payrollType: 'BASE_PLUS_SERVICE_BONUS',
                baseSalary, periodStartDay, serviceRules: JSON.parse(rules), updatedAt: new Date().toISOString()
              }]));
            }
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
function makeReq(url, method = 'GET') {
  return { url, method, headers: { cookie: 'wz_session=stub-token' }, async *[Symbol.asyncIterator]() {} };
}
function makeBodyReq(url, method, body) {
  return {
    url, method, headers: { cookie: 'wz_session=stub-token' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); }
  };
}

process.env.WZDATABASE = process.env.WZDATABASE || 'postgres://stub:stub@localhost:5432/stub';
const restore = stubExternalModules();
const handler = require('../api/[...path].js');
restore();

test.beforeEach(() => { queryLog = []; currentUser = SESSIONS.ownerA; employeeRows = EMPLOYEES.slice(); });

test('payroll/employee: tiap owner hanya bisa mengatur karyawannya sendiri', async () => {
  const res = makeRes();
  await handler(makeBodyReq('/api/payroll/employee', 'POST', {
    employeeId: 'E001', baseSalary: 2750000, serviceRules: { Haircut: { threshold: 51, bonus: 20000 } }
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.settings.employeeId, 'E001');
  // business_id yang tersimpan harus milik pemanggil, bukan milik siapa pun.
  const write = queryLog.find(q => /INSERT INTO wz_employee_payroll/i.test(q.sql));
  assert.ok(write, 'harus ada penulisan ke wz_employee_payroll');
  assert.equal(write.params[1], 'BIZ1', 'business_id harus berasal dari sesi, bukan dari body');
});

test('payroll/employee: karyawan milik bisnis lain ditolak 404 dan tidak ada penulisan', async () => {
  // Owner A mencoba mengatur E900, yang milik Owner B.
  const res = makeRes();
  await handler(makeBodyReq('/api/payroll/employee', 'POST', {
    employeeId: 'E900', baseSalary: 9000000, serviceRules: {}
  }), res);
  assert.equal(res.statusCode, 404);
  assert.match(res.body.error, /tidak ditemukan/i);
  assert.equal(
    queryLog.filter(q => /INSERT INTO wz_employee_payroll/i.test(q.sql)).length,
    0,
    'tidak boleh ada penulisan sama sekali'
  );
});

test('payroll/employee: ID karyawan milik tenant lain yang tidak dikenal juga ditolak', async () => {
  const res = makeRes();
  await handler(makeBodyReq('/api/payroll/employee', 'POST', {
    employeeId: 'E-NGAWUR-999', baseSalary: 1000
  }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(queryLog.filter(q => /INSERT INTO wz_employee_payroll/i.test(q.sql)).length, 0);
});

test('payroll/employee: dua owner bisa punya pengaturan untuk ID karyawan yang sama tanpa saling menimpa', async () => {
  // Skenarioüns: BIZ1 menyimpan E001, lalu BIZ2 menyimpan E900.
  // Keduanya harus tersimpan dengan business_id masing-masing.
  currentUser = SESSIONS.ownerA;
  const a = makeRes();
  await handler(makeBodyReq('/api/payroll/employee', 'POST', { employeeId: 'E001', baseSalary: 2000000 }), a);
  assert.equal(a.body.settings.businessId, 'BIZ1');

  currentUser = SESSIONS.ownerB;
  const b = makeRes();
  await handler(makeBodyReq('/api/payroll/employee', 'POST', { employeeId: 'E900', baseSalary: 3100000 }), b);
  assert.equal(b.body.settings.businessId, 'BIZ2');

  const writes = queryLog.filter(q => /INSERT INTO wz_employee_payroll/i.test(q.sql));
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map(w => w.params[1]).sort(), ['BIZ1', 'BIZ2']);
});

test('payroll/employee: employee tidak boleh memakai endpoint ini', async () => {
  currentUser = SESSIONS.staff;
  const res = makeRes();
  await handler(makeReq('/api/payroll/employee'), res);
  assert.equal(res.statusCode, 403);
});

test('payroll/employee: tanpa sesi ditolak 401 untuk semua method', async () => {
  currentUser = null;
  for (const method of ['GET', 'POST', 'DELETE']) {
    const res = makeRes();
    await handler(makeReq('/api/payroll/employee', method), res);
    assert.equal(res.statusCode, 401, method + ' harus 401');
  }
});

test('payroll/employee: DELETE dibatasi business_id', async () => {
  const res = makeRes();
  await handler(makeReq('/api/payroll/employee?employeeId=E001', 'DELETE'), res);
  assert.equal(res.statusCode, 200);
  const del = queryLog.find(q => /DELETE FROM wz_employee_payroll/i.test(q.sql));
  assert.ok(del, 'harus ada DELETE');
  assert.deepEqual(del.params, ['BIZ1', 'E001'], 'params harus business_id + employee_id');
});

test('payroll/employee: nilai 0 dan null tidak dianggap "tidak diisi"', async () => {
  const res = makeRes();
  await handler(makeBodyReq('/api/payroll/employee', 'POST', {
    employeeId: 'E001',
    baseSalary: 0,
    periodStartDay: null,
    serviceRules: { Hairwash: { threshold: 0, bonus: 0 } }
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.settings.baseSalary, 0, 'gaji 0 harus tersimpan sebagai 0');
  assert.equal(res.body.settings.periodStartDay, null, 'periode kosong harus null (ikut umum)');
  assert.equal(res.body.settings.serviceRules.Hairwash.threshold, 0);
  assert.equal(res.body.settings.serviceRules.Hairwash.bonus, 0);
});

test('payroll/employee: nilai tidak valid ditolak 400', async () => {
  const bad = [
    { employeeId: 'E001', baseSalary: -1 },
    { employeeId: 'E001', baseSalary: 1000, periodStartDay: 45 },
    { employeeId: 'E001', baseSalary: 1000, serviceRules: { Haircut: { threshold: 1.5, bonus: 10 } } },
    { employeeId: 'E001', baseSalary: 1000, serviceRules: { Haircut: { threshold: 10, bonus: -5 } } }
  ];
  for (const payload of bad) {
    const res = makeRes();
    await handler(makeBodyReq('/api/payroll/employee', 'POST', payload), res);
    assert.equal(res.statusCode, 400, JSON.stringify(payload) + ' harus 400');
  }
  assert.equal(queryLog.filter(q => /INSERT INTO wz_employee_payroll/i.test(q.sql)).length, 0);
});

test('employees: dua bisnis boleh sama-sama meminta ID E001 tanpa saling menimpa', async () => {
  // Skenario nyata: wz_employees.id itu PRIMARY KEY global, sementara klien
  // menebak ID berurutan dari jumlah karyawannya sendiri. Sebelum diperbaiki,
  // clash ini jadi no-op senyap: server balas 200 tapi karyawan tidak pernah
  // tersimpan.
  const payload = id => ({ id, name: 'Budi', role: 'Barber', password: 'rahasia123', branchId: 'B1', salary: 2000000, target: 0 });

  currentUser = SESSIONS.ownerA;
  const first = makeRes();
  await handler(makeBodyReq('/api/employees', 'POST', payload('E001')), first);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.employee.id, 'E001', 'ID yang belum dipakai dipakai apa adanya');

  // Bisnis kedua meminta E001 juga. ID-nya sudah milik BIZ1.
  currentUser = SESSIONS.ownerB;
  const second = makeRes();
  await handler(makeBodyReq('/api/employees', 'POST', payload('E001')), second);
  assert.equal(second.statusCode, 200);
  assert.notEqual(second.body.employee.id, 'E001', 'harus mendapat ID baru, bukan E001 milik bisnis lain');
  assert.ok(second.body.employee.id, 'karyawan kedua tetap tersimpan');

  // Dan kedua karyawan benar-benar ada, masing-masing milik bisnisnya.
  const ids = employeeRows.map(e => e.id);
  assert.ok(ids.includes('E001') && ids.includes(second.body.employee.id));
  const b1 = employeeRows.find(e => e.id === 'E001');
  const b2 = employeeRows.find(e => e.id === second.body.employee.id);
  assert.equal(b1.business_id, 'BIZ1');
  assert.equal(b2.business_id, 'BIZ2');
});

test('employees: memperbarui karyawan milik bisnis lain tetap ditolak 404', async () => {
  currentUser = SESSIONS.ownerB;
  const res = makeRes();
  await handler(makeBodyReq('/api/employees', 'PUT', { id: 'E001', name: 'Dibajak', password: 'rahasia123', branchId: 'B1' }), res);
  assert.equal(res.statusCode, 404);
});
