/* Menu geser harus menutup sendiri, seperti drawer di aplikasi biasa.

   Keluhan yang dikunci di sini: di HP, menu dibuka dari ikon garis tiga
   di pojok kiri atas, lalu **mengetuk di luar menu tidak menutupnya**.
   Menu itu tetap menempel di layar sampai ikon garis tiga ditekan lagi.

   Penyebabnya: `toggleMenu()` hanya membalik kelas `open` pada sidebar,
   dan `closeMobileMenu()` memang sudah ada tapi tidak pernah dipanggil
   dari mana pun. Tidak ada pula listener yang menutup menu dari luar.

   Perbaikan: penedup layar `.wz-scrim` di belakang sidebar, listener
   klik di fase capture (menutup menu tanpa membatalkan ketukan itu
   sendiri), tombol Escape, dan `go()` yang menutup menu setiap pindah
   halaman. Ketuk di dalam sidebar atau di tombol hamburger harus tetap
   membuka/menutup seperti sebelumnya.

   jsdom tidak menghitung layout dan tidak ada hit-testing, jadi
   kedudukan penedup diperiksa dari bentuk CSS-nya (z-index di antara
   sidebar dan modal), sementara perilakunya dijalankan sungguhan di
   jsdom pada fungsi yang sama dengan yang dipakai index.html.

   Jalankan: node --test tests/sidebar-outside-close.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('halaman punya penedup layar di belakang sidebar', () => {
  assert.match(INDEX, /<div class="wz-scrim" id="wzScrim"/, 'elemen #wzScrim tidak ada');
  const at = INDEX.indexOf('id="wzScrim"');
  const sidebarAt = INDEX.indexOf('id="sidebar"');
  assert.ok(sidebarAt >= 0 && sidebarAt < at, 'penedup harus dibaca setelah sidebar, bukan sebelumnya');
});

test('penedup tidak menutupi sidebar, modal, atau bottom nav', () => {
  const rule = INDEX.slice(INDEX.indexOf('.wz-scrim{'), INDEX.indexOf('}', INDEX.indexOf('.wz-scrim{')) + 1);
  const z = Number((rule.match(/z-index:(\d+)/) || [])[1]);
  assert.ok(Number.isFinite(z), 'z-index penedup tidak terbaca');
  // Sidebar 20 dan modal 300 harus tetap di atas penedup.
  assert.ok(z < 20, 'penedup tidak boleh menutupi sidebar');
  assert.ok(z < 300, 'penedup tidak boleh menutupi modal');
  // Konten utama juga harus tertutupi, supaya ketukan di luar terasa
  // seperti mengetuk di luar menu, bukan seperti mengetuk tombol.
  assert.ok(z > 10, 'penedup harus di atas topbar (10)');
  assert.match(INDEX, /\.wz-scrim\.on\{display:block\}/, 'penedup tidak pernah tampil');
  assert.match(INDEX, /\.wz-scrim\{[^}]*position:fixed/, 'penedup harus menutup seluruh layar');
});

test('hamburger melaporkan status terbuka lewat aria-expanded', () => {
  assert.match(INDEX, /class="hamb"[^>]*aria-expanded="false"/, 'aria-expanded awal tidak ada');
  assert.match(INDEX, /aria-controls="sidebar"/, 'aria-controls tidak menunjuk sidebar');
});

test('sidebarDismiss dipasang di fase capture', () => {
  assert.match(
    INDEX,
    /document\.addEventListener\('click',sidebarDismiss,true\)/,
    'listener klik penutup tidak terpasang (atau tidak di fase capture)'
  );
  // Menekan Escape harus menutup menu juga.
  assert.match(INDEX, /addEventListener\('keydown'[\s\S]{0,160}Escape[\s\S]{0,80}closeSidebar\(\)/);
  // Pindah halaman lewat go() menutup menu, bukan cuma andalkan ketukan luar.
  assert.match(INDEX, /function go\(key\)\{if\(!guard\(key\)\)return;closeSidebar\(\);/);
  // Fungsi lama harus tetap dipakai, bukan jadi kode mati.
  assert.ok(INDEX.includes('closeMobileMenu'), 'closeMobileMenu hilang');
});

// Jalankan fungsi yang sama dengan index.html pada DOM kecil.
function boot() {
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
    '<button class="hamb" aria-expanded="false" onclick="toggleMenu()"></button>' +
    '<aside id="sidebar"><button class="nav-item">Kasir</button></aside>' +
    '<div id="wzScrim"></div>' +
    '<div id="content">Isi halaman</div>' +
    '</body></html>',
    { runScripts: 'dangerously' }
  );
  const w = dom.window;
  const start = INDEX.indexOf('function sidebarIsOpen(){');
  const end = INDEX.indexOf("addEventListener('keydown'", start);
  w.eval(INDEX.slice(start, INDEX.indexOf('});', end) + 3));
  return w;
}

function open(w) {
  w.document.querySelector('.hamb').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
}

test('menu yang dibuka menutup saat diketuk di luar', () => {
  const w = boot();
  const sidebar = w.document.getElementById('sidebar');
  const scrim = w.document.getElementById('wzScrim');
  open(w);
  assert.ok(sidebar.classList.contains('open'), 'menu tidak terbuka setelah diketuk');
  assert.ok(scrim.classList.contains('on'), 'penedup tidak muncul saat menu terbuka');
  assert.equal(w.document.querySelector('.hamb').getAttribute('aria-expanded'), 'true');

  w.document.getElementById('content').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(sidebar.classList.contains('open'), false, 'menu tidak menutup setelah ketukan di luar');
  assert.equal(scrim.classList.contains('on'), false, 'penedup tidak hilang bersama menu');
  assert.equal(w.document.querySelector('.hamb').getAttribute('aria-expanded'), 'false');
  w.close();
});

test('menutup dari luar tidak membatalkan ketukan ke halaman', () => {
  const w = boot();
  let clicks = 0;
  w.document.getElementById('content').addEventListener('click', () => { clicks++; });
  open(w);
  const event = new w.MouseEvent('click', { bubbles: true, cancelable: true });
  w.document.getElementById('content').dispatchEvent(event);
  assert.equal(event.defaultPrevented, false, 'ketukan di luar tidak boleh dibatalkan');
  assert.equal(clicks, 1, 'halaman di bawah menu tidak menerima ketukan');
  w.close();
});

test('ketukan di dalam menu tidak menutupnya', () => {
  const w = boot();
  const sidebar = w.document.getElementById('sidebar');
  open(w);
  w.document.querySelector('.nav-item').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.ok(sidebar.classList.contains('open'), 'ketuk di dalam menu justru menutup menu');
  // Mengetuk hamburger lagi tetap menutup (perilaku lama).
  open(w);
  assert.equal(sidebar.classList.contains('open'), false, 'hamburger tidak bisa menutup menu');
  w.close();
});

test('Escape menutup menu yang terbuka', () => {
  const w = boot();
  const sidebar = w.document.getElementById('sidebar');
  open(w);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(sidebar.classList.contains('open'), false, 'Escape tidak menutup menu');
  w.close();
});

test('ketukan saat menu tertutup tidak membuat apa pun', () => {
  const w = boot();
  const scrim = w.document.getElementById('wzScrim');
  w.document.getElementById('content').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(scrim.classList.contains('on'), false, 'penedup muncul tanpa menu terbuka');
  w.close();
});
