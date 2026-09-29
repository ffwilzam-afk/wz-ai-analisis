/* Tombol yang menjalankan perintah ke server harus memberi tanda jalan.

   Yang dikunci di sini:
   1. Tombol yang ditekan diberi spinner (kelas `.wz-busy`) dan
      dinonaktifkan, jadi pengguna tahu perintahnya masih jalan dan
      tidak bisa ditekan dua kali (mis. menyimpan transaksi dua kali).
   2. Pil "Menyimpan..." muncul selama ada permintaan ke server yang
      belum selesai. Di HP indikator "Tersimpan online" di topbar
      disembunyikan kelas `.wz-top-hidden`, jadi tanpa pil ini tidak
      ada tanda sama sekali.
   3. Aksi sinkron (hanya mengubah state lalu `save()`) juga dapat
      tanda, dan tombolnya baru hidup setelah tidak ada permintaan
      yang menggantung.
   4. `login` dan `logout` SENGAJA dibiarkan tanpa pembungkus: keduanya
      meneruskan ke `window.login`/`window.logout`, jadi kalau dibungkus
      akan memanggil dirinya sendiri tanpa henti.

   Blok "status proses" diambil dari `index.html` lalu dijalankan di jsdom
   dengan fetch yang dikendalikan penuh, sehingga jumlah permintaan yang
   masih menggantung benar-benar diukur, bukan ditebak.

   Jalankan: node --test tests/loading-feedback.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Blok helper status proses, dari penanda tap sampai sebelum save().
const BLOCK_START = INDEX.indexOf('const wzTap={el:null};');
const BLOCK_END = INDEX.indexOf('function save(){', BLOCK_START);
const BLOCK = INDEX.slice(BLOCK_START, BLOCK_END);

function boot({ actions = [] } = {}) {
  const calls = [];
  const pending = [];
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
    '<button class="btn primary" id="save" onclick="' + actions[0] + '()">Simpan</button>' +
    '<button class="btn" id="lain" onclick="saveService()">Simpan layanan</button>' +
    '<button class="btn" id="gagal" onclick="saveFails()">Simpan doomed</button>' +
    '<div class="wz-net" id="wzNet" hidden role="status"><i class="wz-net-spin"></i>' +
    '<span class="wz-net-text" id="wzNetText">Menyimpan...</span></div>' +
    '</body></html>',
    {
      runScripts: 'dangerously',
      beforeParse(w) {
        w.fetch = function (input, init) {
          calls.push({ input: String(input), init });
          return new Promise((resolve, reject) => pending.push({ resolve, reject }));
        };
      }
    }
  );
  const w = dom.window;
  w.eval(BLOCK);
  w.eval(`
    window.actionsRun = 0;
    window.saveTransaction = async function(){
      actionsRun++;
      await fetch('/api/transaction',{method:'POST'});
      return 'saved';
    };
    window.saveService = function(){
      actionsRun++;
      fetch('/api/app-state',{method:'PUT'});
    };
    window.saveFails = async function(){
      actionsRun++;
      try{ await fetch('/api/transaction',{method:'POST'}); }
      catch(e){ window.lastError=e.message; return false; }
      return true;
    };
    window.login = function(){ window.loginCalls = (window.loginCalls||0)+1; };
    window.logout = function(){ window.logoutCalls = (window.logoutCalls||0)+1; };
  `);
  w.wzInstallBusyFeedback();
  return { w, calls, pending };
}

function click(w, id) {
  w.document.getElementById(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
}
const net = w => w.document.getElementById('wzNet');
const settle = () => new Promise(r => setTimeout(r, 30));

test('helper status proses benar-benar ada di index.html', () => {
  assert.ok(BLOCK_START > 0 && BLOCK_END > BLOCK_START, 'blok status proses tidak ditemukan');
  assert.match(INDEX, /<div class="wz-net" id="wzNet" hidden/, 'pil status tidak ada di halaman');
  assert.match(INDEX, /\.wz-busy\{[^}]*pointer-events:none/, 'kelas .wz-busy tidak ada');
  assert.match(INDEX, /@keyframes wzSpin/, 'animasi spinner tidak ada');
});

test('daftar aksi mencakup tombol yang paling sering dipakai', () => {
  for (const name of [
    'saveTransaction', 'saveShiftReport', 'saveEmployee', 'deleteEmployee', 'saveBranch',
    'saveCustomer', 'saveExpense', 'saveService', 'saveSettings', 'saveMyProfile',
    'saveMyUsername', 'saveMyPassword', 'saveEmployeePayroll', 'savePayrollSettings',
    'resetAll', 'exportBackup', 'importBackup', 'ownerForumSend', 'ownerRefreshBusiness',
  ]) {
    assert.ok(
      new RegExp('\\n\\s' + name + ":'").test(BLOCK),
      'aksi ' + name + ' tidak dapat tanda loading'
    );
  }
});

test('login dan logout tidak dibungkus (mencegah pemanggilan beruntun)', () => {
  const { w } = boot({ actions: ['saveTransaction'] });
  assert.equal(w.login.__wzBusyWrapped, undefined, 'login tidak boleh dibungkus');
  assert.equal(w.logout.__wzBusyWrapped, undefined, 'logout tidak boleh dibungkus');
  // Menu keluar lewat requestLogout() masih mengubah login tanpa dieder,
  // jadi memanggil window.logout langsung tidak berputar tanpa henti.
  const before = w.logoutCalls || 0;
  w.logout();
  assert.equal(w.logoutCalls, before + 1, 'logout tidak memanggil bridge satu kali');
  w.close();
});

test('tombol yang ditekan berputar dan terkunci selama perintah jalan', async () => {
  const { w, pending } = boot({ actions: ['saveTransaction'] });
  const btn = w.document.getElementById('save');
  click(w, 'save');

  assert.ok(btn.classList.contains('wz-busy'), 'tombol tidak mendapat spinner');
  assert.equal(btn.disabled, true, 'tombol tidak dikunci, jadi bisa terkirim dua kali');
  assert.equal(btn.getAttribute('aria-busy'), 'true', 'aria-busy tidak diisi');
  assert.equal(net(w).hidden, false, 'pil status tidak muncul');
  assert.match(w.document.getElementById('wzNetText').textContent, /transaksi/);
  assert.equal(pending.length, 1, 'perintah tidak sampai ke server');

  pending[0].resolve({ ok: true });
  await new Promise(r => setTimeout(r, 60));
  assert.equal(btn.classList.contains('wz-busy'), false, 'spinner tidak dilepas setelah selesai');
  assert.equal(btn.disabled, false, 'tombol tidak bisa dipakai lagi');
  assert.equal(net(w).hidden, true, 'pil status tidak disembunyikan');
  w.close();
});

test('perintah yang gagal tetap membuka kembali tombolnya', async () => {
  const { w, pending } = boot({ actions: ['saveTransaction'] });
  const btn = w.document.getElementById('gagal');
  click(w, 'gagal');
  pending[0].reject(new Error('jaringan mati'));
  await new Promise(r => setTimeout(r, 120));
  assert.equal(btn.classList.contains('wz-busy'), false, 'tombol terkunci selamanya setelah gagal');
  assert.equal(btn.disabled, false);
  // Permintaan terakhir yang gagal tidak boleh lenyap tanpa jejak:
  // kalau pilnya hilang begitu saja, pengguna mengira simpanannya berhasil.
  assert.equal(net(w).hidden, false, 'pil status hilang begitu saja setelah gagal');
  assert.equal(net(w).classList.contains('err'), true, 'pil status tidak menandai kegagalan');
  assert.match(w.document.getElementById('wzNetText').textContent, /Gagal/);
  // Setelah beberapa detik pilnya hilang sendiri.
  await new Promise(r => setTimeout(r, 2100));
  assert.equal(net(w).hidden, true, 'pil status tidak hilang setelah jangka waktu gagal');
  w.close();
});

test('aksi sinkron pun dapat tanda dan menunggu permintaannya', async () => {
  const { w, pending } = boot({ actions: ['saveTransaction'] });
  const btn = w.document.getElementById('lain');
  click(w, 'lain');
  assert.ok(btn.classList.contains('wz-busy'), 'aksi sinkron tidak mendapat spinner');
  assert.equal(pending.length, 1, 'save() tidak mengirim apa-apa');
  // Permintaan masih jalan: tombol harus tetap terkunci.
  await settle();
  assert.equal(btn.disabled, true, 'tombol hidup padahal server belum selesai');
  pending[0].resolve({ ok: true });
  await new Promise(r => setTimeout(r, 250));
  assert.equal(btn.classList.contains('wz-busy'), false, 'tombol tidak dibuka setelah simpan selesai');
  assert.equal(net(w).hidden, true);
  w.close();
});

test('pil status ikut muncul untuk simpan di latar belakang', async () => {
  const { w, pending } = boot({ actions: ['saveTransaction'] });
  // Auto-refresh dan simpan state berjalan tanpa tombol yang ditekan.
  w.fetch('/api/app-state', { method: 'PUT' });
  assert.equal(net(w).hidden, false, 'pil status tidak muncul untuk permintaan latar');
  assert.equal(pending.length, 1);
  pending[0].resolve({ ok: true });
  await settle();
  assert.equal(net(w).hidden, true, 'pil status tidak hilang setelah selesai');
  w.close();
});

test('permintaan yang menggantung tidak mengunci tombol selamanya', async () => {
  const { w } = boot({ actions: ['saveTransaction'] });
  // Pagar pengaman shorten-kan supaya tidak menunggu 20 detik.
  w.wzBusyLimits.hard=300;
  const btn = w.document.getElementById('save');
  click(w, 'save');
  // Tidak ada resolve sama sekali: promise aksi tidak pernah selesai.
  await new Promise(r => setTimeout(r, 600));
  assert.equal(btn.classList.contains('wz-busy'), false, 'tombol terkunci karena permintaan menggantung');
  assert.equal(btn.disabled, false);
  w.close();
});

test('permintaan yang masih menggantung ditunggu dengan batas', async () => {
  const { w } = boot({ actions: ['saveTransaction'] });
  w.wzBusyLimits.idle=4;
  const btn = w.document.getElementById('lain');
  click(w, 'lain');
  await new Promise(r => setTimeout(r, 800));
  assert.equal(btn.disabled, false, 'menunggu permintaan selamanya tanpa batas');
  w.close();
});

test('permintaan yang tidak terkait tombol dihitung dengan benar', async () => {
  const { w, pending } = boot({ actions: ['saveTransaction'] });
  w.fetch('/api/a');
  w.fetch('/api/b');
  assert.equal(w.wzNetStatus.count, 2, 'dua permintaan tidak dihitung dua-duanya');
  pending[0].resolve({ ok: true });
  await settle();
  assert.equal(net(w).hidden, false, 'pil hilang padahal masih ada satu permintaan');
  pending[1].resolve({ ok: true });
  await settle();
  assert.equal(net(w).hidden, true);
  w.close();
});
