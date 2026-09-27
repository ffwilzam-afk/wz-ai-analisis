/* Ketahanan: data rusak, string bermusuhan, dan cache service worker.
 *
 * Tes ini lahir dari audit kedua sebelum rilis. Yang diuji:
 *
 * 1. State dari `app-state` server tidak selalu berbentuk rapi. Kalau
 *    `services` berupa string atau `customers` berisi null, halaman-halaman
 *    lama akan memanggil `db.x.filter`/`db.x.map` dan melempar error yang
 *    TIDAK tertangkap -- seluruh layar jadi kosong tanpa tombol keluar.
 *    `normalizeDbState()` menjadi satu penjaga di satu titik.
 * 2. Semua teks yang diketik pengguna (nama pelanggan, layanan, catatan)
 *    harus berakhir sebagai TEKS, bukan sebagai atribut event handler atau
 *    elemen `<img>/<script>` yang bisa dieksekusi.
 * 3. Service worker hanya boleh menyimpan respons sukses sebagai app shell.
 *    Kalau halaman error ikut ter-cache, pengguna yang sedang offline
 *    mendapat halaman error alih-alih aplikasi.
 *
 * Jalankan: node --test tests/resilience.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const openWindows = new Set();
test.after(() => { for (const w of openWindows) { try { w.close(); } catch { } } openWindows.clear(); });

/* --- 1. state rusak dari server ------------------------------------------ */

// Bentuk-bentuk yang masuk akal terjadi bila state pernah ditulis oleh versi
// lama, terpotong, atau diedit manual.
const BROKEN_STATES = [
  {
    label: 'koleksi berupa string dan null di dalamnya',
    data: {
      branches: null, employees: undefined, services: 'bukan array', products: [{}],
      customers: [null], transactions: [null], shiftReports: [null],
      expenses: [{}], attendance: 'x', schedules: [], notifications: [null],
      accounts: [{}], profile: null, payrollSettings: { serviceRules: null, employees: null }
    }
  },
  {
    label: 'profile dan payrollSettings bukan objek',
    data: { profile: 'teks', payrollSettings: [1, 2, 3], services: [{ id: 'S1', name: 'x', price: 'abc' }] }
  },
  {
    label: 'serviceRules null tapi payrollSettings ada',
    data: { payrollSettings: { payrollType: 'NGGAWUR', baseSalary: 'abc', periodStartDay: 99, serviceRules: null, employees: {} } }
  }
];

async function bootWithState(data, role = 'owner') {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
  virtualConsole.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
  const dom = new JSDOM(INDEX_HTML, {
    runScripts: 'dangerously', url: 'https://wz.test/', virtualConsole, pretendToBeVisual: true,
    beforeParse(w) {
      w.structuredClone = structuredClone;
      w.addEventListener('error', ev => errors.push('window.error: ' + ((ev.error && ev.error.message) || ev.message)));
      w.addEventListener('unhandledrejection', ev => errors.push('unhandledrejection: ' + ((ev.reason && ev.reason.message) || ev.reason)));
      w.alert = () => { }; w.confirm = () => true; w.print = () => { };
      w.fetch = async (url) => {
        const p = String(url).replace('/api/', '').split('?')[0];
        const payload = p === 'app-state' ? { ok: true, data, updatedAt: null } : { ok: true };
        const body = JSON.stringify(payload);
        return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
      };
    }
  });
  const w = dom.window;
  openWindows.add(w);
  for (let i = 0; i < 200 && typeof w.calculatePayroll !== 'function'; i++) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => setTimeout(r, 350));
  w.eval(`currentUser={id:'U1',username:'u',role:${JSON.stringify(role)},name:'P',businessId:'BIZ1',branchId:'B1'};true`);
  // Jalur nyata: state masuk lewat hydrateAppState, bukan di-assign manual.
  await w.eval('(async()=>{await window.WZOnlineSync.hydrate()})()');
  await new Promise(r => setTimeout(r, 250));
  return { w, errors };
}

for (const state of BROKEN_STATES) {
  test('state rusak dari server tidak boleh membuat halaman kosong: ' + state.label, async () => {
    const { w, errors } = await bootWithState(state.data, 'owner');
    const routes = JSON.parse(w.eval('JSON.stringify(menu.map(m=>m[0]))'));
    const problems = [];
    for (const key of routes) {
      errors.length = 0;
      try { w.eval(`location.hash=${JSON.stringify('#' + key)};render();true`); }
      catch (e) { errors.push('THROW: ' + e.message); }
      await new Promise(r => setTimeout(r, 40));
      const content = w.document.getElementById('content');
      if (!content || content.innerHTML.length < 40) problems.push(`${key}: tidak merender apa pun`);
      for (const e of [...new Set(errors)]) problems.push(`${key}: ${e.slice(0, 160)}`);
    }
    assert.deepStrictEqual(problems, []);
    w.close();
    openWindows.delete(w);
  });
}

test('payrollRuleBucket tidak pernah mengembalikan null', async () => {
  // typeof null adalah 'object', jadi penjaga `typeof x === 'object'` saja
  // tidak cukup. Nilai balik null membuat pemanggil melakukan bucket[key]
  // dan seluruh halaman berhenti.
  const { w } = await bootWithState({}, 'owner');
  for (const input of ['null', 'undefined', '{}', '{serviceRules:null}', '{serviceRules:[]}', '"teks"', '42', '{serviceRules:{Haircut:{threshold:5,bonus:7}}}']) {
    const bucket = JSON.parse(w.eval(`JSON.stringify(payrollRuleBucket(${input}))`));
    assert.ok(bucket && typeof bucket === 'object' && !Array.isArray(bucket),
      `payrollRuleBucket(${input}) harus objek, bukan ${JSON.stringify(bucket)}`);
  }
  // Dan yang benar tetap terbaca apa adanya.
  assert.deepStrictEqual(
    JSON.parse(w.eval(`JSON.stringify(payrollRuleBucket({serviceRules:{Haircut:{threshold:5,bonus:7}}}))`)),
    { Haircut: { threshold: 5, bonus: 7 } }
  );
  w.close();
  openWindows.delete(w);
});

test('normalizeDbState mengubah koleksi rusak menjadi array yang bisa dipakai', async () => {
  const { w } = await bootWithState({}, 'owner');
  const result = JSON.parse(w.eval(`JSON.stringify(normalizeDbState({
    branches:null, employees:undefined, services:'bukan array', products:[{}],
    customers:[null,1,'x'], profile:'teks', payrollSettings:[1,2,3]
  }))`));
  assert.deepStrictEqual(result.branches, []);
  assert.deepStrictEqual(result.employees, []);
  assert.deepStrictEqual(result.services, []);
  assert.deepStrictEqual(result.products, [{}]);
  assert.deepStrictEqual(result.customers, [], 'entri non-objek harus dibuang');
  assert.deepStrictEqual(result.profile, {});
  assert.strictEqual(result.payrollSettings, null);
  w.close();
  openWindows.delete(w);
});

test('serviceRules null tidak membuat halaman gaji blank', async () => {
  const { w, errors } = await bootWithState({
    employees: [{ id: 'E1', name: 'Budi', role: 'Barber', branchId: 'B1', salary: 2000000, commission: 0, target: 0, eval: 0, attendance: 0, active: true }],
    branches: [{ id: 'B1', name: 'Pusat', active: true }],
    services: [{ id: 'S1', name: 'Haircut', payrollCategory: 'haircut', price: 1, duration: 1, active: true }],
    payrollSettings: { payrollType: 'BASE_PLUS_SERVICE_BONUS', baseSalary: 2000000, periodStartDay: 24, serviceRules: null, employees: {} }
  }, 'owner');
  errors.length = 0;
  w.eval("location.hash='#payrollSettings';render();true");
  await new Promise(r => setTimeout(r, 200));
  assert.deepStrictEqual([...new Set(errors)], [], 'harness error: ' + errors.join(' | '));
  const html = w.document.getElementById('content').innerHTML;
  assert.ok(html.length > 200, 'halaman Pengaturan Gaji kosong');
  assert.match(html, /Aturan Umum/);
  w.close();
  openWindows.delete(w);
});

/* --- 2. string bermusuhan ------------------------------------------------- */

const P_IMG = `<img src=x onerror="window.__PWNED=1">`;
const P_ATTR = `" onmouseover="window.__PWNED2=2`;
const P_JS = `' + window.__PWNED3=3 + '`;
const P_CLOSE = `</textarea><img src=x onerror="window.__PWNED4=4">`;

const HOSTILE_DB = {
  branches: [{ id: 'B1', name: P_IMG, address: P_ATTR, active: true }],
  employees: [{ id: 'E1', name: P_IMG, role: 'Barber', branchId: 'B1', salary: 1, commission: 0, target: 0, eval: 0, attendance: 0, active: true }],
  services: [{ id: 'S1', name: P_JS, category: P_ATTR, payrollCategory: '', price: 1, duration: 1, active: true }],
  products: [], customers: [{ id: 'C1', name: P_CLOSE, phone: P_IMG, active: true }],
  transactions: [{
    id: 'TX1', date: 'bukan-tanggal', time: P_ATTR, customerId: 'C1', customerName: P_IMG, employeeId: 'E1',
    serviceId: 'S1', serviceName: P_JS, items: [], servicePrice: 'NaN', price: null, discount: 200,
    total: 'Infinity', payment: P_CLOSE, status: 'ANOMALI', branchId: 'B1'
  }],
  shiftReports: [{
    id: 'SR1', date: '2026-13-45', employeeId: 'E1', shiftType: P_IMG, customers: -1, totalOmzet: 'abc',
    services: [{ serviceId: 'S1', serviceName: P_JS, payrollCategory: 'ngawur', qty: -3, price: null, total: 'NaN' }],
    products: [], expenses: [], notes: P_CLOSE, cashIn: 'x', cashOut: -1, branchId: 'B1'
  }],
  expenses: [{ id: 'X1', date: 'xx', category: P_IMG, name: P_ATTR, amount: 'NaN', note: P_JS, branchId: 'B1' }],
  attendance: [], schedules: [],
  notifications: [{ id: P_IMG, type: P_ATTR, title: P_JS, message: P_CLOSE, createdAt: 'bukan tanggal', read: false }],
  accounts: [],
  profile: { name: P_IMG, role: P_ATTR, brand: P_JS, focus: P_CLOSE, notificationSoundEnabled: true },
  payrollSettings: null
};

test('teks bermusuhan tidak pernah jadi atribut event handler atau elemen suntikan', async () => {
  const { w, errors } = await bootWithState(HOSTILE_DB, 'owner');
  const routes = JSON.parse(w.eval('JSON.stringify(menu.map(m=>m[0]))'));
  const problems = [];
  for (const key of routes) {
    errors.length = 0;
    try { w.eval(`location.hash=${JSON.stringify('#' + key)};render();true`); }
    catch (e) { errors.push('THROW: ' + e.message); }
    await new Promise(r => setTimeout(r, 40));
    // Yang berbahaya bukan payload yang terlihat di HTML, tapi payload yang
    // menjadi atribut handler atau elemen nyata di DOM.
    const bad = w.eval(`(() => {
      const out=[];
      const root=document.getElementById('content');
      if(!root) return 'TIDAK ADA #content';
      for(const el of root.querySelectorAll('*')){
        for(const a of el.attributes){ if(/^on/i.test(a.name)&&/__PWNED/.test(String(a.value))) out.push(a.name+'='+String(a.value).slice(0,60)); }
      }
      return out.join(' ;; ');
    })()`);
    if (bad) problems.push(`${key}: atribut bermusuhan ${bad}`);
    const injected = w.eval(`(document.getElementById('content')||document.createElement('div')).querySelectorAll('img, script:not([type])').length`);
    if (injected) problems.push(`${key}: ${injected} elemen disisipkan`);
    if (w.eval('Boolean(window.__PWNED||window.__PWNED2||window.__PWNED3||window.__PWNED4)'))
      problems.push(`${key}: payload benar-benar dieksekusi`);
    for (const e of [...new Set(errors)]) problems.push(`${key}: ${e.slice(0, 140)}`);
  }
  assert.deepStrictEqual(problems, []);
  w.close();
  openWindows.delete(w);
});

test('dialog bermusuhan juga tidak menyuntik apa pun', async () => {
  const { w } = await bootWithState(HOSTILE_DB, 'owner');
  const problems = [];
  for (const expr of ['openEmployee("E1")', 'editService("S1")', 'openService()', 'employeeDetail("E1")',
  'openExpense()', 'openTransaction()', 'editMyProfile()', 'openCustomer("C1")', 'openBranch("B1")',
  'txDetail("TX1")', 'customerDetail("C1")', 'openEmployeePayrollForm("E1")', 'showWalkin()']) {
    w.eval(`closeModal();${expr};true`);
    await new Promise(r => setTimeout(r, 25));
    const bad = w.eval(`(() => {
      const out=[]; const m=document.getElementById('modal'); if(!m) return 'TIDAK ADA #modal';
      for(const el of m.querySelectorAll('*')) for(const a of el.attributes){ if(/^on/i.test(a.name)&&/__PWNED/.test(String(a.value))) out.push(a.name); }
      return out.join(' ;; ');
    })()`);
    if (bad) problems.push(`${expr}: atribut bermusuhan ${bad}`);
    const injected = w.eval(`(document.getElementById('modal')||{querySelectorAll:()=>[]}).querySelectorAll('img, script:not([type])').length`);
    if (injected) problems.push(`${expr}: ${injected} elemen disisipkan`);
  }
  assert.deepStrictEqual(problems, []);
  w.close();
  openWindows.delete(w);
});

test('detail untuk id yang tidak ada memberi pesan, bukan error', async () => {
  const { w, errors } = await bootWithState({ branches: [{ id: 'B1', name: 'Pusat', active: true }] }, 'owner');
  errors.length = 0;
  for (const expr of ['txDetail("tidak-ada")', 'customerDetail("tidak-ada")', 'employeeDetail("tidak-ada")', 'shiftReportDetail("tidak-ada")']) {
    try { w.eval(`closeModal();${expr};true`); } catch (e) { errors.push(expr + ' THROW: ' + e.message); }
    await new Promise(r => setTimeout(r, 20));
  }
  assert.deepStrictEqual([...new Set(errors)], []);
  w.close();
  openWindows.delete(w);
});

/* --- 3. service worker ---------------------------------------------------- */

const SW_SOURCE = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

/* Menjalankan sw.js di sandbox dengan cache & fetch palsu, lalu mengirim
   event fetch sungguhan. Ini menguji perilaku, bukan sekadar membaca teks. */
function runServiceWorker({ status, ok }) {
  const cache = new Map();
  const putCalls = [];
  const sandbox = {
    self: {
      addEventListener(type, handler) { sandbox.__handlers[type] = handler; },
      registration: { showNotification: async () => { }, unregister: async () => { } },
      clients: { claim: async () => { }, matchAll: async () => [], openWindow: async () => { } },
      skipWaiting: async () => { }
    },
    __handlers: {},
    caches: {
      open: async name => ({
        addAll: async () => { },
        put: async (key, response) => { putCalls.push(String(key)); cache.set(String(key), response); },
        match: async key => cache.get(String(key))
      }),
      keys: async () => [nameOfCache],
      delete: async () => { }
    },
    fetch: async () => ({ ok, status, clone() { return this; } }),
    clients: sandbox_self_clients(),
    URL, Set
  };
  const nameOfCache = 'wz-manage-pro-pwa-v5';
  function sandbox_self_clients() {
    return { claim: async () => { }, matchAll: async () => [], openWindow: async () => { } };
  }
  sandbox.self.location = { origin: 'https://wz.test' };
  const context = vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, context);
  return { sandbox, putCalls, cache, nameOfCache };
}

test('service worker tidak menyimpan halaman error sebagai app shell', async () => {
  const { sandbox, putCalls, cache } = runServiceWorker({ ok: false, status: 500 });
  let waitUntil = null;
  const event = {
    request: { method: 'GET', url: 'https://wz.test/', mode: 'navigate' },
    respondWith(p) { waitUntil = p; }
  };
  sandbox.__handlers.fetch(event);
  assert.ok(waitUntil, 'handler fetch tidak memanggil respondWith');
  await waitUntil;
  await new Promise(r => setTimeout(r, 30));
  assert.deepStrictEqual(putCalls, [], 'respons 500 tidak boleh masuk cache');
  assert.strictEqual(cache.has('/index.html'), false, 'halaman error tersimpan sebagai app shell');
});

test('service worker menyimpan index.html yang sukses untuk dipakai offline', async () => {
  const { sandbox, putCalls, cache } = runServiceWorker({ ok: true, status: 200 });
  let waitUntil = null;
  sandbox.__handlers.fetch({
    request: { method: 'GET', url: 'https://wz.test/', mode: 'navigate' },
    respondWith(p) { waitUntil = p; }
  });
  await waitUntil;
  await new Promise(r => setTimeout(r, 30));
  assert.ok(putCalls.includes('/index.html'), 'app shell sukses harus ter-cache untuk offline');
  assert.strictEqual(cache.has('/index.html'), true);
});

test('service worker tidak pernah menyentuh /api/', () => {
  assert.match(SW_SOURCE, /url\.pathname\.startsWith\('\/api\/'\)\)\s*return;/,
    'endpoint API tidak boleh di-cache (data bisnis milik server)');
});
