/* Menyimpan state aplikasi ke server, termasuk balapan dengan auto-refresh.

   Bug yang dikunci di sini: `queueAppStateSave()` menunda penulisan 250ms,
   dan selama jeda itu `db` masih bisa ditimpa `hydrate()` dari server.
   Auto-refresh punya tiga pemicu -- timer 30 detik, `visibilitychange` setiap
   kali aplikasi dibuka dari latar belakang, dan FCM. Kalau salah satu datang
   di tengah jeda, perubahan Owner hilang, dan lebih buruknya penulisan yang
   tertunda mengirim nilai LAMA kembali ke server sehingga perubahan itu hilang
   permanen.

   Server di sini benar-benar menyimpan state (bukan stub kosong), jadi
   pengujiannya mengukur apa yang benar-benar tersimpan.
   Jalankan: node --test tests/state-save.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const INITIAL = {
  branches: [{ id: 'B1', name: 'Pusat', active: true }],
  employees: [{ id: 'E1', name: 'Budi', role: 'Barber', branchId: 'B1', salary: 2000000, commission: 0, target: 0, eval: 0, attendance: 0, active: true }],
  services: [
    { id: 'S1', name: 'Haircut', category: 'Umum', payrollCategory: 'haircut', price: 50000, duration: 30, active: true },
    { id: 'S2', name: 'Gundul', category: 'Umum', payrollCategory: '', price: 40000, duration: 25, active: true }
  ],
  customers: [], transactions: [], shiftReports: [], expenses: [], attendance: [], schedules: [], notifications: [], accounts: [],
  profile: { notificationSoundEnabled: true }
};

const openWindows = new Set();
test.after(() => { for (const w of openWindows) { try { w.close(); } catch { } } openWindows.clear(); });

async function boot({ putStatus = 200, seed = INITIAL } = {}) {
  let serverState = JSON.parse(JSON.stringify(seed));
  let serverUpdatedAt = '2026-09-27T00:00:00.000Z';
  let clock = 0;
  const puts = [];
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
        await new Promise(r => setTimeout(r, 20));
        if (p === 'auth/me') return json(200, { ok: true, user: { id: 'U1', username: 'owner', role: 'owner', name: 'Owner', businessId: 'BIZ1', branchId: 'B1' } });
        if (p === 'app-state') {
          if (method === 'GET') return json(200, { ok: true, data: serverState, updatedAt: serverUpdatedAt });
          const body = JSON.parse(opts.body || '{}');
          puts.push(JSON.parse(JSON.stringify(body.data || {})));
          if (putStatus === 403) return json(403, { ok: false, code: 'SUBSCRIPTION_REQUIRED', error: 'Subscription bisnis sudah tidak aktif.' });
          if (putStatus === 409 && body.expectedUpdatedAt && new Date(body.expectedUpdatedAt).getTime() !== new Date(serverUpdatedAt).getTime())
            return json(409, { ok: false, code: 'STATE_CONFLICT', error: 'Data server sudah berubah. Muat ulang sebelum menyimpan.' });
          serverState = body.data;
          serverUpdatedAt = new Date(Date.parse(serverUpdatedAt) + 60000 * (++clock)).toISOString();
          return json(200, { ok: true, updatedAt: serverUpdatedAt });
        }
        if (p === 'business') return json(200, { ok: true, transactions: [], shiftReports: [], branches: INITIAL.branches, notifications: [] });
        if (p === 'employees') return json(200, { ok: true, employees: INITIAL.employees });
        if (p === 'payroll/settings') return json(200, { ok: true, settings: { payrollType: 'BASE_PLUS_SERVICE_BONUS', baseSalary: 2000000, periodStartDay: 24, serviceRules: {} } });
        if (p === 'payroll/employee') return json(200, { ok: true, settings: [] });
        return json(200, { ok: true });
      };
    }
  });
  const w = dom.window;
  openWindows.add(w);
  for (let i = 0; i < 200 && typeof w.calculatePayroll !== 'function'; i++) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => setTimeout(r, 500));
  w.eval("currentUser={id:'U1',username:'owner',role:'owner',name:'Owner',businessId:'BIZ1',branchId:'B1'};true");
  await w.eval('(async()=>{window.WZOnlineSync.hydrate()})()');
  await new Promise(r => setTimeout(r, 150));
  return { w, errors, get server() { return serverState; }, puts };
}

async function openPayrollPage(w) {
  w.eval("location.hash='#payrollSettings';render();true");
  await new Promise(r => setTimeout(r, 350));
  const selects = [...w.document.querySelectorAll('select[onchange*="setServicePayrollCategory"]')];
  const sel = selects.find(x => x.getAttribute('onchange').includes("'S2'"));
  assert.ok(sel, 'dropdown untuk layanan S2 tidak ditemukan');
  return sel;
}

const serviceCategory = (w) => JSON.parse(w.eval('JSON.stringify(db.services.map(s=>s.id+"="+s.payrollCategory))'));
const serverCategory = state => JSON.stringify(state.services.map(s => s.id + '=' + s.payrollCategory));

test('kategori gaji tersimpan ke server dan bertahan setelah aplikasi dibuka ulang', async () => {
  const ctx = await boot();
  const w = ctx.w;
  const sel = await openPayrollPage(w);
  assert.strictEqual(sel.value, '', 'S2 awalnya belum berkategori');
  sel.value = 'hairwash';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 800));

  assert.strictEqual(serviceCategory(w).find(x => x.startsWith('S2=')), 'S2=hairwash');
  assert.strictEqual(serverCategory(ctx.server).includes('S2=hairwash'), true, 'harus tersimpan di server: ' + serverCategory(ctx.server));

  // dan kategorinya harus tetap ada. Boots kedua memakai state server yang
  // sama persis dengan yang sudah ditulis boot pertama.
  const again = await boot({ seed: ctx.server });
  await new Promise(r => setTimeout(r, 300));
  assert.strictEqual(serviceCategory(again.w).find(x => x.startsWith('S2=')), 'S2=hairwash',
    'kategori hilang setelah aplikasi ditutup dan dibuka lagi');
  again.w.close();
  openWindows.delete(again.w);
});

test('kategori gaji tidak hilang saat auto-refresh datang di tengah jeda simpan', async () => {
  const ctx = await boot();
  const w = ctx.w;
  const sel = await openPayrollPage(w);
  sel.value = 'hairwash';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  // Auto-refresh datang 60ms kemudian -- masih di dalam jeda debounce 250ms.
  // Ini yang terjadi di HP setiap kali Owner berpindah aplikasi.
  await new Promise(r => setTimeout(r, 60));
  await w.eval('(async()=>{window.WZOnlineSync.hydrate()})()');
  await new Promise(r => setTimeout(r, 900));

  assert.strictEqual(serviceCategory(w).find(x => x.startsWith('S2=')), 'S2=hairwash',
    'state lokal harus tetap memakai pilihan Owner');
  assert.strictEqual(serverCategory(ctx.server).includes('S2=hairwash'), true,
    'nilai lama tidak boleh ditulis balik ke server: ' + serverCategory(ctx.server));
});

test('halaman Pengaturan Gaji tidak berkedip "memuat" setiap kali dirender ulang', async () => {
  const { w } = await boot();
  await openPayrollPage(w);
  assert.ok(w.document.querySelector('[data-payroll-page]'), 'penanda halaman harus ada');
  // Render ulang (yang dilakukan setiap kali kategori diganti) tidak boleh
  // menampilkan placeholder lagi -- itulah yang terbaca oleh Owner sebagai
  // "halaman dimuat dua kali".
  w.eval("render();true");
  await new Promise(r => setTimeout(r, 60));
  const loading = w.document.getElementById('content').textContent.includes('Memuat pengaturan gaji tenant');
  assert.strictEqual(loading, false, 'placeholder "Memuat pengaturan gaji tenant..." tidak boleh muncul lagi');
  await new Promise(r => setTimeout(r, 300));
  assert.ok(w.document.getElementById('content').textContent.includes('Aturan Umum'), 'halaman harus tetap utuh');
});

test('kegagalan simpan diberitahukan ke Owner, bukan diam-diam', async () => {
  const { w } = await boot({ putStatus: 403 });
  const sel = await openPayrollPage(w);
  const toasts = [];
  w.eval(`window.__toasts=[];window.__t=toast;toast=function(m,bad){window.__toasts.push(String(m));return window.__t(m,bad)};true`);
  sel.value = 'haircut';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 700));
  const shown = JSON.parse(w.eval('JSON.stringify(window.__toasts||[])'));
  assert.ok(shown.some(t => /belum tersimpan/i.test(t)),
    'Owner harus diberi tahu kalau gagal menyimpan. Toast yang muncul: ' + JSON.stringify(shown));
});

test('save() memberi tahu pemanggil apakah benar-benar tersimpan', async () => {
  const ctx = await boot();
  const w = ctx.w;
  const ok = await w.eval('save()');
  await new Promise(r => setTimeout(r, 500));
  assert.strictEqual(ok, true, 'save() harus resolve true setelah berhasil');
  const fail = await (async () => { const b = await boot({ putStatus: 403 }); return b.w.eval('save()'); })();
  assert.strictEqual(fail, false, 'save() harus resolve false saat server menolak');
});
