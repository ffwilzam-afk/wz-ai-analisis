/* Dialog bawaan WebView membocorkan alamat server.
  confirm dan alert bawaan browser memunculkan dialog sistem Android saat
   dipanggil dari dalam WebView, dan judul jendela dialog itu diambil dari
   halaman yang sedang dimuat. Karena judul halaman kosong, WebView memakai
   alamatnya -- sehingga wz-ai-analisis-rust.vercel.app ikut terbaca setiap
   kali pengguna mengonfirmasi hapus karyawan, void transaksi, restore backup,
   atau reset bisnis. Itu yang dilaporkan pengguna: menghapus karyawan
   memunculkan dialog bertuliskan alamat web view.

   Perbaikannya: dialog milik aplikasi sendiri (konfirmasi + peringatan), dan
   tidak ada satu pun panggilan dialog bawaan yang tersisa di index.html
   maupun admin.html.

   Tes di sini ada dua jenis:
   1. Penjaga statis -- kalau suatu saat ada confirm/alert/prompt yang
      ditambahkan lagi, tes ini gagal dan bug-nya tidak bisa lolos ke rilis.
   2. Perilaku -- dialog benar-benar resolve, menutup diri, dan never
      menyuntik HTML dari pesan pengguna.

   Jalankan: node --test tests/webview-dialogs.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

// Komentar hanya menjelaskan alasan, tidak memanggil apa pun. Tanpa pemotongan
// ini, dokumentasi yang rapi ikut dianggap bug.
const stripComments = source => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ');

const openWindows = new Set();
test.after(() => { for (const w of openWindows) { try { w.close(); } catch { } } openWindows.clear(); });

async function boot({ authed = true, html = INDEX } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://wz-ai-analisis-rust.vercel.app/', virtualConsole, pretendToBeVisual: true,
    beforeParse(w) {
      w.structuredClone = structuredClone;
      w.alert = m => errors.push('ALERT BAWAAN: ' + m);
      w.confirm = () => { errors.push('CONFIRM BAWAAN dipanggil'); return true; };
      w.print = () => { };
      w.fetch = async (target, opts = {}) => {
        const path = String(target).replace('/api/', '').split('?')[0];
        const method = opts.method || 'GET';
        const json = (status, obj) => {
          const b = JSON.stringify(obj);
          return { ok: status < 400, status, text: async () => b, json: async () => JSON.parse(b) };
        };
        if (path === 'auth/me') {
          return authed
            ? json(200, { ok: true, user: { id: 'U1', role: 'owner', name: 'Owner', businessId: 'BIZ1' } })
            : json(401, { ok: false, error: 'Belum login.' });
        }
        if (path === 'auth/login') return json(400, { ok: false, error: 'Username atau password salah.' });
        return json(200, { ok: true });
      };
    }
  });
  const w = dom.window;
  openWindows.add(w);
  for (let i = 0; i < 200 && typeof w.calculatePayroll !== 'function'; i++) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => setTimeout(r, 400));
  return { w, errors };
}

test('penjaga: tidak boleh ada dialog bawaan yang tersisa di kedua halaman', () => {
  for (const [name, source] of [['index.html', INDEX], ['admin.html', ADMIN]]) {
    const code = stripComments(source);
    for (const native of ['alert', 'confirm', 'prompt']) {
      const hits = [...code.matchAll(new RegExp('(?<![\\w.$])' + native + '\\s*\\(', 'g'))];
      assert.strictEqual(hits.length, 0,
        name + ' masih memakai ' + native + ' bawaan. Dialog itu memunculkan alamat WebView sebagai judul.');
    }
  }
});

test('penjaga: halaman aplikasi tidak boleh pernah mencetak alamat server', () => {
  // modernity: tidak boleh ada yang mencetak location.href / location.origin
  // ke dalam dialog atau teks, karena itulah sumber kebocoran yang sama.
  for (const [name, source] of [['index.html', INDEX], ['admin.html', ADMIN]]) {
    const code = stripComments(source);
    assert.doesNotMatch(code, /location\.(href|origin|host)\s*\}/,
      name + ' menampilkan alamat halaman ke pengguna');
  }
});

test('dialog konfirmasi: OKE memberi true, BATAL memberi false', async () => {
  const { w, errors } = await boot();
  assert.strictEqual(typeof w.konfirmasi, 'function', 'helper konfirmasi harus terjangkau dari handler inline');
  assert.strictEqual(typeof w.peringatan, 'function');

  const ok = w.eval('konfirmasi("Hapus karyawan Budi?")');
  await new Promise(r => setTimeout(r, 80));
  const buttons = [...w.document.querySelectorAll('#dialog button')];
  assert.ok(buttons.length >= 2, 'dialog harus punya tombol aksi');
  assert.match(w.document.getElementById('dialog').textContent, /Hapus karyawan Budi\?/);
  assert.doesNotMatch(w.document.getElementById('dialog').textContent, /vercel|https?:\/\//,
    'dialog tidak boleh memuat alamat server');
  buttons.find(b => b.textContent.trim() === 'OKE').click();
  assert.strictEqual(await ok, true, 'menekan OKE harus resolving true');

  const batal = w.eval('konfirmasi("Hapus karyawan Budi?")');
  await new Promise(r => setTimeout(r, 80));
  [...w.document.querySelectorAll('#dialog button')].find(b => b.textContent.trim() === 'BATAL').click();
  assert.strictEqual(await batal, false, 'menekan BATAL harus resolving false');

  assert.deepStrictEqual(errors, [], 'dialog bawaan tidak boleh terpakai: ' + JSON.stringify(errors));
  w.close(); openWindows.delete(w);
});

test('dialog peringatan: menutup diri dan tidak menyuntik HTML dari pesan', async () => {
  const { w, errors } = await boot();
  w.eval('peringatan("<img src=x onerror=\\"alert(1)\\"> <b>tebal</b>")');
  await new Promise(r => setTimeout(r, 60));
  const dialog = w.document.getElementById('dialog');
  assert.match(dialog.textContent, /<img src=x/, 'pesan harus tampil sebagai teks apa adanya');
  assert.strictEqual(dialog.querySelectorAll('img,b').length, 0, 'pesan tidak boleh jadi HTML');
  dialog.querySelector('button').click();
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(w.document.getElementById('modal').classList.contains('open'), false, 'dialog harus tertutup');
  assert.deepStrictEqual(errors, []);
  w.close(); openWindows.delete(w);
});

test('pesan berbaris baru tetap terbaca di dialog', async () => {
  const { w } = await boot();
  w.eval('peringatan("Baris satu\\n\\nBaris tiga")');
  await new Promise(r => setTimeout(r, 60));
  const html = w.document.querySelector('#dialog .dialog-text').innerHTML;
  // Dua newline = satu baris kosong: tiga sel dipecah, jadi dua <br>
  // beruntun. Yang penting jeda itu ada, bukan hilang.
  assert.match(html, /Baris satu<br><br>\s*<br>Baris tiga/, 'baris kosong harus jadi jeda: ' + html);
  w.close(); openWindows.delete(w);
});

test('dialog baru menggantikan dialog lama, tidak menumpuk', async () => {
  // Kalau pengguna menekan dua tombol hapus dengan cepat, promise yang
  // tertinggal harus dianggap "batal", bukan menggantungkan alur.
  const { w } = await boot();
  const first = w.eval('konfirmasi("Pertama")');
  await new Promise(r => setTimeout(r, 50));
  const second = w.eval('konfirmasi("Kedua")');
  await new Promise(r => setTimeout(r, 50));
  assert.strictEqual(await first, false, 'dialog yang tertimpa harus resolving false');
  assert.match(w.document.getElementById('dialog').textContent, /Kedua/, 'hanya dialog terakhir yang tampil');
  [...w.document.querySelectorAll('#dialog button')].find(b => b.textContent.trim() === 'BATAL').click();
  assert.strictEqual(await second, false);
  w.close(); openWindows.delete(w);
});

test('hapus karyawan memakai dialog aplikasi, bukan confirm bawaan', async () => {
  const { w, errors } = await boot();
  w.eval(`db={branches:[],employees:[{id:'E1',name:'Budi',role:'Barber',branchId:'B1',salary:0,commission:0,target:0,eval:0,attendance:0,active:true}],services:[],products:[],customers:[],transactions:[],shiftReports:[],expenses:[],attendance:[],schedules:[],notifications:[],accounts:[],profile:{},payrollSettings:null};currentUser={id:'U1',role:'owner',name:'Owner',businessId:'BIZ1',branchId:'B1'};go('employees');true`);
  await new Promise(r => setTimeout(r, 200));
  const btn = [...w.document.querySelectorAll('#content button')].find(b => b.textContent.trim() === 'Hapus');
  assert.ok(btn, 'tombol Hapus harus ada di halaman karyawan');
  btn.click();
  await new Promise(r => setTimeout(r, 100));
  const dialog = w.document.getElementById('dialog');
  assert.ok(w.document.getElementById('modal').classList.contains('open'), 'dialog konfirmasi harus muncul');
  assert.match(dialog.textContent, /Hapus karyawan Budi/);
  assert.doesNotMatch(dialog.textContent, /https?:\/\//, 'dialog tidak boleh memuat alamat server');
  assert.deepStrictEqual(errors, [], 'confirm bawaan tidak boleh terpakai: ' + JSON.stringify(errors));

  // Batal -> karyawan tetap ada.
  [...w.document.querySelectorAll('#dialog button')].find(b => b.textContent.trim() === 'BATAL').click();
  await new Promise(r => setTimeout(r, 100));
  assert.strictEqual(w.eval("db.employees.length"), 1, 'membatalkan dialog tidak boleh menghapus karyawan');
  w.close(); openWindows.delete(w);
});

test('dialog harus berada di atas layar login, bukan tertutupnya', () => {
  // alerting/confirming pada layar login dulu selalu terlihat karena dialog
  // itu milik sistem. Begitu dipindah ke dialog aplikasi, posisinya di lapisan
  // yang sama dengan elemen lain: .modal semula z-index:50, sedangkan
  // .login-screen z-index:100, jadi "Data login salah" tidak akan terlihat
  // sama sekali. Bandingkan angkanya, bukan matikan gayanya.
  const zIndexOf = selector => {
    const m = INDEX.match(new RegExp('\\' + selector + '\\{[^}]*z-index:(\\d+)'));
    assert.ok(m, 'aturan ' + selector + ' tidak ditemukan di index.html');
    return Number(m[1]);
  };
  const modal = zIndexOf('.modal');
  for (const other of ['.login-screen', '.wz-startup-loading']) {
    assert.ok(modal > zIndexOf(other),
      '.modal (z-index ' + modal + ') harus di atas ' + other + ' (z-index ' + zIndexOf(other) + ')');
  }
  assert.ok(zIndexOf('.toast') > modal, 'toast harus tetap terlihat di atas dialog');
});

test('dialog tetap muncul saat aplikasi masih di layar login/daftar', async () => {
  // Pendaftaran yang berhasil memakai peringatan untuk menampilkan Kode
  // Bisnis. Formulirnya berada di dalam .login-screen (z-index 100), padahal
  // .modal semula z-index:50 -- jadi dialognya akan tampil di belakang layar
  // login dan pengguna tidak pernah melihat kode bisnisnya. Tes z-index di
  // atas yang membuktikan urutannya; tes ini memastikan dialog benar-benar
  // dibuka pada keadaan itu.
  const { w, errors } = await boot({ authed: false });
  await new Promise(r => setTimeout(r, 300));
  const screen = w.document.getElementById('loginScreen');
  assert.ok(screen, 'layar login harus tampil saat belum punya sesi');
  assert.notStrictEqual(screen.style.display, 'none', 'layar login harus terlihat, bukan disembunyikan');

  w.eval(`peringatan('Pendaftaran berhasil!\\n\\nKode Bisnis: WZ-12345\\nUsername: budi')`);
  await new Promise(r => setTimeout(r, 80));
  const modal = w.document.getElementById('modal');
  assert.ok(modal.classList.contains('open'), 'dialog harus terbuka juga saat di layar login');
  assert.match(modal.textContent, /WZ-12345/, 'isi peringatan harus terbaca');
  assert.doesNotMatch(modal.textContent, /https?:\/\//, 'dialog tidak boleh memuat alamat server');
  assert.deepStrictEqual(errors.filter(e => e.startsWith('ALERT BAWAAN')), [],
    'dialog bawaan tidak boleh terpakai: ' + JSON.stringify(errors));
  w.close(); openWindows.delete(w);
});
