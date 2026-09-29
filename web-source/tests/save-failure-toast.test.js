/* Toast "tersimpan" harus jujur: kalau server menolak, pengguna
   harus diberi tahu.

   Aksi sinkron di `index.html` (ubah state di memori lalu `save()`)
   menutup dialog dan langsung menampilkan toast sukses, padahal
   `save()` baru menulis ke server di latar belakang. Di HP tidak ada
   apa pun yang memperlihatkan keadaan aslinya, jadi Owner bisa
   mengira pengaturannya sudah aman padahal tidak pernah sampai ke
   server.

   Yang dikunci di sini:
   1. `saveReportThenToast()` menunda toast sampai `save()` menjawab,
      dan menampilkan pesan gagal beserta ALASAN dari `lastSaveError`.
   2. Enam aksi memakai helper ini: layanan (tambah & ubah),
      pengeluaran, pengaturan, pelanggan, dan absensi.
   3. Role karyawan dikecualikan. Mereka tidak memakai `app-state`, jadi
      `save()` selalu mengembalikan `false` untuk mereka -- kalau tidak
      dikecualikan, setiap absensi karyawan akan berbunyi "gagal".

   Jalankan: node --test tests/save-failure-toast.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const START = INDEX.indexOf('function saveReportThenToast(');
const END = INDEX.indexOf('/* ---------------------------------------------------------- status proses', START);
const BLOCK = INDEX.slice(START, END);

function boot(role = 'owner') {
  const toasts = [];
  const dom = new JSDOM('<!doctype html><html><body><div id="toast"></div></body></html>', {
    runScripts: 'dangerously'
  });
  const w = dom.window;
  w.toast = (message, silent) => { toasts.push({ message: String(message), silent: !!silent }); };
  w.currentUser = { id: 'U1', role, businessId: 'BIZ1' };
  w.lastSaveError = null;
  w.eval(BLOCK);
  return { w, toasts };
}
const settle = () => new Promise(r => setTimeout(r, 20));

// Badan fungsi utuh: sebagian aksi ini ditulis satu baris, sebagian
// sudah dipecah, jadi diambil dengan menghitung kurung kurawal.
function functionBody(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  assert.ok(at > 0, name + ' tidak ditemukan');
  const open = INDEX.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < INDEX.length; i++) {
    if (INDEX[i] === '{') depth++;
    else if (INDEX[i] === '}') {
      depth--;
      if (depth === 0) return INDEX.slice(at, i + 1);
    }
  }
  throw new Error('penutup fungsi ' + name + ' tidak ditemukan');
}

test('helper ada dan mengembalikan promise asli', async () => {
  assert.ok(START > 0 && END > START, 'helper tidak ditemukan di index.html');
  const { w, toasts } = boot();
  const p = Promise.resolve(true);
  const returned = w.saveReportThenToast(p, 'Tersimpan.', 'Belum tersimpan.');
  assert.equal(returned, p, 'helper harus mengembalikan promise aslinya');
  await settle();
  assert.deepEqual(toasts, [{ message: 'Tersimpan.', silent: false }]);
  w.close();
});

test('gagal simpan memunculkan pesan beserta alasannya', async () => {
  const { w, toasts } = boot();
  w.lastSaveError = { message: 'Langganan tidak aktif.' };
  w.saveReportThenToast(Promise.resolve(false), 'Layanan ditambahkan.', 'Layanan belum tersimpan.');
  await settle();
  assert.equal(toasts.length, 1, 'toast gagal tidak muncul');
  assert.match(toasts[0].message, /Layanan belum tersimpan/);
  assert.match(toasts[0].message, /Langganan tidak aktif/, 'alasannya ikut ditampilkan');
  assert.equal(toasts[0].silent, true, 'pesan kegagalan harus tanpa bunyi');
  w.close();
});

test('gagal tanpa alasan tetap memberi tahu', async () => {
  const { w, toasts } = boot();
  w.saveReportThenToast(Promise.resolve(false), 'Pengaturan disimpan.', 'Pengaturan belum tersimpan.');
  await settle();
  assert.match(toasts[0].message, /Coba lagi sebentar/);
  w.close();
});

test('save() yang melempar exception dilaporkan sebagai gagal', async () => {
  const { w, toasts } = boot();
  w.saveReportThenToast(Promise.reject(new Error('jaringan mati')), 'Absensi diperbarui.', 'Absensi belum tersimpan.');
  await settle();
  assert.match(toasts[0].message, /Absensi belum tersimpan/);
  assert.match(toasts[0].message, /jaringan mati/);
  w.close();
});

test('role karyawan tidak pernah diberi tahu gagal', async () => {
  const { w, toasts } = boot('employee');
  // save() selalu false untuk karyawan karena mereka tidak memakai app-state.
  w.saveReportThenToast(Promise.resolve(false), 'Absensi diperbarui.', 'Absensi belum tersimpan.');
  await settle();
  assert.deepEqual(toasts.map(t => t.message), ['Absensi diperbarui.'],
    'karyawan harus tetap melihat toast sukses');
  w.close();
});

test('save() yang tidak promise langsung menampilkan toast sukses', async () => {
  const { w, toasts } = boot();
  w.saveReportThenToast(true, 'Layanan ditambahkan.', 'Layanan belum tersimpan.');
  await settle();
  assert.deepEqual(toasts.map(t => t.message), ['Layanan ditambahkan.']);
  w.close();
});

test('aksinya benar-benar memakai helper, bukan toast langsung', () => {
  const cases = [
    ['saveService', 'Layanan ditambahkan.'],
    ['updateService', 'Layanan berhasil diperbarui.'],
    ['saveExpense', 'Pengeluaran tersimpan.'],
    ['saveSettings', 'Pengaturan disimpan.'],
    ['saveCustomer', 'Pelanggan ditambahkan.'],
    ['attendance', 'Absensi diperbarui.'],
  ];
  for (const [fn, message] of cases) {
    const body = functionBody(fn);
    assert.ok(body.includes('saveReportThenToast('), fn + ' tidak melaporkan hasil simpan');
    assert.ok(body.includes("'" + message + "'"), fn + ' kehilangan pesan suksesnya');
    // Toast langsung di dalam aksi adalah bug yang dikunci di sini.
    // Pengecualian: `saveCustomer` punya jalur khusus role karyawan yang
    // memang sudah `await` endpoint-nya sendiri, jadi toast di sana sah.
    const direct = new RegExp("toast\\('" + message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'\\)");
    const scope = fn === 'saveCustomer' ? body.slice(body.indexOf('db.customers.push(c)')) : body;
    assert.equal(direct.test(scope), false,
      fn + ' masih menampilkan toast sukses tanpa menunggu server');
  }
});

test('transaksi dan laporan shift tidak ikut memakai helper', () => {
  for (const fn of ['saveTransaction', 'saveShiftReport']) {
    const body = functionBody(fn);
    assert.equal(body.includes('saveReportThenToast('), false,
      fn + ' jalur sendiri sudah menunggu server, tidak boleh memakai helper app-state');
  }
});
