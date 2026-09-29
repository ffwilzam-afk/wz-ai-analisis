/* Tombol yang menjalankan perintah ke server harus memberi tanda jalan.

   Yang dikunci di sini:
   1. Tombol yang ditekan diberi spinner (kelas `.wz-busy`), `aria-busy`,
      dan `disabled`, jadi pengguna tahu perintahnya masih jalan dan
      tidak bisa ditekan dua kali (mis. menyimpan transaksi dua kali).
   2. Tombol baru dibuka setelah **tidak ada lagi permintaan yang
      menggantung**, bukan hanya setelah funsinya selesai. Aksi sinkron
      (`saveService`) yang hanya mengubah state lalu `save()` juga
      mendapat perlakuan sama.
   3. **Tidak ada tanda di luar tombol.** Percobaan pertama memakai pil
      "Menyimpan..." mengambang di tengah bawah, tapi simpan latar
      (auto-refresh, FCM, `save()` 250ms) membuatnya berkedip berulang
      dan terasa seperti situs. Pil itu dihapus; tes ini mengunci
      ketiadaannya supaya tidak diam-diam kembali lagi.
   4. Ada dua batas tunggu supaya tombol tidak pernah terkunci selamanya.
   5. `login` dan `logout` SENGAJA dibiarkan tanpa pembungkus: keduanya
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

function boot() {
  const pending = [];
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
    '<button class="btn primary" id="save" onclick="saveTransaction()">Simpan</button>' +
    '<button class="btn" id="lain" onclick="saveService()">Simpan layanan</button>' +
    '<button class="btn" id="gagal" onclick="saveFails()">Simpan doomed</button>' +
    '<button class="btn" id="berjudul" title="Awal" onclick="saveTransaction()">Berjudul</button>' +
    '</body></html>',
    {
      runScripts: 'dangerously',
      beforeParse(w) {
        w.fetch = function () {
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
  return { w, pending };
}

function click(w, id) {
  w.document.getElementById(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
}
const settle = () => new Promise(r => setTimeout(r, 40));
const ok = () => ({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) });

test('tanda ada di tombol, tidak ada pil mengambang', () => {
  assert.ok(BLOCK_START > 0 && BLOCK_END > BLOCK_START, 'blok status proses tidak ditemukan');
  assert.match(INDEX, /\.wz-busy\{[^}]*pointer-events:none/, 'kelas .wz-busy tidak ada');
  assert.match(INDEX, /@keyframes wzSpin/, 'animasi spinner tidak ada');
  // Penjaga: tidak boleh ada pil atau kelas .wz-net lagi di halaman.
  assert.equal(/id="wzNet"/.test(INDEX), false, 'pil #wzNet masih ada di halaman');
  assert.equal(/\.wz-net\b/.test(INDEX), false, 'CSS .wz-net masih ada');
  assert.equal(/wzNetText|wzNetPaint|wzNetBegin|wzNetEnd/.test(INDEX), false, 'logika pil masih ada');
  assert.equal(/aria-live="polite"/.test(INDEX), false, 'masih ada pengumuman berulang untuk pembaca layar');
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
  const { w } = boot();
  assert.equal(w.login.__wzBusyWrapped, undefined, 'login tidak boleh dibungkus');
  assert.equal(w.logout.__wzBusyWrapped, undefined, 'logout tidak boleh dibungkus');
  const before = w.logoutCalls || 0;
  w.logout();
  assert.equal(w.logoutCalls, before + 1, 'logout tidak memanggil bridge satu kali');
  w.close();
});

test('tombol yang ditekan berputar dan terkunci selama perintah jalan', async () => {
  const { w, pending } = boot();
  const btn = w.document.getElementById('save');
  click(w, 'save');

  assert.ok(btn.classList.contains('wz-busy'), 'tombol tidak mendapat spinner');
  assert.equal(btn.disabled, true, 'tombol tidak dikunci, jadi bisa terkirim dua kali');
  assert.equal(btn.getAttribute('aria-busy'), 'true', 'aria-busy tidak diisi');
  assert.equal(pending.length, 1, 'perintah tidak sampai ke server');
  // Label hanya jadi tooltip; tidak ada elemen lain yang muncul.
  assert.equal(btn.getAttribute('title'), 'Menyimpan transaksi');
  assert.equal(w.document.querySelectorAll('.wz-net,#wzNet').length, 0);

  pending[0].resolve(ok());
  await new Promise(r => setTimeout(r, 60));
  assert.equal(btn.classList.contains('wz-busy'), false, 'spinner tidak dilepas setelah selesai');
  assert.equal(btn.disabled, false, 'tombol tidak bisa dipakai lagi');
  assert.equal(btn.hasAttribute('title'), false, 'tooltip label tidak dibersihkan');
  w.close();
});

test('tooltip yang sudah ada dikembalikan utuh', async () => {
  const { w, pending } = boot();
  const btn = w.document.getElementById('berjudul');
  click(w, 'berjudul');
  assert.equal(btn.getAttribute('title'), 'Menyimpan transaksi', 'label tidak menggantikan tooltip lama');
  pending[0].resolve(ok());
  await new Promise(r => setTimeout(r, 60));
  assert.equal(btn.getAttribute('title'), 'Awal', 'tooltip lama tidak dikembalikan');
  w.close();
});

test('perintah yang gagal tetap membuka kembali tombolnya', async () => {
  const { w, pending } = boot();
  const btn = w.document.getElementById('gagal');
  click(w, 'gagal');
  pending[0].reject(new Error('jaringan mati'));
  await new Promise(r => setTimeout(r, 120));
  assert.equal(btn.classList.contains('wz-busy'), false, 'tombol terkunci selamanya setelah gagal');
  assert.equal(btn.disabled, false);
  assert.equal(w.lastError, 'jaringan mati', 'kegagalan tidak diteruskan ke pemanggil');
  w.close();
});

test('aksi sinkron pun dapat tanda dan menunggu permintaannya', async () => {
  const { w, pending } = boot();
  const btn = w.document.getElementById('lain');
  click(w, 'lain');
  assert.ok(btn.classList.contains('wz-busy'), 'aksi sinkron tidak mendapat spinner');
  assert.equal(pending.length, 1, 'save() tidak mengirim apa-apa');
  await settle();
  assert.equal(btn.disabled, true, 'tombol hidup padahal server belum selesai');
  pending[0].resolve(ok());
  await new Promise(r => setTimeout(r, 250));
  assert.equal(btn.classList.contains('wz-busy'), false, 'tombol tidak dibuka setelah simpan selesai');
  w.close();
});

test('permintaan latar dihitung tapi tidak menampilkan apa pun', async () => {
  const { w, pending } = boot();
  // Auto-refresh, FCM, dan save() 250ms tidak punya tombol yang ditekan.
  w.fetch('/api/app-state', { method: 'PUT' });
  w.fetch('/api/branch', { method: 'PUT' });
  assert.equal(w.wzNetStatus.count, 2, 'dua permintaan tidak dihitung dua-duanya');
  assert.equal(w.document.querySelectorAll('.wz-net,#wzNet').length, 0, 'simpan latar memunculkan tanda');
  pending[0].resolve(ok());
  await settle();
  assert.equal(w.wzNetStatus.count, 1, 'penghitungan tidak turun sendiri');
  pending[1].resolve(ok());
  await settle();
  assert.equal(w.wzNetStatus.count, 0);
  w.close();
});

test('permintaan yang menggantung tidak mengunci tombol selamanya', async () => {
  const { w } = boot();
  // Pagar pengaman diperpendek supaya tidak menunggu 20 detik.
  w.wzBusyLimits.hard = 300;
  const btn = w.document.getElementById('save');
  click(w, 'save');
  // Tidak ada resolve sama sekali: promise aksi tidak pernah selesai.
  await new Promise(r => setTimeout(r, 600));
  assert.equal(btn.classList.contains('wz-busy'), false, 'tombol terkunci karena permintaan menggantung');
  assert.equal(btn.disabled, false);
  w.close();
});

test('permintaan yang masih menggantung ditunggu dengan batas', async () => {
  const { w } = boot();
  w.wzBusyLimits.idle = 4;
  const btn = w.document.getElementById('lain');
  click(w, 'lain');
  await new Promise(r => setTimeout(r, 800));
  assert.equal(btn.disabled, false, 'menunggu permintaan selamanya tanpa batas');
  w.close();
});
