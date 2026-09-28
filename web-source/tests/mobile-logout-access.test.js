/* Menu "Keluar" harus bisa disentuh di Android.

   Di HP, navigasi utama pindah ke bottom nav tetap (`.wz-bottom-nav`,
   `position:fixed`, `z-index:1200`, tinggi 68px). Tombol keluar yang
   sebelumnya hanya ada di dasar sidebar -- sidebar `z-index:20` dan
   `inset:0 auto 0 0`, jadi 68px paling bawahnya tertutup bar ikon itu. Gejalanya
   persis yang dilaporkan: menu keluar tidak terlihat, tidak bisa diketuk.

   Dua perbaikan, keduanya diuji di sini:
   1. Sidebar (dan snackbar `.toast`) dapat ruang bawah di atas bottom nav.
   2. Halaman Profil punya tombol "Keluar Akun" sendiri, jadi keluar akun tidak
      bergantung pada menu geser sama sekali.

   jsdom tidak menghitung layout, jadi aturan CSS diperiksa dari bentuk
   sumbernya: tinggi bar ikon dan nilai z-index dibaca dari stylesheet, lalu
   nilai padding yang dipakai sidebar/snackbar dibandingkan terhadapnya.

   Jalankan: node --test tests/mobile-logout-access.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Ambil isi blok @media berdasarkan kedalaman kurung kurawalanya. Kondisi yang
// sama dipakai beberapa kali, jadi blok dicari lewat penanda (needle)-nya.
function mediaBlock(source, condition, needle) {
  const marker = '@media(' + condition + '){';
  let from = 0;
  while (true) {
    const open = source.indexOf(marker, from);
    if (open < 0) break;
    let i = source.indexOf('{', open);
    const start = i + 1;
    let depth = 1;
    while (i + 1 < source.length && depth > 0) {
      i++;
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    const block = source.slice(start, i);
    if (block.includes(needle)) return block;
    from = i;
  }
  assert.fail('blok @media(' + condition + ') yang memuat "' + needle + '" tidak ditemukan');
}

const BOTTOM_NAV_MEDIA = 'max-width:600px';
const bottomNavCss = mediaBlock(INDEX, BOTTOM_NAV_MEDIA, '.wz-bottom-nav{');

test('blok media bottom nav hanya dibaca satu blok utuh', () => {
  assert.ok(bottomNavCss.includes('.wz-bottom-nav{'), 'blok ini bukan blok bottom nav');
  const height = bottomNavCss.match(/height:\s*(\d+)px/);
  assert.ok(height, 'tinggi bottom nav tidak terbaca');
  assert.strictEqual(Number(height[1]), 68, 'tinggi bottom nav berubah -- tes lain ikut menyesuaikan');
  const z = bottomNavCss.match(/z-index:\s*(\d+)/);
  assert.ok(z, 'z-index bottom nav tidak terbaca');
  assert.ok(Number(z[1]) >= 1000, 'bottom nav harus tetap di atas sidebar dan snackbar');
});

test('sidebar diberi ruang bawah setinggi bottom nav', () => {
  const sidebar = bottomNavCss.match(/\.sidebar\s*\{([^}]*)\}/);
  assert.ok(sidebar, 'tidak ada aturan .sidebar di blok layar kecil');
  const pad = sidebar[1].match(/padding-bottom:\s*calc\(([^;]*)\)/);
  assert.ok(pad, 'sidebar harus punya padding-bottom calc() di bawah 600px');
  const raw = pad[1];
  const bottomNavHeight = Number(bottomNavCss.match(/height:\s*(\d+)px/)[1]);
  const reserved = Number((raw.match(/^(\d+)px/) || [])[1] || NaN);
  assert.strictEqual(reserved, bottomNavHeight,
    'ruang bawah sidebar harus sama dengan tinggi bottom nav, bukan ' + reserved);
  assert.ok(raw.includes('safe-area-inset-bottom'),
    'ruang bawah sidebar harus ikut memperhitungkan system bar Android');
});

test('snackbar tidak lagi tertutup bottom nav', () => {
  const toast = bottomNavCss.match(/\.toast\s*\{([^}]*)\}/);
  assert.ok(toast, 'tidak ada aturan .toast di blok layar kecil');
  assert.ok(/left:\s*\d+px/.test(toast[1]) && /right:\s*\d+px/.test(toast[1]),
    'snackbar di layar kecil sebaiknya membentang penuh: ' + toast[1]);
  const bottom = toast[1].match(/bottom:\s*calc\(([^;]*)\)/);
  assert.ok(bottom, 'snackbar harus naik memakai calc() dari bawah');
  const bottomNavHeight = Number(bottomNavCss.match(/height:\s*(\d+)px/)[1]);
  const reserved = Number((bottom[1].match(/^(\d+)px/) || [])[1] || NaN);
  assert.ok(reserved >= bottomNavHeight,
    'snackbar harus mulai di atas bottom nav (' + bottomNavHeight + 'px), bukan ' + reserved + 'px');
});

const RICH = {
  branches: [{ id: 'B1', name: 'Pusat', active: true }],
  employees: [{ id: 'E1', name: 'Budi', role: 'Barber', branchId: 'B1', salary: 2500000, commission: 0, target: 0, eval: 0, attendance: 0, active: true }],
  services: [{ id: 'S1', name: 'Haircut', category: 'Umum', payrollCategory: 'haircut', price: 50000, duration: 30, active: true }],
  products: [], customers: [], transactions: [], shiftReports: [], expenses: [],
  attendance: [], schedules: [], notifications: [], accounts: [],
  profile: { analyticsPeriod: 7, notificationSoundEnabled: true }, payrollSettings: null
};

const openWindows = new Set();
test.after(() => { for (const w of openWindows) { try { w.close(); } catch { } } openWindows.clear(); });

async function bootApp(role) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
  const dom = new JSDOM(INDEX, {
    runScripts: 'dangerously', url: 'https://wz.test/', virtualConsole, pretendToBeVisual: true,
    beforeParse(w) {
      w.structuredClone = structuredClone;
      w.alert = m => errors.push('ALERT: ' + m);
      w.confirm = () => true;
      w.print = () => { };
      w.fetch = async (target, opts = {}) => {
        const p = String(target).replace('/api/', '').split('?')[0];
        const json = d => { const b = JSON.stringify(d); return { ok: true, status: 200, text: async () => b, json: async () => JSON.parse(b) }; };
        if (p === 'auth/me') return json({ ok: true, user: { id: 'U1', username: 'u', role, name: 'Pemilik', businessId: 'BIZ1', branchId: 'B1' } });
        if (p === 'business') return json({ ok: true, transactions: [], shiftReports: [], branches: RICH.branches, notifications: [] });
        if (p === 'employees') return json({ ok: true, employees: RICH.employees });
        if (p === 'app-state') return json({ ok: true, data: {}, updatedAt: null });
        return json({ ok: true });
      };
    }
  });
  const w = dom.window;
  openWindows.add(w);
  for (let i = 0; i < 200 && typeof w.go !== 'function'; i++) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => setTimeout(r, 250));
  w.eval('currentUser={id:"U1",username:"u",role:' + JSON.stringify(role) + ',name:"Pemilik",businessId:"BIZ1",branchId:"B1",employeeId:' + (role === 'employee' ? "'E1'" : 'null') + '};db=' + JSON.stringify(RICH) + ';true');
  return { w, errors };
}

for (const role of ['owner', 'manager', 'employee']) {
  test('halaman Profil role ' + role + ' punya tombol Keluar Akun', async () => {
    const { w, errors } = await bootApp(role);
    await w.eval("go('profile')");
    await new Promise(r => setTimeout(r, 100));
    const btn = w.document.getElementById('wzLogoutButton');
    assert.ok(btn, 'tombol keluar akun tidak ada di halaman Profil');
    assert.match(btn.textContent, /Keluar Akun/);
    assert.strictEqual(btn.getAttribute('onclick'), 'requestLogout()');
    assert.deepStrictEqual(errors, []);
    w.close(); openWindows.delete(w);
  });
}

test('tombol Keluar Akun meminta konfirmasi lalu benar-benar keluar', async () => {
  const { w } = await bootApp('owner');
  await w.eval("go('profile')");
  await new Promise(r => setTimeout(r, 100));
  await w.eval('window.__logoutCalled=0;window.logout=async function(){window.__logoutCalled++};true');

  w.document.getElementById('wzLogoutButton').click();
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(w.document.querySelector('#modal').classList.contains('open'), true,
    'dialog konfirmasi harus muncul');
  const ok = w.document.querySelector('#dialog [onclick="wzResolveDialog(true)"]');
  assert.ok(ok, 'tombol konfirmasi tidak ditemukan');
  ok.click();
  await new Promise(r => setTimeout(r, 80));
  assert.strictEqual(w.__logoutCalled, 1, 'logout harus dipanggil tepat sekali setelah dikonfirmasi');
  w.close(); openWindows.delete(w);
});

test('membatalkan konfirmasi tidak mengeluarkan akun', async () => {
  const { w } = await bootApp('owner');
  await w.eval("go('profile')");
  await new Promise(r => setTimeout(r, 100));
  await w.eval('window.__logoutCalled=0;window.logout=async function(){window.__logoutCalled++};true');
  w.document.getElementById('wzLogoutButton').click();
  await new Promise(r => setTimeout(r, 60));
  w.document.querySelector('#dialog [onclick="wzResolveDialog(false)"]').click();
  await new Promise(r => setTimeout(r, 80));
  assert.strictEqual(w.__logoutCalled, 0, 'Batal tidak boleh mengeluarkan akun');
  w.close(); openWindows.delete(w);
});

test('tombol Keluar di sidebar tetap ada sebagai jalan kedua', () => {
  assert.match(INDEX, /onclick="logout\(\)">Keluar<\/button>/,
    'tombol keluar di sidebar tidak boleh ikut hilang');
  assert.match(INDEX, /window\.requestLogout=requestLogout;/,
    'requestLogout harus terjangkau global untuk onclick di halaman Profil');
});
