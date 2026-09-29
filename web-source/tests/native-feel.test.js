/* Tekan-tahan pada teks tidak boleh menyeleksi seperti situs.

   Aplikasi Android dibuka lewat WebView, jadi tanpa aturan tambahan
   semua teks di layar bisa disorot, disalin, dan muncul menu konteks --
   itulah yang membuat aplikasi terasa seperti website, bukan aplikasi.

   Yang dikunci di sini:
   1. `user-select:none` dipasang pada container aplikasi (splash, layar
      login, app, bottom nav, modal, toast). Sifatnya diwarisi, jadi
      semua teks turunan ikut tidak bisa diseleksi.
   2. Kolom isian dikembalikan ke `user-select:text` supaya tetap bisa
      diedit dan disalin.
   3. Penjaga `contextmenu`, `dragstart`, dan `selectstart` memblokir aksi
      tersebut di luar kolom isian. WebView Android masih menyorot teks
      walau `user-select` sudah `none`, jadi penjaga ini wajib ada.

   Jalankan: node --test tests/native-feel.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

//<head> memuat beberapa blok <style>; aturan native feel ada di blok
//_style utama_, jadi stylesheet diambil dari blok itu saja.
const STYLE_END = INDEX.indexOf('</style>', INDEX.indexOf('NATIVE FEEL'));
const STYLE = INDEX.slice(INDEX.indexOf('<style>'), STYLE_END + 8);
assert.ok(STYLE_END > INDEX.indexOf('<style>'), 'blok style utama tidak ditemukan');

// Aturan global untuk container aplikasi.
function ruleFor(selector) {
  const at = STYLE.indexOf(selector + '{');
  assert.ok(at >= 0, 'aturan untuk ' + selector + ' tidak ada di stylesheet');
  return STYLE.slice(at, STYLE.indexOf('}', at) + 1);
}

test('container aplikasi tidak bisa diseleksi', () => {
  for (const selector of [
    'html,body,#wzStartupLoading,.login-screen,#mainApp,.wz-bottom-nav,.modal,.toast',
  ]) {
    const rule = ruleFor(selector);
    assert.match(rule, /user-select\s*:\s*none/);
    assert.match(rule, /-webkit-user-select\s*:\s*none/);
    assert.match(rule, /-webkit-touch-callout\s*:\s*none/);
  }
});

test('kolom isian tetap bisa diedit dan disalin', () => {
  const rule = ruleFor(
    'input,textarea,select,option,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"],.wz-copyable'
  );
  assert.match(rule, /user-select\s*:\s*text/);
  assert.match(rule, /-webkit-user-select\s*:\s*text/);
  // Aturan "text" harus muncul setelah aturan "none" supaya yang menang.
  assert.ok(
    STYLE.indexOf(rule) > STYLE.indexOf('user-select:none'),
    'aturan user-select:text harus ditulis setelah user-select:none'
  );
});

test('penjaga contextmenu, dragstart, dan selectstart terpasang', () => {
  const guard = INDEX.slice(
    INDEX.indexOf('/* NATIVE FEEL: tekan-tahan pada teks biasa'),
    INDEX.indexOf('})();', INDEX.indexOf('/* NATIVE FEEL: tekan-tahan pada teks biasa')) + 5
  );
  assert.ok(guard.length > 0, 'blok penjaga tidak ditemukan di index.html');
  for (const type of ['contextmenu', 'dragstart', 'selectstart']) {
    assert.ok(guard.includes("'" + type + "'"), 'penjaga ' + type + ' tidak ada');
  }
  assert.match(guard, /event\.preventDefault\(\)/);
  // Kolom isian dikecualikan dari pemblokiran.
  assert.match(guard, /input,textarea,select/);
});

// Uji perilaku: skrip penjaga yang sama dijalankan di jsdom, lalu tiga
// event itu ditembakkan ke teks biasa dan ke kolom isian.
test('teks biasa diblokir, kolom isian tidak', () => {
  const start = INDEX.indexOf('/* NATIVE FEEL: tekan-tahan pada teks biasa');
  const script = INDEX.slice(start, INDEX.indexOf('</script>', start));
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="plain">Total Rp 50.000</div>' +
    '<textarea id="note">catatan</textarea><input id="user"><div class="wz-copyable" id="copy">Boleh salin</div></body></html>',
    { runScripts: 'dangerously' }
  );
  dom.window.eval(script);
  const w = dom.window;

  function fire(target, type) {
    const event = new w.MouseEvent(type, { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }

  const plain = w.document.getElementById('plain');
  for (const type of ['contextmenu', 'dragstart', 'selectstart']) {
    assert.equal(fire(plain, type), true, type + ' harus diblokir pada teks biasa');
    assert.equal(fire(w.document.getElementById('note'), type), false, type + ' harus lolos pada textarea');
    assert.equal(fire(w.document.getElementById('user'), type), false, type + ' harus lolos pada input');
    assert.equal(fire(w.document.getElementById('copy'), type), false, type + ' harus lolos pada .wz-copyable');
  }
  w.close();
});
