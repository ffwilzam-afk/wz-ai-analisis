/* Warna nominal harus netral, terbaca, dan tidak sampai ke struk cetak.

   Permintaannya: beri warna pada nominal per kategori (omzet, laba,
   gaji, pengeluaran, dan lain-lain) dengan palet NETRAL -- hanya yang
   penting yang ditebalkan/diwarnai, sisanya tetap warna teks biasa.

   Yang dikunci di sini:
   1. Palet hanya punya lima peran (in, profit, out, bonus, neg). Nominal
      tanpa `tone` tetap teks biasa, jadi layar tidak dipenuhi warna.
   2. Tiap warna kontrasnya >= 4.5:1 terhadap panel dan latar paling
      gelap. Angka di HP kecil yang kontrasnya rendah tidak terbaca.
   3. Halaman yang paling penting sudah memakai peran yang benar:
      keuangan, laporan, operasional, analitik, dashboard, tutup shift,
      dan daftar gaji.
   4. **Struk cetak tetap hitam semua.** Printer thermal 1-bit tidak bisa
      mencetak warna. `renderTransactionReceipt()` tidak boleh memakai
      kelas warna, dan ada jaring pengaman CSS yang memaksa hitam di
      dalam `#wzReceipt` kalau ada kelas itu bocor ke sana.

   Jalankan: node --test tests/amount-colors.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const PALETTE = INDEX.slice(
  INDEX.indexOf('<style id="amount-colors">'),
  INDEX.indexOf('</style>', INDEX.indexOf('<style id="amount-colors">'))
);

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
  throw new Error('penutup ' + name + ' tidak ditemukan');
}

// Rasio kontras WCAG, dipakai sebagai pagar pengaman angka yang
// sulit dibaca di layar HP.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('palet hanya punya lima peran, tidak ada warna liar', () => {
  const declared = [...PALETTE.matchAll(/--wz-([a-z]+):(#[0-9a-fA-F]{6})/g)].map(m => m[1]);
  assert.deepEqual(declared.sort(), ['bonus', 'in', 'neg', 'out', 'profit'],
    'peran warna berubah; palet harus tetap lima');
  for (const tone of ['in', 'profit', 'out', 'bonus', 'neg', 'net']) {
    assert.match(PALETTE, new RegExp('\\.money-' + tone + '\\{'), 'kelas .money-' + tone + ' tidak ada');
  }
});

test('setiap warna cukup kontras di panel gelap dan di latar halaman', () => {
  const backgrounds = { panel: '#0e1115', panel2: '#12161c', page: '#060709' };
  for (const [, , hex] of PALETTE.matchAll(/--wz-([a-z]+):(#[0-9a-fA-F]{6})/g)) {
    for (const [name, bg] of Object.entries(backgrounds)) {
      const ratio = contrast(hex, bg);
      assert.ok(ratio >= 4.5, hex + ' di ' + name + ' hanya ' + ratio.toFixed(2) + ':1');
    }
  }
});

test('kelas lama halaman karyawan memakai palet yang sama', () => {
  for (const legacy of ['payroll-revenue', 'payroll-wage', 'payroll-bonus']) {
    assert.match(PALETTE, new RegExp('\\.' + legacy + '\\{color:var\\(--wz-'),
      legacy + ' tidak lagi mengikuti palet baru');
  }
});

test('money() hanya mewarnai kalau perannya diminta', () => {
  const at = INDEX.indexOf('function money(value,tone){');
  const end = INDEX.indexOf('\n}', at) + 2;
  const rupiahAt = INDEX.indexOf('function rupiah(value){');
  const source = INDEX.slice(rupiahAt, end);
  const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'dangerously' }).window;
  w.eval(source);
  assert.equal(w.money(1500), 'Rp 1.500', 'tanpa tone harus sama dengan rupiah()');
  assert.equal(w.money(1500, 'in'), '<span class="money-in">Rp 1.500</span>');
  assert.equal(w.money(1500, 'profit'), '<span class="money-profit">Rp 1.500</span>');
  assert.equal(w.money(1500, 'out'), '<span class="money-out">Rp 1.500</span>');
  assert.equal(w.money(1500, 'bonus'), '<span class="money-bonus">Rp 1.500</span>');
  // Minus merah, positif tebal tanpa warna.
  assert.equal(w.money(-2000, 'neg'), '<span class="money-neg">Rp -2.000</span>');
  assert.equal(w.money(0, 'neg'), '<span class="money-net">Rp 0</span>');
  assert.equal(w.money(2000, 'neg'), '<span class="money-net">Rp 2.000</span>');
  w.close();
});

test('halaman utama memakai peran warna yang tepat', () => {
  const cases = [
    // KPI, insight, dan daftar memakai money() karena nilainya masuk
    // mentah ke HTML.
    ['finance', "money(revenue(),'in')", "money(expenses(),'out')", "money(profit(),'profit')"],
    ['dashboard', "money(todayRev,'in')", "money(todayRev-todayExp,'profit')", "money(rev,'in')"],
    ['shiftReports', "money(r.totalPayment||0,'in')", "money(r.cashDifference||0,'neg')"],
    ['payrollEmployeeListHtml', "money(pay?.baseSalary||0,'out')"],
    // box() dan boxCard() me-escape nilainya, jadi warnanya lewat
    // parameter tone, BUKAN lewat money() -- kalau tidak, tag <span>
    //-nya tampil sebagai teks.
    ['reports', "box('Omzet',u.omzet,'in')"],
    ['operations', "box('Omzet',omzet,'in')"],
    ['analytics', "boxCard('Pendapatan',revenueValue,'in')", "boxCard('Pengeluaran',expenseValue,'out')",
      "boxCard('Laba Bersih',revenueValue-expenseValue,'profit')"],
  ];
  for (const [fn, ...tones] of cases) {
    const body = functionBody(fn);
    for (const tone of tones) {
      assert.ok(body.includes(tone), fn + ' belum memakai ' + tone);
    }
  }
});

test('box() tetap meng-escape nilainya dan mewarnakan lewat kelas', () => {
  const boxBody = functionBody('box');
  assert.match(boxBody, /escapeHtml\(String\(b/, 'nilai box harus tetap di-escape');
  assert.match(boxBody, /class="money-\$\{tone\}"/, 'box tidak memasang kelas warna dari tone');
  const cardBody = functionBody('boxCard');
  assert.match(cardBody, /money-'\+tone/, 'boxCard tidak memasang kelas warna dari tone');
  // Tidak boleh ada money() di dalam argumen box/boxCard: nilainya
  // di-escape, jadi HTML-nya akan tampil mentah sebagai teks.
  for (const fn of ['reports', 'operations', 'analytics', 'dashboard']) {
    const body = functionBody(fn);
    assert.equal(/box(Card)?\([^)]*money\(/.test(body), false,
      fn + ' mengirim HTML ke box()/boxCard() yang meng-escape nilainya');
  }
});

test('gaji dan bonus di kartu karyawan tetap memakai peran biaya dan bonus', () => {
  const body = INDEX.slice(INDEX.indexOf('function employees()'), INDEX.indexOf('async function deleteEmployee('));
  assert.match(body, /class="payroll-revenue"/, 'omzet karyawan tidak diberi peran pemasukan');
  assert.match(body, /class="payroll-wage"/, 'upah karyawan tidak diberi peran biaya');
  assert.match(body, /class="payroll-bonus"/, 'bonus karyawan tidak diberi peran bonus');
});

test('struk cetak tidak memakai kelas warna sama sekali', () => {
  const receipt = functionBody('renderTransactionReceipt');
  assert.equal(/money\(/.test(receipt), false, 'struk memakai money() dan akan tercetak berwarna');
  assert.equal(/class="money-/.test(receipt), false, 'struk memakai kelas warna');
  assert.equal(/payroll-(revenue|wage|bonus)/.test(receipt), false, 'struk memakai kelas warna lama');
  // Jaring pengaman: kalau suatu saat kelas warna bocor ke struk,
  // CSS tetap memaksa hitam supaya printer thermal tidak mengacaukan nota.
  assert.match(PALETTE, /#wzReceipt \.money-in/, 'jaring pengaman di #wzReceipt hilang');
  assert.match(PALETTE, /\{color:#000!important\}/, 'warna di struk tidak dipaksa hitam');
});

test('nota yang benar-benar dirender tetap tanpa warna', async () => {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(String(e.message || e)));
  const dom = new JSDOM(INDEX, {
    runScripts: 'dangerously',
    url: 'https://wz.test/#dashboard',
    virtualConsole: vc,
    beforeParse(w) {
      w.structuredClone = structuredClone;
      w.alert = () => { };
      w.confirm = () => true;
      w.print = () => { };
      w.fetch = async () => ({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) });
    }
  });
  const w = dom.window;
  try {
    for (let i = 0; i < 200 && typeof w.saveTransaction !== 'function'; i++) {
      await new Promise(r => setTimeout(r, 25));
    }
    assert.equal(typeof w.saveTransaction, 'function', 'halaman tidak termuat');
    w.currentUser = { id: 'U1', username: 'u', role: 'owner', name: 'Pemilik', businessId: 'BIZ1', branchId: 'B1' };
    w.eval(`
      db.services=[{id:'S001',name:'Haircut',price:60000,active:true,payrollCategory:''}];
      db.employees=[{id:'E001',name:'Budi',role:'Barber',branchId:'B1',active:true}];
      db.customers=[{id:'C001',name:'Andi',visits:0,total:0}];
      db.branches=[{id:'B1',name:'Pusat',active:true}];
      db.profile={name:'Pemilik',brand:'WZ BARBERSHOP PRO'};
      db.transactions=[];db.shiftReports=[];
    `);
    // Buka form POS lalu isi seperlunya: struk dirender oleh saveTransaction().
    w.openTransaction();
    await new Promise(r => setTimeout(r, 60));
    w.document.getElementById('fCustomer').value = 'C001';
    w.document.getElementById('fService').value = 'S001';
    w.document.getElementById('fEmployee').value = 'E001';
    w.document.getElementById('fDiscount').value = '10000';
    await w.saveTransaction();
    await new Promise(r => setTimeout(r, 60));

    const receipt = w.document.getElementById('wzReceipt');
    assert.ok(receipt, 'struk tidak pernah dirender');
    assert.equal(
      receipt.querySelectorAll('.money-in,.money-profit,.money-out,.money-bonus,.money-neg,.money-net').length,
      0,
      'ada kelas warna di dalam struk'
    );
    assert.match(receipt.textContent, /Rp 50\.000/, 'total struk tidak benar');
    assert.deepEqual(errors, [], 'halaman error saat merender struk');
  } finally {
    // WINDOW harus selalu ditutup: kalau tidak, timer auto-refresh
    // menahan proses tes tanpa henti.
    w.close();
  }
});
