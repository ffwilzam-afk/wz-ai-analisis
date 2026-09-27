/* Audit menyeluruh UI: seluruh menu dan dialog dari sisi pengguna.
 *
 * Tes ini lahir dari audit manual sebelum rilis, dan menangkap tiga bug nyata
 * yang tidak terlihat dari `npm test` biasa:
 *
 * 1. Fungsi privat di dalam IIFE bridge yang dipanggil script #1. Contohnya
 *    `payrollSettingsFromServer()` -- dipanggil dari `payrollSettingsPage()`,
 *    jadi ReferenceError yang tertelan try/catch dan halaman Pengaturan Gaji
 *    diam-diam jatuh ke nilai bawaan.
 * 2. `ACCESS.manager` tidak punya 'payrollSettings', padahal server sudah
 *    mengizinkan manager dan tombol "Atur Gaji" tetap terlihat untuknya.
 * 3. `loadView()` di admin.html memakai `return loadX()` di dalam `try`,
 *    sehingga kegagalan async tidak tertangkap catch.
 *
 * Menjalankan file ini saja: node --test tests/ui-audit.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const INDEX_HTML = fs.readFileSync(INDEX_PATH, 'utf8');
const INDEX_LINES = INDEX_HTML.split('\n');

// Data yang cukup realistis supaya halaman tidak hanya menampilkan keadaan
// kosong. Halaman dengan data kosong diuji terpisah di bawah.
const RICH = {
  branches: [{ id: 'B1', name: 'Pusat', address: 'Jl. Merdeka', active: true }, { id: 'B2', name: 'Cabang 2', address: '', active: true }],
  employees: [
    { id: 'E1', name: 'Budi', role: 'Barber', branchId: 'B1', salary: 2500000, commission: 0, target: 4500000, eval: 90, attendance: 20, active: true },
    { id: 'E2', name: 'Sari', role: 'Kasir', branchId: 'B1', salary: 2200000, commission: 0, target: 3000000, eval: 85, attendance: 22, active: true },
    { id: 'E3', name: 'Andi', role: 'Manager', branchId: 'B2', salary: 3000000, commission: 0, target: 6000000, eval: 95, attendance: 22, active: true }
  ],
  services: [
    { id: 'S1', name: 'Haircut', category: 'Umum', payrollCategory: 'haircut', price: 50000, duration: 30, active: true },
    { id: 'S2', name: 'Gundul', category: 'Umum', payrollCategory: '', price: 40000, duration: 25, active: true }
  ],
  products: [{ id: 'P1', name: 'Pomade', price: 75000, cost: 40000, stock: 10, active: true }],
  customers: [{ id: 'C1', name: 'Dewi', phone: '0812', active: true }],
  transactions: Array.from({ length: 12 }, (_, i) => ({
    id: 'TX' + i, date: '2026-09-2' + (i % 9), time: '10:0' + i, customerId: 'C1', customerName: 'Dewi',
    employeeId: 'E1', serviceId: 'S1', serviceName: 'Haircut', items: [], servicePrice: 50000, price: 50000,
    discount: 0, total: 50000, payment: 'CASH', status: 'SELESAI', branchId: 'B1'
  })),
  shiftReports: [{
    id: 'SR1', date: '2026-09-25', employeeId: 'E1', shiftType: 'Pagi', customers: 12, totalOmzet: 600000,
    services: [{ serviceId: 'S1', serviceName: 'Haircut', payrollCategory: 'haircut', qty: 12, price: 50000, total: 600000 }],
    products: [], expenses: [], notes: '', cashIn: 600000, cashOut: 0, branchId: 'B1'
  }],
  expenses: [{ id: 'X1', date: '2026-09-20', category: 'Operasional', name: 'Listrik', amount: 350000, note: '', branchId: 'B1' }],
  attendance: [{ id: 'A1', date: '2026-09-25', employeeId: 'E1', status: 'Hadir', checkIn: '08:00' }],
  schedules: [{ id: 'SC1', date: '2026-09-26', employeeId: 'E1', shiftType: 'Pagi', branchId: 'B1' }],
  notifications: [{ id: 'N1', type: 'system', title: 'Uji', message: 'Halo', read: false }],
  accounts: [{ id: 'A1', username: 'budi', password: 'budi123', role: 'employee', employeeId: 'E1' }],
  profile: { name: 'Owner', role: 'Direktur', brand: 'WZ', focus: 'Barbershop', notificationSoundEnabled: true },
  payrollSettings: null
};

const EMPTY_DB = {
  branches: [], employees: [], services: [], products: [], customers: [], transactions: [], shiftReports: [],
  expenses: [], attendance: [], schedules: [], notifications: [], accounts: [], payrollSettings: null
};

const ROLES = ['owner', 'manager', 'employee', 'barber', 'kasir'];

/* --- harness -------------------------------------------------------------
   index.html menyalakan interval auto-refresh, jadi setiap window harus
   ditutup; kalau tidak, proses test tidak akan pernah selesai. */
const openWindows = new Set();
test.after(() => { for (const w of openWindows) { try { w.close(); } catch { } } openWindows.clear(); });

function makeWindow(html, { url = 'https://wz.test/', onFetch } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
  virtualConsole.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
  // `posted` harus hidup di scope makeWindow, bukan hanya di beforeParse,
  // supaya bisa dikembalikan ke test.
  const posted = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url, virtualConsole, pretendToBeVisual: true,
    beforeParse(w) {
      w.structuredClone = structuredClone;
      w.addEventListener('error', ev => errors.push('window.error: ' + ((ev.error && ev.error.message) || ev.message)));
      w.addEventListener('unhandledrejection', ev => errors.push('unhandledrejection: ' + ((ev.reason && ev.reason.message) || ev.reason)));
      w.alert = m => errors.push('ALERT: ' + m);
      w.confirm = () => true;
      w.print = () => { };
      w.__posted = posted;
      w.fetch = async (target, opts) => {
        const p = String(target).replace('/api/', '').split('?')[0];
        if (opts && opts.method && opts.method !== 'GET') posted.push({ path: p, body: String(opts.body || '') });
        const custom = onFetch ? await onFetch(p, opts, posted) : null;
        if (custom) return custom;
        const body = JSON.stringify(defaultFetch(p));
        return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
      };
    }
  });
  openWindows.add(dom.window);
  return { w: dom.window, errors, posted, dom };
}

function defaultFetch(p) {
  const json = d => d;
  if (p === 'auth/me') return { ok: true, user: { id: 'U1', username: 'owner', role: 'owner', name: 'Owner', businessId: 'BIZ1', branchId: 'B1' } };
  if (p === 'app-state') return { ok: true, data: {}, updatedAt: null };
  if (p === 'business') return { ok: true, transactions: RICH.transactions, shiftReports: RICH.shiftReports, branches: RICH.branches, notifications: RICH.notifications };
  if (p === 'employees') return { ok: true, employees: RICH.employees };
  if (p === 'payroll/settings') return { ok: true, settings: { payrollType: 'BASE_PLUS_SERVICE_BONUS', baseSalary: 2000000, periodStartDay: 24, serviceRules: {} } };
  if (p === 'payroll/employee') return { ok: true, settings: [] };
  if (p === 'transaction' || p === 'shift-report') return { ok: true, saved: true };
  if (p === 'employees' || p === 'branches') return { ok: true, employee: { id: 'E1', name: 'Budi', role: 'Barber', branchId: 'B1', salary: 2500000, target: 0, active: true }, branch: { id: 'B1', name: 'Pusat', active: true } };
  return { ok: true, user: { id: 'U1', username: 'owner', role: 'owner', name: 'Owner', businessId: 'BIZ1' } };
}

async function bootApp(role, db) {
  const { w, errors, posted } = makeWindow(INDEX_HTML, { url: 'https://wz.test/' });
  for (let i = 0; i < 200 && typeof w.calculatePayroll !== 'function'; i++) await new Promise(r => setTimeout(r, 25));
  assert.strictEqual(typeof w.calculatePayroll, 'function', 'index.html gagal memuat engine payroll');
  await new Promise(r => setTimeout(r, 350));
  w.eval(`currentUser={id:'U1',username:'u',role:${JSON.stringify(role)},name:'Pemilik',businessId:'BIZ1',branchId:'B1',employeeId:${role === 'employee' ? "'E1'" : 'null'}};db=${JSON.stringify(db || RICH)};true`);
  return { w, errors, posted };
}

/* --- 1. cakupan: tidak boleh ada fungsi privat yang dipakai script #1 ----- */

test('cakupan: setiap handler on*= punya fungsi global', async () => {
  // `if` ikut tertangkap karena onkeydown="if(event.key==='Enter')..." adalah
  // handler inline yang sah; itu keyword, bukan pemanggilan fungsi.
  const KEYWORDS = new Set(['if', 'for', 'while', 'return', 'typeof', 'new', 'await']);
  const names = new Set();
  for (const m of INDEX_HTML.matchAll(/\bon(?:click|change|input|submit|keyup|keydown)="([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
    if (!KEYWORDS.has(m[1])) names.add(m[1]);
  }
  assert.ok(names.size > 50, 'handler Inline tidak terdeteksi -- regex kemungkinan sudah tidak cocok');
  const { w } = await bootApp('owner');
  const missing = [...names].filter(n => typeof w[n] !== 'function');
  assert.deepStrictEqual(missing, [], 'handler yang tidak terdefinisi: ' + missing.join(', '));
});

test('cakupan: fungsi privat IIFE yang dipakai script #1 harus terjangkau', async () => {
  // IIFE online bridge membungkus script #2. Fungsi yang hanya hidup di
  // dalamnya TIDAK bisa dipanggil dari script #1: hasilnya ReferenceError,
  // dan kalau pemanggilnya punya try/catch, errornya tertelan diam-diam.
  const start = INDEX_LINES.findIndex(l => l.trim() === '(function(){') + 1;
  assert.ok(start > 0, 'IIFE bridge tidak ditemukan -- struktur index.html berubah');
  const end = INDEX_LINES.findIndex((l, i) => i >= start && l.trim() === '})();') + 1;
  const scriptOneEnd = INDEX_LINES.findIndex(l => l.trim() === '</script>') + 1;
  assert.ok(end > start, 'penutup IIFE tidak ditemukan');
  assert.ok(scriptOneEnd < start, 'script #1 harus berada sebelum IIFE bridge');

  const decl = /^\s*(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/;
  const cfn = /^\s*const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:function|\()/;
  const privateNames = new Set();
  for (let i = start; i <= end; i++) {
    const m = decl.exec(INDEX_LINES[i - 1]) || cfn.exec(INDEX_LINES[i - 1]);
    if (m) privateNames.add(m[1]);
  }
  assert.ok(privateNames.size > 20, 'fungsi privat IIFE tidak terdeteksi');

  // Nama yang dipanggil dari script #1 (atau setelah script #2).
  const usedFromOutside = new Set();
  const scanRanges = [[2, scriptOneEnd], [end + 1, INDEX_LINES.length]];
  for (const [a, b] of scanRanges) {
    for (let i = a; i <= b; i++) {
      const raw = INDEX_LINES[i - 1];
      if (!raw) continue;
      // Komentar hanya menyebut nama fungsi, tidak memanggilnya. Tanpa
      // pemotongan ini, dokumentasi yang rapi ikut dianggap bug.
      const line = raw.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      for (const n of privateNames) {
        if (new RegExp('(?<![\\w.$])' + n + '\\s*\\(').test(line)
          && !new RegExp('^\\s*(function|const|let|var|class)\\s+' + n + '\\b').test(line)) usedFromOutside.add(n);
      }
    }
  }

  const { w } = await bootApp('owner');
  const unreachable = [...usedFromOutside].filter(n => typeof w[n] !== 'function');
  assert.deepStrictEqual(unreachable, [],
    'fungsi privat IIFE yang dipanggil dari luar tapi tidak terjangkau: ' + unreachable.join(', '));
});

/* --- 2. tiap menu harus render untuk tiap role --------------------------- */

test('audit menu: setiap halaman yang diizinkan role terbuka tanpa error', async () => {
  const probe = await bootApp('owner');
  const routes = JSON.parse(probe.w.eval('JSON.stringify(menu.map(m=>m[0]))'));
  const access = JSON.parse(probe.w.eval('JSON.stringify(ACCESS)'));
  assert.ok(routes.length >= 15, 'menuavigasi tidak terbaca');

  const problems = [];
  for (const role of ROLES) {
    const { w, errors } = await bootApp(role);
    for (const key of routes) {
      if (access[role] !== 'all' && !(access[role] || []).includes(key)) continue;
      errors.length = 0;
      try { w.eval(`location.hash=${JSON.stringify('#' + key)};render();true`); }
      catch (e) { errors.push('THROW: ' + e.message); }
      await new Promise(r => setTimeout(r, 40));
      const content = w.document.getElementById('content');
      const len = content ? content.innerHTML.length : 0;
      // Sync warning dari payroll memang normal kalau endpoint-nya kosong.
      const real = errors.filter(e => !/Payroll settings sync failed|Employee payroll sync failed/.test(e));
      if (len < 40) problems.push(`${role}/${key} tidak merender apa pun (len=${len})`);
      for (const e of [...new Set(real)]) problems.push(`${role}/${key}: ${e.slice(0, 200)}`);
    }
    w.close();
    openWindows.delete(w);
  }
  assert.deepStrictEqual(problems, []);
});

test('audit menu: halaman tetap aman saat semua data kosong (pengguna baru)', async () => {
  const { w, errors } = await bootApp('owner', { ...EMPTY_DB, profile: { notificationSoundEnabled: true } });
  const routes = JSON.parse(w.eval('JSON.stringify(menu.map(m=>m[0]))'));
  const problems = [];
  for (const key of routes) {
    errors.length = 0;
    try { w.eval(`location.hash=${JSON.stringify('#' + key)};render();true`); }
    catch (e) { errors.push('THROW: ' + e.message); }
    await new Promise(r => setTimeout(r, 40));
    const content = w.document.getElementById('content');
    const len = content ? content.innerHTML.length : 0;
    const real = errors.filter(e => !/Payroll settings sync failed|Employee payroll sync failed/.test(e));
    if (len < 40) problems.push(`${key} tidak merender apa pun (len=${len})`);
    for (const e of [...new Set(real)]) problems.push(`${key}: ${e.slice(0, 200)}`);
  }
  assert.deepStrictEqual(problems, []);
});

/* --- 3. dialog & form ---------------------------------------------------- */

const DIALOGS = [
  ['openBranch()', 'openBranch()', ['owner', 'manager']],
  ['openBranch("B1")', 'openBranch("B1")', ['owner', 'manager']],
  ['openCustomer()', 'openCustomer()', ['owner', 'manager']],
  ['openCustomer("C1")', 'openCustomer("C1")', ['owner', 'manager']],
  ['customerDetail("C1")', 'customerDetail("C1")', ['owner', 'manager']],
  ['openEmployee()', 'openEmployee()', ['owner', 'manager']],
  ['openEmployee("E1")', 'openEmployee("E1")', ['owner', 'manager']],
  ['openEmployeePayrollForm("E1")', 'openEmployeePayrollForm("E1")', ['owner', 'manager']],
  ['employeeDetail("E1")', 'employeeDetail("E1")', ['owner', 'manager']],
  ['openService()', 'openService()', ['owner', 'manager']],
  ['editService("S1")', 'editService("S1")', ['owner', 'manager']],
  ['openExpense()', 'openExpense()', ['owner', 'manager']],
  ['openExpense("X1")', 'openExpense("X1")', ['owner', 'manager']],
  ['openTransaction()', 'openTransaction()', ROLES],
  ['txDetail("TX1")', 'txDetail("TX1")', ROLES],
  ['shiftReportDetail("SR1")', 'shiftReportDetail("SR1")', ['owner', 'manager']],
  ['showWalkin()', 'showWalkin()', ['owner', 'manager']],
  ['editMyProfile()', 'editMyProfile()', ROLES],
  ['changeMyPassword()', 'changeMyPassword()', ROLES],
  ['changeMyUsername()', 'changeMyUsername()', ROLES]
];

test('audit dialog: setiap form terbuka dan berisi isi', async () => {
  const problems = [];
  for (const role of ROLES) {
    const { w, errors } = await bootApp(role);
    for (const [label, expr, roles] of DIALOGS) {
      if (!roles.includes(role)) continue;
      errors.length = 0;
      try { w.eval(`closeModal();${expr};true`); } catch (e) { errors.push('THROW: ' + e.message); }
      await new Promise(r => setTimeout(r, 30));
      const modal = w.document.getElementById('modal');
      const open = modal && modal.classList.contains('open');
      const len = w.document.body.innerHTML.length;
      const real = [...new Set(errors)];
      if (real.length) problems.push(`${role} ${label}: ` + real.map(e => e.slice(0, 160)).join(' | '));
      else if (!open) problems.push(`${role} ${label}: modal tidak terbuka`);
      else if (len < 40) problems.push(`${role} ${label}: modal kosong`);
    }
    w.close();
    openWindows.delete(w);
  }
  assert.deepStrictEqual(problems, []);
});

test('audit dialog: manager boleh membuka Atur Gaji (regresi ACCESS)', async () => {
  // Server sudah mengizinkan manager pada /api/payroll/employee, dan kartu
  // karyawan menampilkan tombol "Atur Gaji" untuk manager. Kalau ACCESS
  // manager tidak punya 'payrollSettings', guard menutupnya dan yang tampil
  // hanya toast -- tidak adaTtidak ada dialog.
  const { w } = await bootApp('manager');
  w.eval('closeModal();openEmployeePayrollForm("E1");true');
  await new Promise(r => setTimeout(r, 30));
  const modal = w.document.getElementById('modal');
  assert.ok(modal.classList.contains('open'), 'modal Atur Gaji tidak terbuka untuk manager');
  assert.match(modal.textContent, /GAJI KARYAWAN|Budi/);
});

test('audit dialog: semua role bisa membuka halaman profil sendiri', async () => {
  // Regresi ACCESS: manager sempat tidak punya 'profile' sama sekali.
  for (const role of ROLES) {
    const { w } = await bootApp(role);
    w.eval(`location.hash='#profile';render();true`);
    await new Promise(r => setTimeout(r, 30));
    const html = w.document.getElementById('content').innerHTML;
    assert.match(html, /Profil|Ubah Profil/i, `role ${role} tidak bisa membuka halaman profil`);
    assert.match(html, /changeMyUsername\(\)/, `role ${role} tidak punya tombol Ubah Username`);
  }
});

/* --- 4. jalur simpan benar-benar mengirim data yang benar ----------------- */

test('audit simpan: layanan baru tersimpan bersama kategori gaji', async () => {
  const { w, posted } = await bootApp('owner');
  await w.eval(`(async()=>{
    openService();
    document.getElementById('sName').value='Smoothing Rambut';
    document.getElementById('sCat').value='Umum';
    document.getElementById('sPayCat').value='hairstyling';
    document.getElementById('sPrice').value='120000';
    document.getElementById('sDur').value='60';
    saveService();
  })()`);
  const svc = w.eval('db.services.find(x=>x.name==="Smoothing Rambut")');
  assert.ok(svc, 'layanan baru tidak masuk ke db.services');
  assert.strictEqual(svc.payrollCategory, 'hairstyling', 'kategori gaji tidak ikut tersimpan');
  assert.ok(posted.some(p => p.path === 'app-state'), 'tidak ada app-state yang dikirim');
});

test('audit simpan: ubah kategori gaji pada layanan lama langsung tersimpan', async () => {
  const { w } = await bootApp('owner');
  await w.eval(`(async()=>{editService('S2');document.getElementById('esPayCat').value='haircut';updateService('S2');})()`);
  assert.strictEqual(w.eval('db.services.find(x=>x.id==="S2").payrollCategory'), 'haircut');
});

test('audit simpan: aturan umum gaji memakai angka yang diketik owner', async () => {
  const { w, posted } = await bootApp('manager');
  await w.eval(`(async()=>{
    location.hash='#payrollSettings'; render();
    await new Promise(r=>setTimeout(r,200));
    document.getElementById('prTh_haircut').value='12';
    document.getElementById('prBo_haircut').value='12345';
    document.getElementById('prBaseSalary').value='2750000';
    savePayrollSettings();
  })()`);
  const call = posted.find(p => p.path === 'payroll/settings');
  assert.ok(call, 'tidak ada POST payroll/settings');
  const body = JSON.parse(call.body);
  assert.strictEqual(body.serviceRules.Haircut.threshold, 12, 'ambang yang diketik tidak terkirim');
  assert.strictEqual(body.serviceRules.Haircut.bonus, 12345, 'bonus yang diketik tidak terkirim');
  assert.strictEqual(body.baseSalary, 2750000, 'gaji pokok yang diketik tidak terkirim');
});

test('audit simpan: gaji khusus karyawan memakai angka yang diketik', async () => {
  const { w, posted } = await bootApp('manager');
  await w.eval(`(async()=>{
    openEmployeePayrollForm('E1');
    document.getElementById('ep_haircut_threshold').value='20';
    document.getElementById('ep_haircut_bonus').value='15000';
    saveEmployeePayroll('E1');
  })()`);
  const calls = posted.filter(p => p.path.startsWith('payroll/employee') && p.body);
  assert.ok(calls.length, 'tidak ada POST payroll/employee');
  // Regresi paling parah di fitur ini: untuk karyawan yang belum punya
  // pengaturan khusus, kotak centang tidak tercentang, sehingga save akan
  // jatuh ke jalur reset dan semua angka Owner dibuang -- tapi toast-nya
  // berbunyi "dihapus", jadi Owners mengira pengaturan sudah tersimpan.
  assert.strictEqual(
    posted.filter(p => p.path.startsWith('payroll/employee') && !p.body).length, 0,
    'penyimpanan pertama tidak boleh jadi DELETE (semua isian Owner terbuang)'
  );
  const body = JSON.parse(calls[calls.length - 1].body);
  assert.strictEqual(body.employeeId, 'E1');
  assert.strictEqual(body.serviceRules.Haircut.threshold, 20);
  assert.strictEqual(body.serviceRules.Haircut.bonus, 15000);
});

test('audit simpan: mengetik angka otomatis mencentang "gunakan pengaturan khusus"', async () => {
  const { w } = await bootApp('manager');
  w.eval('openEmployeePayrollForm("E1");true');
  await new Promise(r => setTimeout(r, 30));
  assert.strictEqual(w.document.getElementById('epEnabled').checked, false, 'awalnya belum tercentang');
  const input = w.document.getElementById('ep_haircut_threshold');
  input.value = '20';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.strictEqual(w.document.getElementById('epEnabled').checked, true, 'kotak centang harus ikut tercentang');
});

test('audit simpan: kasir bisa menutup transaksi dan karyawanClosing shift', async () => {
  // Dua alur paling sering dipakai sehari-hari.
  const kasir = await bootApp('kasir');
  await kasir.w.eval(`(async()=>{
    openTransaction();
    const set=(id,v)=>{const e=document.getElementById(id);if(e){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}};
    set('txCustomerName','Dewi'); set('txServiceId','S1');
    calcTx(); saveTransaction();
  })()`);
  assert.ok(kasir.posted.some(p => p.path === 'transaction'), 'transaksi POS tidak terkirim ke server');
  kasir.w.close();
  openWindows.delete(kasir.w);

  const karyawan = await bootApp('employee');
  await karyawan.w.eval(`(async()=>{
    location.hash='#shiftReports'; render();
    await new Promise(r=>setTimeout(r,50));
    const s=document.getElementById('srDate'); if(s)s.value='2026-09-25';
    const c=document.getElementById('srCustomers'); if(c)c.value='12';
    const svc=document.querySelector('.sr-service-qty'); if(svc)svc.value='12';
    const cash=document.getElementById('srCash'); if(cash)cash.value='600000';
    const phys=document.getElementById('srPhysical'); if(phys)phys.value='600000';
    calcShiftReport(); saveShiftReport();
  })()`);
  assert.ok(karyawan.posted.some(p => p.path === 'shift-report'), 'laporan shift tidak terkirim ke server');
  karyawan.w.close();
  openWindows.delete(karyawan.w);
});

/* --- 5. panel admin ------------------------------------------------------ */

const ADMIN_HTML = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const ADMIN_DATA = {
  'admin/dashboard': { ok: true, counts: { businesses: 3, users: 12, active_businesses: 2 }, plans: [{ plan: 'PRO', count: 2 }], payments: [{ status: 'PAID', count: 2, amount: 400000 }], growth: [{ month: '2026-08', count: 1 }, { month: '2026-09', count: 3 }], attention: [] },
  'admin/businesses': { ok: true, rows: [{ id: 'BIZ1', name: 'Barbershop A', active: true, createdAt: '2026-01-01', plan: 'PRO', subscriptionStatus: 'ACTIVE', owners: 1, branches: 1, employees: 4 }], total: 1, page: 1, limit: 25, pages: 1 },
  'admin/users': { ok: true, rows: [{ id: 1, username: 'owner-a', name: 'Owner A', role: 'owner', active: true, createdAt: '2026-01-01', lastActivityAt: '2026-09-25', businessId: 'BIZ1', businessName: 'Barbershop A', plan: 'PRO', subscriptionStatus: 'ACTIVE' }], total: 1, page: 1, limit: 25, pages: 1 },
  'admin/subscriptions': { ok: true, rows: [{ businessId: 'BIZ1', businessName: 'Barbershop A', owner: 'Owner A', plan: 'PRO', subscriptionStatus: 'ACTIVE', billingPeriod: 'MONTH', currentPeriodEnd: '2026-12-01', orderId: 'O1', paymentStatus: 'PAID', amount: 200000, paymentProvider: 'XENDIT' }], total: 1, page: 1, limit: 25, pages: 1 },
  'admin/plans': { ok: true, plans: [{ plan: 'PRO', durationDays: 30, priceMonthly: 200000, priceYearly: 2000000, maxBranches: 3, maxEmployees: 20, active: true }] },
  'admin/payments': { ok: true, rows: [{ orderId: 'O1', businessName: 'Barbershop A', plan: 'PRO', amount: 200000, status: 'PAID', paymentProvider: 'XENDIT', createdAt: '2026-09-01' }], total: 1, page: 1, limit: 25, pages: 1 },
  'admin/forum/messages': { ok: true, messages: [{ id: 1, message: 'Halo', senderName: 'Owner A', businessName: 'Barbershop A', createdAt: '2026-09-01', messageType: 'text', senderRole: 'owner' }], polls: [] },
  'admin/notifications': { ok: true, rows: [{ id: 1, type: 'business_new', title: 'Baru', message: 'Bisnis baru', businessId: 'BIZ1', read: false, createdAt: '2026-09-01' }], total: 1, page: 1, limit: 25, pages: 1 },
  'admin/audit-logs': { ok: true, rows: [{ id: 1, action: 'admin.user.reset_password', adminId: 7, targetId: '1', createdAt: '2026-09-25' }], total: 1, page: 1, limit: 25, pages: 1 },
  'admin/settings': { ok: true, settings: { platform_name: 'WZ' } },
  'admin/businesses/BIZ1': { ok: true, business: { id: 'BIZ1', name: 'Barbershop A', active: true, createdAt: '2026-01-01' }, subscription: { plan: 'PRO', status: 'ACTIVE' }, owners: [{ id: 1, username: 'owner-a', name: 'Owner A', role: 'owner', active: true, phone: '', email: '' }], branches: [{ id: 'B1', name: 'Pusat', address: '', active: true }], employees: [{ id: 'E1', name: 'Budi', role: 'Barber', branchId: 'B1', active: true }], orders: [] }
};

async function bootAdmin() {
  const { w, errors } = makeWindow(ADMIN_HTML, {
    url: 'https://wz.test/admin',
    onFetch: p => {
      if (p === 'admin/login' || p === 'admin/me') return { ok: true, status: 200, json: async () => ({ ok: true, admin: { id: 7, username: 'admin', displayName: 'Admin' } }) };
      if (p === 'admin/users/1/reset-password') return { ok: true, status: 200, json: async () => ({ ok: true, user: { id: 1, username: 'owner-a', name: 'Owner A', businessId: 'BIZ1', role: 'owner' }, temporaryPassword: 'wz-abcd1234' }) };
      if (ADMIN_DATA[p]) return { ok: true, status: 200, json: async () => ADMIN_DATA[p] };
      return { ok: true, status: 200, json: async () => ({ ok: true, rows: [], total: 0, page: 1, limit: 25, pages: 1 }) };
    }
  });
  await new Promise(r => setTimeout(r, 350));
  return { w, errors };
}

test('audit admin: setiap view panel admin terbuka tanpa error', async () => {
  const { w, errors } = await bootAdmin();
  const views = JSON.parse(w.eval('JSON.stringify(menu.map(m=>m[0]))'));
  assert.ok(views.length >= 10, 'menu admin tidak terbaca');
  const problems = [];
  for (const view of views) {
    errors.length = 0;
    try { await w.eval(`(async()=>{state.admin={id:7,username:'admin',displayName:'Admin'};await loadView(${JSON.stringify(view)});})()`); }
    catch (e) { errors.push('THROW: ' + e.message); }
    await new Promise(r => setTimeout(r, 60));
    const content = w.document.getElementById('content');
    const len = content ? content.innerHTML.length : 0;
    if (len < 60) problems.push(`${view} tidak merender (len=${len})`);
    for (const e of [...new Set(errors)]) problems.push(`${view}: ${e.slice(0, 180)}`);
  }
  assert.deepStrictEqual(problems, []);
});

test('audit admin: kegagalan async tidak lagi menggantung di "Memuat data"', async () => {
  // `return loadX()` di dalam try TIDAK tertangkap catch: catch hanya
  // menangani throw sinkron dan await. Akibatnya satu kegagalan async
  // membuat panel menggantung selamanya di "Memuat data Admin...".
  const { w } = await bootAdmin();
  // api() di admin.html memakai res.json().catch(()=>({})), jadi error json
  // tidak akan sampai ke loadView. Yang harus diuji adalah kegagalan
  // jaringan, yang memang-Edang dilempar ke sana.
  w.fetch = async () => { throw new Error('UJI-GAGAL'); };
  await w.eval(`(async()=>{state.admin={id:7,username:'admin',displayName:'Admin'};await loadView('dashboard');})()`);
  await new Promise(r => setTimeout(r, 80));
  const text = w.document.getElementById('content').textContent;
  assert.ok(!/Memuat data Admin/.test(text), 'halaman masih menggantung di teks memuat');
  assert.match(text, /Gagal memuat|UJI-GAGAL/);
});

test('audit admin: daftar user menampilkan kode bisnis dan username', async () => {
  const { w } = await bootAdmin();
  await w.eval(`(async()=>{state.admin={id:7,username:'admin',displayName:'Admin'};await loadView('users');})()`);
  await new Promise(r => setTimeout(r, 80));
  const text = w.document.getElementById('content').textContent;
  assert.match(text, /owner-a/, 'username owner tidak tampil');
  assert.match(text, /BIZ1/, 'kode bisnis tidak tampil');
  // Tombol "Reset Password" memang memuat kata itu. Yang tidak boleh ada
  // adalah nilai password atau hash-nya di respons.
  assert.ok(!/password_hash|passwordHash/.test(text), 'hash password tidak boleh tampil');
  const row = ADMIN_DATA['admin/users'].rows[0];
  assert.strictEqual(row.password, undefined, 'fixture test tidak boleh punya kolom password');
  assert.strictEqual(row.passwordHash, undefined, 'fixture test tidak boleh punya kolom passwordHash');
});

test('audit admin: reset password owner menampilkan password baru sekali saja', async () => {
  const { w } = await bootAdmin();
  await w.eval(`(async()=>{state.admin={id:7,username:'admin',displayName:'Admin'};await loadView('users');})()`);
  await new Promise(r => setTimeout(r, 80));
  const btn = w.document.querySelector('[data-user-reset]');
  assert.ok(btn, 'tombol Reset Password tidak ada di daftar user');
  await w.eval(`(async()=>{resetOwnerPassword(${JSON.stringify(btn.dataset.userReset)},${JSON.stringify(btn.dataset.username)})})()`);
  await new Promise(r => setTimeout(r, 120));
  const modal = w.document.getElementById('modal');
  assert.ok(modal.classList.contains('open'), 'modal password baru tidak terbuka');
  assert.match(modal.textContent, /wz-abcd1234/);
  assert.match(modal.textContent, /BIZ1/);
});
