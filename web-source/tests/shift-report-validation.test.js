/* Validasi laporan tutup shift (role karyawan) -- dua arah.

   Pertanyaannya sederhana: kalau karyawan mengisi form dengan data salah,
   apakah data salah itu TERSIMPAN apa adanya, atau DITOLAK dengan pesan yang
   menunjuk field yang salah?

   Hasil audit awal (sebelum tes ini mengunci perbaikannya):

   * Server `POST /api/shift-report` menerima 21 dari 22 payload salah dengan
     HTTP 200 dan menyimpannya apa adanya. Termasuk:
     - `customers` negatif, astronomis, desimal, dan non-angka (jadi NULL);
     - `totalPayment`, `expectedCash`, `cashDifference`, `serviceTotal`,
       `productTotal`, dan `totalOmzet` -- semuanya ditulis apa adanya dari
       klien, TIDAK PERNAH dihitung ulang. Laporan berisi Rp300.000 bisa
       menyimpan omzet Rp999.999.999, dan angka itulah yang dibaca Owner,
       payroll, dan laporan pajak.
     - `date` = "2026-02-31" (tidak ada di kalender), "27-09-2026" (format
       salah), dan "2126-09-27" (seratus tahun ke depan);
     - `shiftType` = "Nyasar";
     - `services` kosong / qty negatif / bukan array -- `serviceTotal` tidak
       pernah dicocokkan dengan isi array;
     - `products` dengan harga negatif;
     - `note` sepanjang 100.000 karakter.
   * Formula yang benar (opening/cash/qris/expense/physical negatif) sudah
     ditolak, tapi pesannya salah: negatif pada opening atau pengeluaran
     dilaporkan sebagai "Selisih kasir harus Rp 0".

   Jalankan: node --test tests/shift-report-validation.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const HELPERS_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'helpers.js'), 'utf8');
const API_SRC = fs.readFileSync(path.join(ROOT, 'api', '[...path].js'), 'utf8');

const pad = n => String(n).padStart(2, '0');
const TODAY = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

/* --- harness server -----------------------------------------------------
   Stub pg di sini benar-benar menyimpan parameter INSERT, jadi assertion
   membaca angka yang benar-benar akan masuk ke kolom database -- bukan
   sekadar "tidak throws". */
const inserted = [];
function loadHandler() {
  const originalLoad = Module._load;
  Module._load = function (request) {
    if (request === 'pg') {
      return {
        Pool: class {
          async query(text, params) {
            const sql = String(text);
            const rows = (r, c) => ({ rowCount: c === undefined ? r.length : c, rows: r });
            if (/CREATE TABLE IF NOT EXISTS wz_businesses/i.test(sql)) return Promise.resolve(rows([]));
            if (/FROM wz_sessions s/i.test(sql)) return Promise.resolve(rows([{ id: 1, username: 'budi', role: 'employee', name: 'Budi', business_id: 'BIZ1', employee_id: 'E1', branch_id: 'B1', active: true }]));
            if (/AS "activeBranches"/i.test(sql)) return Promise.resolve(rows([{ activeBranches: 1, activeEmployees: 1 }]));
            if (/FROM wz_subscriptions s/i.test(sql)) return Promise.resolve(rows([{ businessId: 'BIZ1', plan: 'PRO', billingPeriod: 'MONTH', status: 'ACTIVE', trialStartedAt: null, trialEndsAt: null, currentPeriodStart: null, currentPeriodEnd: null, durationDays: null, maxBranches: null, maxEmployees: null, priceMonthly: 0, priceYearly: 0 }]));
            if (/FROM wz_employees WHERE id=/i.test(sql)) return Promise.resolve(rows([{ id: 'E1', name: 'Budi', branchId: 'B1', active: true }]));
            if (/INSERT INTO wz_shift_reports/i.test(sql)) { inserted.push(params); return Promise.resolve(rows([{ id: params[0] }], 1)); }
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
async function postShift(handler, payload) {
  inserted.length = 0;
  const res = fakeRes();
  await handler(fakeReq('/api/shift-report', 'POST', payload), res);
  return { res, stored: inserted[0] || null };
}

// opening 100.000 + tunai 250.000 - pengeluaran 20.000 = kas akhir 330.000
const BASE = () => ({
  id: 'SHIFT1', date: TODAY, employeeId: 'E1', employeeName: 'Budi',
  shiftType: 'Full Shift', customers: 3,
  openingCash: 100000, cash: 250000, qris: 50000, cashExpense: 20000,
  physicalCash: 330000, totalPayment: 300000, expectedCash: 330000, cashDifference: 0,
  serviceTotal: 200000, productTotal: 100000, totalOmzet: 300000,
  services: [{ serviceId: 'S1', serviceName: 'Haircut', payrollCategory: 'haircut', qty: 4, price: 50000 }],
  products: [{ name: 'Pomade', qty: 1, price: 100000 }],
  note: '', savedAt: TODAY + 'T10:00:00.000Z'
});

/* Setiap kasus: satu field dirusak, sisanya tetap benar -- jadi yang diuji
   benar-benar field itu, bukan reports yang salah total. `expect` dipakai
   hanya sebagai petunjuk tambahan untuk pembaca. */
const BAD_PAYLOADS = [
  ['jumlah pelanggan negatif', { customers: -5 }, /pelanggan/i],
  ['jumlah pelangganastronomis', { customers: 999999999 }, /pelanggan/i],
  ['jumlah pelanggan desimal', { customers: 1.5 }, /pelanggan/i],
  ['jumlah pelanggan bukan angka', { customers: 'abc' }, /pelanggan/i],
  ['kas awal negatif', { openingCash: -100000, physicalCash: 130000, expectedCash: 130000 }, /kas awal/i],
  ['pengeluaran kas negatif', { cashExpense: -20000, expectedCash: 350000, physicalCash: 350000 }, /pengeluaran kas/i],
  ['pembayaran QRIS negatif', { qris: -50000, totalPayment: 250000 }, /QRIS/i],
  ['tanggal tidak ada di kalender', { date: '2026-02-31' }, /kalender/i],
  ['tanggal format salah', { date: '27-09-2026' }, /kalender|YYYY/i],
  ['tanggal kosong', { date: '' }, /lengkap|tanggal/i],
  ['tanggal 100 tahun ke depan', { date: '2126-09-27' }, /masa depan/i],
  ['jenis shift asing', { shiftType: 'Nyasar' }, /jenis shift/i],
  ['daftar layanan kosong padahal ada total', { services: [] }, /minimal 1 layanan/i],
  ['jumlah layanan negatif', { services: [{ serviceId: 'S1', serviceName: 'Haircut', qty: -4, price: 50000 }] }, /jumlah/i],
  ['jumlah layanan desimal', { services: [{ serviceId: 'S1', serviceName: 'Haircut', qty: 1.5, price: 50000 }] }, /jumlah/i],
  ['daftar layanan bukan array', { services: 'bukan array' }, /array/i],
  ['harga produk negatif', { products: [{ name: 'X', qty: 1, price: -100000 }] }, /harga/i],
  ['total baris produk tidak cocok', { products: [{ name: 'X', qty: 1, price: 100000, total: 999999 }] }, /tidak cocok/i],
  ['catatan 100 ribu karakter', { note: 'x'.repeat(100000) }, /catatan/i],
  ['catatan bukan teks', { note: { hack: 1 } }, /catatan/i]
];

// Klaim angka turunan yang berbohong. Inilah lubang yang paling berbahaya:
// dulu server menulis nilai ini apa adanya, jadi omzet bisa direkayasa.
const LYING_CLAIMS = [
  ['total pembayaran', { totalPayment: 999999999 }],
  ['kas akhir seharusnya', { expectedCash: 0 }],
  ['selisih kasir', { cashDifference: 50000, expectedCash: 280000 }],
  ['total layanan', { serviceTotal: 7500 }],
  ['total produk', { productTotal: 777777 }],
  ['total omzet shift', { totalOmzet: 999999999 }]
];

test('server: laporan benar tetap diterima dan angkanya hasil hitung ulang server', async () => {
  const handler = loadHandler();
  const { res, stored } = await postShift(handler, BASE());
  assert.strictEqual(res.statusCode, 200, 'laporan benar harus diterima: ' + JSON.stringify(res.body));
  assert.ok(stored, 'laporan harus benar-benar masuk ke query INSERT');
  // Indeks kolom wz_shift_reports sesuai urutan VALUES di api/[...path].js
  assert.deepStrictEqual({
    date: stored[1], shiftType: stored[4], customers: stored[5],
    opening: stored[6], cash: stored[7], qris: stored[8], expense: stored[9], physical: stored[10],
    totalPayment: stored[11], expected: stored[12], difference: stored[13],
    serviceTotal: stored[14], productTotal: stored[15], totalOmzet: stored[16]
  }, {
    date: TODAY, shiftType: 'Full Shift', customers: 3,
    opening: 100000, cash: 250000, qris: 50000, expense: 20000, physical: 330000,
    totalPayment: 300000, expected: 330000, difference: 0,
    serviceTotal: 200000, productTotal: 100000, totalOmzet: 300000
  });
  assert.strictEqual(stored[3], 'Budi', 'nama karyawan harus dari server, bukan dari body klien');
  assert.deepStrictEqual(JSON.parse(stored[17]), [
    { serviceId: 'S1', serviceName: 'Haircut', payrollCategory: 'haircut', qty: 4, price: 50000, total: 200000 }
  ]);
  assert.deepStrictEqual(JSON.parse(stored[18]), [{ name: 'Pomade', qty: 1, price: 100000, total: 100000 }]);
});

test('server: nama karyawan dipalsukan tidak boleh ikut tersimpan', async () => {
  const handler = loadHandler();
  const { res, stored } = await postShift(handler, Object.assign(BASE(), {
    employeeName: '<script>alert(1)</script>'
  }));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(stored[3], 'Budi', 'nama harus diambil dari data karyawan di server');
});

test('server: setiap payload salah ditolak dan TIDAK ada satu pun baris tersimpan', async () => {
  const handler = loadHandler();
  for (const [name, patch, expect] of BAD_PAYLOADS) {
    const { res, stored } = await postShift(handler, Object.assign(BASE(), patch));
    assert.strictEqual(res.statusCode, 400, name + ' seharusnya ditolak, bukan disimpan');
    assert.match(String(res.body?.error || ''), expect, name + ': pesan harus menyebut penyebabnya');
    assert.strictEqual(stored, null, name + ': tidak boleh ada query INSERT sama sekali');
  }
});

test('server: angka turunan yang direkayasa ditolak, bukan ditulis apa adanya', async () => {
  const handler = loadHandler();
  for (const [name, patch] of LYING_CLAIMS) {
    const { res, stored } = await postShift(handler, Object.assign(BASE(), patch));
    assert.strictEqual(res.statusCode, 400, 'total ' + name + ' direkayasa seharusnya ditolak');
    assert.match(String(res.body?.error || ''), /tidak cocok dengan isi laporan/i,
      'pesan harus menjelaskan angka yang dikirim berbeda dari hasil hitung ulang');
    assert.strictEqual(stored, null, 'total ' + name + ': tidak boleh ada query INSERT');
  }
});

test('server: toleransi hanya 1 rupiah, jadi hampir tidak memblokir laporan asli', async () => {
  const handler = loadHandler();
  // Selisih 1 rupiah akibat pembulatan floating point tetap diterima.
  const near = await postShift(handler, Object.assign(BASE(), { totalOmzet: 300001 }));
  assert.strictEqual(near.res.statusCode, 200, 'selisih 1 rupiah harus diterima: ' + JSON.stringify(near.res.body));
  assert.strictEqual(near.stored[16], 300000, 'yang disimpan tetap hasil hitung ulang server, bukan angka yang dikirim klien');
  // Selisih 2 rupiah sudah di luar toleransi.
  const far = await postShift(handler, Object.assign(BASE(), { totalOmzet: 300002 }));
  assert.strictEqual(far.res.statusCode, 400, 'selisih 2 rupiah harus ditolak');
});

test('server: laporan dengan services kosong tidak boleh cuma memuat totalOmzet besar', async () => {
  // Kasus yang dulu lolos: services dikosongkan supaya tidak ada baris yang
  // bisa diperiksa, sementara serviceTotal/totalOmzet tetap diklaim besar.
  const handler = loadHandler();
  const { res, stored } = await postShift(handler, Object.assign(BASE(), {
    services: [], serviceTotal: 9999999, productTotal: 0, totalOmzet: 9999999
  }));
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(stored, null);
});

test('kode sumber: endpoint shift-report tidak boleh meneruskan angka turunan apa adanya', async () => {
  // Perilaku di atas belum cukup sebagai bukti kalau stub-nya sendiri yang
  // menolak. Yang dikunci di sini adalah bentuk kodenya: blok endpoint tidak
  // boleh lagi Contains pola "Number(r.totalOmzet||0)" dan wajib memanggil
  // normalisasi bersama.
  const start = API_SRC.indexOf("if(path==='shift-report' && req.method==='POST'){");
  const end = API_SRC.indexOf("if(path==='employees/me'", start);
  assert.ok(start > 0 && end > start, 'blok endpoint shift-report tidak ditemukan');
  const block = API_SRC.slice(start, end);
  // serviceTotal/totalPayment masih boleh muncul sebagaipengecehan awal
  // "minimal 1 layanan"; yang tidak boleh ada adalah nilai yang ditulis ke
  // database apa adanya.
  for (const field of ['totalOmzet', 'productTotal', 'expectedCash', 'cashDifference']) {
    assert.doesNotMatch(block, new RegExp('Number\\(r\\.' + field),
      'endpoint masih menulis angka ' + field + ' apa adanya dari body klien');
  }
  assert.doesNotMatch(block, /JSON\.stringify\(r\.services\)/,
    'daftar layanan harus lewat normalisasi, bukan diteruskan apa adanya');
  assert.doesNotMatch(block, /JSON\.stringify\(r\.products\)/,
    'daftar produk harus lewat normalisasi, bukan diteruskan apa adanya');
  assert.match(block, /normalizeShiftReport\(r\)/, 'endpoint harus memakai validasi bersama');
  assert.match(HELPERS_SRC, /const totalOmzet=shiftRound\(serviceTotal\+productTotal\);/,
    'angka turunan harus dihitung ulang di lib/helpers.js');
});

/* --- harness klien (jsdom) ---------------------------------------------- */
const RICH = {
  branches: [{ id: 'B1', name: 'Pusat', active: true }],
  employees: [{ id: 'E1', name: 'Budi', role: 'Barber', branchId: 'B1', salary: 2000000, commission: 0, target: 0, eval: 0, attendance: 0, active: true }],
  services: [
    { id: 'S1', name: 'Haircut', category: 'Umum', payrollCategory: 'haircut', price: 50000, duration: 30, active: true },
    { id: 'S2', name: 'Gundul', category: 'Umum', payrollCategory: 'hairwash', price: 40000, duration: 25, active: true }
  ],
  products: [{ id: 'P1', name: 'Pomade', price: 75000, cost: 40000, stock: 10, active: true }],
  customers: [], transactions: [], shiftReports: [], expenses: [], attendance: [], schedules: [],
  notifications: [], accounts: [], payrollSettings: null
};

const openWindows = new Set();
test.after(() => { for (const w of openWindows) { try { w.close(); } catch { } } openWindows.clear(); });

async function bootEmployee() {
  const posted = [];
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(INDEX, {
    runScripts: 'dangerously', url: 'https://wz.test/', virtualConsole, pretendToBeVisual: true,
    beforeParse(w) {
      w.structuredClone = structuredClone;
      w.alert = () => { };
      w.confirm = () => true;
      w.print = () => { };
      w.fetch = async (target, opts = {}) => {
        const p = String(target).replace('/api/', '').split('?')[0];
        if (opts.method && opts.method !== 'GET') posted.push({ path: p, body: String(opts.body || '') });
        const json = d => { const b = JSON.stringify(d); return { ok: true, status: 200, text: async () => b, json: async () => JSON.parse(b) }; };
        if (p === 'auth/me') return json({ ok: true, user: { id: 'U1', username: 'budi', role: 'employee', name: 'Budi', businessId: 'BIZ1', branchId: 'B1', employeeId: 'E1' } });
        if (p === 'business') return json({ ok: true, transactions: [], shiftReports: [], branches: RICH.branches, notifications: [] });
        if (p === 'employees') return json({ ok: true, employees: RICH.employees });
        if (p === 'app-state') return json({ ok: true, data: {}, updatedAt: null });
        return json({ ok: true });
      };
    }
  });
  const w = dom.window;
  openWindows.add(w);
  for (let i = 0; i < 200 && typeof w.calculatePayroll !== 'function'; i++) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => setTimeout(r, 300));
  w.eval('currentUser={id:"U1",username:"budi",role:"employee",name:"Budi",businessId:"BIZ1",branchId:"B1",employeeId:"E1"};db=' + JSON.stringify(RICH) + ';location.hash="#shiftReports";render();window.__toasts=[];window.__t=toast;toast=function(m,b){window.__toasts.push(String(m));return window.__t(m,b)};true');
  await new Promise(r => setTimeout(r, 200));
  return { w, posted };
}

// Form awalnya diisi data yang benar; setiap kasus hanya mengubah satu hal.
const BASE_FILL = `
  const set=(id,v)=>{const e=document.getElementById(id);if(e){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}};
  set('srDate','${TODAY}'); set('srCustomers','5');
  set('srOpening','100000'); set('srCash','250000'); set('srQris','50000');
  set('srExpense','20000'); set('srPhysical','330000');
  document.querySelector('.sr-service-qty[data-service="S1"]').value='4';
`;

const BAD_FORM_INPUTS = [
  ['jumlah pelanggan negatif', "set('srCustomers','-5');", /pelanggan tidak boleh negatif/i],
  ['jumlah pelanggan astronomis', "set('srCustomers','1000000000');", /pelanggan tidak wajar/i],
  ['kas awal negatif', "set('srOpening','-100000');", /kas awal shift tidak boleh negatif/i],
  ['pengeluaran kas negatif', "set('srExpense','-20000');", /pengeluaran kas shift tidak boleh negatif/i],
  ['QRIS negatif', "set('srQris','-200000');", /QRIS tidak boleh negatif/i],
  ['tanggal dikosongkan', "document.getElementById('srDate').value='';", /tanggal laporan shift belum diisi/i],
  ['jumlah layanan negatif', "document.querySelector('.sr-service-qty[data-service=\"S1\"]').value='-3';", /tidak boleh negatif/i],
  ['jumlah layanan desimal', "document.querySelector('.sr-service-qty[data-service=\"S1\"]').value='1.5';", /angka bulat/i],
  ['catatan 50 ribu karakter', "document.getElementById('srNote').value='x'.repeat(50000);", /catatan shift terlalu panjang/i],
  ['selisih kasir tidak nol', "set('srPhysical','400000');", /selisih kasir harus Rp0/i],
  ['produk tanpa nama', "addShiftProduct();const r=document.querySelectorAll('.shift-product')[0];r.querySelector('.sr-product-qty').value='1';r.querySelector('.sr-product-price').value='50000';", /produk tanpa nama/i],
  ['harga produk negatif', "addShiftProduct();const r=document.querySelectorAll('.shift-product')[0];r.querySelector('.sr-product-name').value='X';r.querySelector('.sr-product-qty').value='1';r.querySelector('.sr-product-price').value='-50000';", /harga produk/i]
];

test('klien: form dengan data salah tidak pernah dikirim ke server', async () => {
  for (const [name, extra, expect] of BAD_FORM_INPUTS) {
    const ctx = await bootEmployee();
    const before = ctx.posted.length;
    await ctx.w.eval(`(async()=>{${BASE_FILL}
      ${extra}
      calcShiftReport();
      await saveShiftReport();
      await new Promise(r=>setTimeout(r,100));
    })()`);
    const sent = ctx.posted.slice(before).filter(p => p.path === 'shift-report');
    const toasts = JSON.parse(ctx.w.eval('JSON.stringify(window.__toasts)'));
    assert.strictEqual(sent.length, 0, name + ': laporan salah tetap terkirim ke server');
    const text = toasts.join(' | ');
    assert.match(text, expect, name + ': pesan harus menyebut penyebabnya. Toast: ' + JSON.stringify(toasts));
    assert.doesNotMatch(text, /berhasil tersimpan/i, name + ': layar jangan sampai bilang "berhasil tersimpan"');
    ctx.w.close(); openWindows.delete(ctx.w);
  }
});

test('klien: laporan benar terkirim dengan angka turunan yang konsisten', async () => {
  const ctx = await bootEmployee();
  const before = ctx.posted.length;
  await ctx.w.eval(`(async()=>{${BASE_FILL}
    calcShiftReport();
    await saveShiftReport();
    await new Promise(r=>setTimeout(r,100));
  })()`);
  const sent = ctx.posted.slice(before).filter(p => p.path === 'shift-report');
  assert.strictEqual(sent.length, 1, 'laporan benar harus terkirim');
  const d = JSON.parse(sent[0].body);
  assert.strictEqual(d.customers, 5);
  assert.strictEqual(d.totalPayment, 300000, 'total pembayaran = tunai + QRIS');
  assert.strictEqual(d.expectedCash, 330000, 'kas akhir = kas awal + tunai - pengeluaran');
  assert.strictEqual(d.cashDifference, 0);
  assert.strictEqual(d.serviceTotal, 200000, 'total layanan = jumlah x harga');
  assert.strictEqual(d.productTotal, 0);
  assert.strictEqual(d.totalOmzet, 200000, 'omzet harus sama dengan jumlah baris');
  assert.deepStrictEqual(d.services, [{ serviceId: 'S1', serviceName: 'Haircut', payrollCategory: 'haircut', qty: 4, price: 50000, total: 200000 }]);
  // Nilai-nilai di atas harus juga bisa diterima server apa adanya.
  const { normalizeShiftReport } = require('../lib/helpers.js');
  const checked = normalizeShiftReport(d);
  assert.strictEqual(checked.ok, true, 'payload dari klien harus lolos validasi server: ' + (checked.error || ''));
  ctx.w.close(); openWindows.delete(ctx.w);
});

test('kode sumber: kedua jalur simpan wajib lewat validasi yang sama', async () => {
  const local = INDEX.slice(INDEX.indexOf('function saveShiftReport(){'), INDEX.indexOf('/* PAYROLL ENGINE'));
  assert.match(local, /readShiftReportForm\(\)/, 'jalur simpan lokal harus memakai validasi bersama');
  const online = INDEX.slice(INDEX.indexOf('const legacySaveShiftReport=window.saveShiftReport;'));
  assert.match(online, /readShiftReportForm\(\)/, 'jalur simpan online harus memakai validasi bersama');
  assert.doesNotMatch(online, /dateNow\(\)\s*,/, 'tanggal kosong tidak boleh diam-diam diganti tanggal hari ini');
  assert.match(INDEX, /maxlength="2000"/, 'kolom catatan harus membatasi panjang sejak awal');
});
