/* Warna nominal mengikuti aturan warna yang ditetapkan Owner:
     1. Omzet       -> HIJAU
     2. Laba        -> BIRU
     3. Pengeluaran -> MERAH
     4. Pelanggan   -> KUNING
   Pilihannya warna yang biasa dikenal, bukan nuansa redup, supaya
   "merah itu merah" dan "biru itu biru" tanpa perlu menebak.
   Sisanya tetap warna teks biasa, dan struk cetak tetap hitam semua
   karena printer thermal 1-bit tidak bisa mencetak warna.

   Yang dikunci di sini:
   1. Tepat empat peran warna, tidak boleh ada warna liar yang masuk.
   2. Kontras WCAG minimal 4.5:1 tiap warna terhadap tiga latar gelap.
   3. moneyTone() memetakan label ke peran dengan urutan benar:
      "Laba Bersih" harus biru, bukan hijau omzet.
   4. Warna dari label HANYA berlaku untuk nilai angka. Nama pelanggan
      dan tanggal tidak boleh ikut berwarna -- inilah jebakan yang
      membuat box('Pelanggan','Andi') salah warna.
   5. Grafik omzet hijau dan grafik laba biru, jadi grafik tidak
      melawan aturan nominal yang sama.
   6. Struk cetak bebas kelas warna, dicek dari sumber DAN dari nota
      yang benar-benar dirender.

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

function color(name) {
  const found = PALETTE.match(new RegExp('--wz-' + name + ':(#[0-9a-fA-F]{6})'));
  assert.ok(found, 'variabel --wz-' + name + ' tidak ada');
  return found[1];
}
function rgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

// Menyiapkan jendela jsdom berisi seluruh helper nominal: palet, money(),
// pemetaan label, pemisah ribuan, serta box()/boxCard(). Semua helper
// warna tinggal satu blok di index.html, jadi cukup dipotong sekali.
function moneyWindow() {
  const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'dangerously' }).window;
  w.escapeHtml = v => String(v);
  w.eval(INDEX.slice(INDEX.indexOf('function rupiah(value){'), INDEX.indexOf('const MONEY_TONE_RULES=')));
  w.eval(INDEX.slice(INDEX.indexOf('const MONEY_TONE_RULES='), INDEX.indexOf('function branchOfEmployee(')));
  w.eval(functionBody('box') + '\n' + functionBody('boxCard'));
  return w;
}

test('palet tepat empat aturan Owner, tidak ada warna liar', () => {
  const declared = [...PALETTE.matchAll(/--wz-([a-z]+):(#[0-9a-fA-F]{6})/g)].map(m => m[1]);
  assert.deepEqual(declared.sort(), ['cust', 'in', 'neg', 'out', 'profit']);
  // Peran "bonus" dihapus: bonus adalah bagian gaji, jadi warna biaya.
  assert.doesNotMatch(PALETTE, /--wz-bonus|\.money-bonus\{/, 'peran bonus masih ada');

  const [ri, gi, bi] = rgb(color('in'));
  const [rp, gp, bp] = rgb(color('profit'));
  const [ro, go, bo] = rgb(color('out'));
  const [rc, gc, bc] = rgb(color('cust'));
  // Hijau: hijau jelas domina.
  assert.ok(gi > ri + 40 && gi > bi + 40, 'omzet harus hijau');
  // Biru: biru jelas domina.
  assert.ok(bp > rp + 40 && bp > gp + 20, 'laba harus biru');
  // Merah: merah dominan, hijau dan biru jauh lebih rendah.
  assert.ok(ro > go + 80 && ro > bo + 80, 'pengeluaran harus merah');
  // Kuning: merah dan hijau sama-sama tinggi, biru rendah.
  assert.ok(rc > 200 && gc > 140 && rc - bc > 110, 'pelanggan harus kuning');
  // Kuning tidak boleh kemerahan (oranye) atau kehijauan (hijau limau).
  assert.ok(Math.abs(rc - gc) < 60, 'kuning terlalucondong ke merah atau hijau');

  for (const tone of ['in', 'profit', 'out', 'cust', 'neg', 'net']) {
    assert.match(PALETTE, new RegExp('\\.money-' + tone + '\\{'), 'kelas .money-' + tone + ' tidak ada');
  }
});

test('keempat warna benar-benar berbeda satu sama lain', () => {
  const distinct = new Set(['in', 'profit', 'out', 'cust'].map(color));
  assert.equal(distinct.size, 4, 'dua peran memakai warna yang sama');
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
  // Upah dan bonus adalah komponen gaji, jadi keduanya biaya (merah).
  const wage = (PALETTE.match(/\.payroll-wage\{color:var\(--wz-([a-z]+)/) || [])[1];
  const bonus = (PALETTE.match(/\.payroll-bonus\{color:var\(--wz-([a-z]+)/) || [])[1];
  assert.equal(wage, 'out', 'upah harus warna biaya');
  assert.equal(bonus, 'out', 'bonus harus warna biaya');
});

test('warna label dipetakan ke aturan Owner dengan urutan benar', () => {
  const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'dangerously' }).window;
  w.eval(INDEX.slice(INDEX.indexOf('const MONEY_TONE_RULES='), INDEX.indexOf('function isAmountLike(')));
  assert.equal(w.moneyTone('Omzet'), 'in');
  assert.equal(w.moneyTone('Total Pendapatan'), 'in');
  assert.equal(w.moneyTone('Laba'), 'profit');
  // "Laba Bersih" tidak boleh tertangkap aturan hijau omzet.
  assert.equal(w.moneyTone('Laba Bersih'), 'profit');
  assert.equal(w.moneyTone('Pengeluaran'), 'out');
  assert.equal(w.moneyTone('Gaji Pokok'), 'out');
  assert.equal(w.moneyTone('Total Upah'), 'out');
  assert.equal(w.moneyTone('Pelanggan'), 'cust');
  assert.equal(w.moneyTone('Kunjungan'), 'cust');
  // Yang tidak diatur tetap netral.
  assert.equal(w.moneyTone('Margin'), '');
  assert.equal(w.moneyTone('Kas Awal'), '');
  assert.equal(w.moneyTone('Periode'), '');
  w.close();
});

test('warna dari label hanya untuk angka, nama tidak ikut', () => {
  const w = moneyWindow();
  // Nilai angka tetap ikut warna.
  assert.equal(w.moneyToneFor('Omzet', 'Rp 1.500.000'), 'in');
  assert.equal(w.moneyToneFor('Pelanggan', 12), 'cust');
  assert.equal(w.moneyToneFor('Laba', 'Rp 0'), 'profit');
  assert.equal(w.moneyToneFor('Kunjungan', '7'), 'cust');
  // Nama, tanggal, dan kalimat TIDAK boleh berwarna.
  assert.equal(w.moneyToneFor('Pelanggan', 'Andi'), '', 'nama pelanggan ikut berwarna');
  assert.equal(w.moneyToneFor('Tanggal', '2026-09-29'), '', 'tanggal ikut berwarna');
  assert.equal(w.moneyToneFor('Layanan', 'Haircut'), '', 'nama layanan ikut berwarna');
  assert.equal(w.moneyToneFor('Periode', '2026-09-01 -> 2026-09-30'), '', 'periode ikut berwarna');
  // Dan kotak ringkasan ikut aturan yang sama.
  assert.match(w.box('Pelanggan', 'Andi'), /<strong>Andi<\/strong>/, 'kotak pelanggan mewarnai nama');
  assert.match(w.box('Omzet', 'Rp 2.000.000'), /class="money-in"/, 'kotak omzet tidak hijau');
  assert.match(w.box('Total Laba', 'Rp 900.000'), /class="money-profit"/, 'kotak laba tidak biru');
  assert.match(w.box('Pengeluaran', 'Rp 1.100.000'), /class="money-out"/, 'kotak pengeluaran tidak merah');
  // Selisih kasir: merah hanya kalau benar-benar minus.
  assert.match(w.box('Selisih Kasir', 'Rp -2.000', 'neg'), /class="money-neg"/);
  assert.match(w.box('Selisih Kasir', 'Rp 0', 'neg'), /class="money-net"/, 'selisih nol ikut merah');
  w.close();
});

test('nilai berformat rupiah tetap bisa dibaca tandanya', () => {
  // Nilai dari box() sudah berupa "Rp -2.000". Kalau hanya Number() yang
  // dipakai, hasilnya NaN sehingga minus tidak pernah jadi merah.
  const w = moneyWindow();
  assert.equal(w.moneyNumber('Rp -2.000'), -2000);
  assert.equal(w.moneyNumber(-2000), -2000);
  assert.equal(w.moneyNumber('Rp 0'), 0);
  assert.equal(w.moneyNumber('Rp 1.500.000'), 1500000);
  assert.equal(w.moneyNumber(''), 0, 'nilai kosong harus jadi nol, bukan NaN');
  // Dan kelasnya: minus merah, nol dan positif tebal tanpa warna.
  assert.match(w.box('Selisih', 'Rp -2.000', 'neg'), /class="money-neg"/, 'minus tidak merah');
  assert.match(w.box('Selisih', 'Rp 0', 'neg'), /class="money-net"/, 'nol ikut merah');
  assert.match(w.box('Selisih', 'Rp 2.000', 'neg'), /class="money-net"/, 'positif ikut merah');
  w.close();
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
  assert.equal(w.money(1500, 'cust'), '<span class="money-cust">Rp 1.500</span>');
  // Minus merah, positif tebal tanpa warna.
  assert.equal(w.money(-2000, 'neg'), '<span class="money-neg">Rp -2.000</span>');
  assert.equal(w.money(0, 'neg'), '<span class="money-net">Rp 0</span>');
  assert.equal(w.money(2000, 'neg'), '<span class="money-net">Rp 2.000</span>');
  w.close();
});

test('semua halaman memakai peran warna yang tepat', () => {
  const cases = [
    // Nilai yang masuk mentah ke HTML lewat money(), bukan lewat box().
    ['dashboard', "money(todayRev,'in')", "money(todayRev-todayExp,'profit')", 'money-cust"'],
    ['shiftReports', "money(r.totalPayment||0,'in')", "money(r.totalOmzet||0,'in')",
      "money(r.cashDifference||0,'neg')", 'class="money-cust"'],
    ['finance', "money(revenue(),'in')", "money(expenses(),'out')", "money(profit(),'profit')",
      "money(e.amount,'out')"],
    ['analyticsDetail', "money(row.total,'in')", "money(row.totalOmzet,'in')", "money(row.amount,'out')"],
    ['analyticsMetricBoxes', "money(metric.omzet,'in')", "money(metric.pengeluaran,'out')",
      "money(metric.laba,'profit')", "money(metric.pelanggan,'cust')"],
    ['payrollEmployeeListHtml', "money(pay?.baseSalary||0,'out')"],
    ['txTable', "money(t.total,'in')"],
    ['txRow', "money(t.total,'in')"],
    // box() dan boxCard() me-escape nilainya, jadi warnanya lewat
    // parameter tone, BUKAN lewat money() -- kalau tidak, tag <span>
    //-nya tampil sebagai teks mentah.
    ['reports', "box('Omzet',u.omzet,'in')", "box('Pelanggan',u.pelanggan,'cust')"],
    ['operations', "box('Omzet',omzet,'in')", "box('Pelanggan',customers,'cust')"],
    ['payrollSummaryHtml', "box('Gaji Pokok',rupiah(pay.baseSalary),'out')",
      "box('Total Upah',rupiah(pay.totalPay),'out')"],
    ['customerDetail', "box('Kunjungan',c?.visits||0,'cust')", "box('Total Nilai',rupiah(c?.total),'in')"],
    ['shiftReportDetail', "box('Total Pembayaran',rupiah(r.totalPayment||0),'in')",
      "box('Pengeluaran Kas',rupiah(r.cashExpense||0),'out')",
      "box('Selisih Kasir',rupiah(r.cashDifference||0),'neg')"],
  ];
  for (const [fn, ...tones] of cases) {
    const body = functionBody(fn);
    for (const tone of tones) {
      assert.ok(body.includes(tone), fn + ' belum memakai ' + tone);
    }
  }
});

test('grafik omzet hijau, laba biru, pengeluaran merah', () => {
  // Class chart yang dipakai: green untuk omzet, blue untuk laba.
  const charts = [...INDEX.matchAll(/ownerLineChart\('([a-z]+)',[a-zA-Z]+,'([a-z]+)'/g)]
    .map(m => [m[1], m[2]]);
  assert.ok(charts.length >= 6, 'grafik garis tidak ditemukan');
  for (const [type, cls] of charts) {
    if (type === 'revenue' || type === 'expense' || type === 'profit') {
      const expected = { revenue: 'green', expense: 'red', profit: 'blue' }[type];
      assert.equal(cls, expected, 'grafik ' + type + ' harus memakai kelas ' + expected);
    }
  }
  // Warna nyata di CSS harus cocok dengan aturan, bukan hanya nama class.
  // Warna nyata di CSS harus memakai variabel palet yang sama, bukan
  // hex yang diketik terpisah -- kalau tidak, aturan bisa menyimpang.
  assert.match(INDEX, /\.line-green\{fill:none;stroke:var\(--wz-in\)/, 'garis omzet bukan hijau');
  assert.match(INDEX, /\.line-blue\{fill:none;stroke:var\(--wz-profit\)/, 'garis laba bukan biru');
  assert.match(INDEX, /\.line-red\{fill:none;stroke:var\(--wz-out\)/, 'garis pengeluaran bukan merah');
  assert.match(INDEX, /\.point-green\{fill:var\(--wz-in\)/, 'titik omzet bukan hijau');
  assert.match(INDEX, /\.point-blue\{fill:var\(--wz-profit\)/, 'titik laba bukan biru');
  // Keterangan kecil di bawah judul grafik ikut truthfully swapped.
  assert.match(INDEX, /GRAFIK OMZET<\/h3>.{0,260}?· hijau<\/span>/s, 'keterangan grafik omzet salah');
  assert.match(INDEX, /GRAFIK LABA<\/h3>.{0,260}?· biru<\/span>/s, 'keterangan grafik laba salah');
});

test('box() dan boxCard() mewarnakan lewat kelas, bukan lewat HTML', () => {
  const boxBody = functionBody('box');
  // Nilainya sudah boleh diubah formatnya (pemisah ribuan), tapi tetap
  // harus di-escape: warna masuk lewat kelas, bukan lewat HTML.
  assert.match(boxBody, /escapeHtml\(String\(value/, 'nilai box harus tetap di-escape');
  // Peran efektif dihitung sekali lalu dipakai untuk format DAN warna,
  // supaya warna dan angka tidak pernah berbeda.
  for (const [fn, body] of [['box', boxBody], ['boxCard', functionBody('boxCard')]]) {
    assert.match(body, /moneyToneFor\(a,b\)/, fn + ' tidak memakai peran dari label');
    assert.match(body, /formatAmount\(b,role\)/, fn + ' tidak memformat nilainya');
    assert.match(body, /moneyToneClass\(b,role\)/, fn + ' tidak memasang kelas warna dari tone');
  }
  // Tidak boleh ada money() di dalam argumen box/boxCard: nilainya
  // di-escape, jadi HTML-nya akan tampil mentah sebagai teks.
  for (const fn of ['reports', 'operations', 'analytics', 'dashboard', 'shiftReportDetail']) {
    const body = functionBody(fn);
    assert.equal(/box(Card)?\([^)]*money\(/.test(body), false,
      fn + ' mengirim HTML ke box()/boxCard() yang meng-escape nilainya');
  }
});

test('gaji dan bonus di kartu karyawan tetap memakai peran biaya', () => {
  const body = INDEX.slice(INDEX.indexOf('function employees()'), INDEX.indexOf('async function deleteEmployee('));
  assert.match(body, /class="payroll-revenue"/, 'omzet karyawan tidak memakai peran pemasukan');
  assert.match(body, /class="payroll-wage"/, 'upah karyawan tidak memakai peran biaya');
  assert.match(body, /class="payroll-bonus"/, 'bonus karyawan tidak memakai peran biaya');
});

test('diagram bulat rekap statistik memakai palet yang sama dengan legenda', () => {
  // Iris dan legenda harus dibaca dari variabel yang sama. Kalau warna
  // diketik terpisah, satu bisa berubah dan yang lain tidak.
  const donut = functionBody('analyticsDonut');
  assert.match(donut, /colors=\['var\(--wz-cust\)','var\(--wz-in\)','var\(--wz-out\)','var\(--wz-profit\)'\]/,
    'diagram bulat tidak memakai variabel palet');
  assert.doesNotMatch(donut, /#[0-9a-fA-F]{6}/, 'diagram bulat masih memakai hex yang diketik manual');
  // Urutannya harus sama dengan nilai yang dihitung: pelanggan, omzet,
  // pengeluaran, laba -- sesuai urutan legenda.
  assert.match(donut, /Math\.max\(0,metric\.pelanggan\).*Math\.abs\(metric\.omzet\).*Math\.abs\(metric\.pengeluaran\).*Math\.abs\(metric\.laba\)/,
    'urutan nilai iris tidak sesuai legenda');
  // Legenda di sebelahnya juga variabel, untuk peran yang sama.
  const legend = functionBody('analyticsMetricBoxes');
  for (const [tone, hex] of [['cust', 'eab308'], ['in', '22c55e'], ['out', 'ef4444'], ['profit', '3b82f6']]) {
    assert.match(legend, new RegExp('background:var\\(--wz-' + tone + '\\)'),
      'legenda ' + tone + ' tidak memakai variabel palet');
    assert.equal(color(tone), '#' + hex, 'var(--wz-' + tone + ') tidak lagi warna yang ditentukan');
  }
});

test('nominal uang diberi pemisah ribuan, jumlah tetap polos', () => {
  // Angka mentah (1500000) dulu tampil tanpa pemisah ribuan, jadi sulit
  // dibaca di layar HP. Kotak ringkasan sekarang memformat sendiri.
  const w = moneyWindow();
  // Nominal uang: dapat pemisah ribuan.
  assert.equal(w.formatAmount(1500000, 'in'), 'Rp 1.500.000');
  assert.equal(w.formatAmount(45000000, 'profit'), 'Rp 45.000.000');
  assert.equal(w.formatAmount(300000, 'out'), 'Rp 300.000');
  assert.equal(w.formatAmount(0, 'in'), 'Rp 0');
  // Jumlah (transaksi, pelanggan, karyawan) bukan nominal: tetap polos.
  assert.equal(w.formatAmount(30, 'cust'), 30);
  assert.equal(w.formatAmount(4, 'cust'), 4);
  assert.equal(w.formatAmount(12, ''), 12);
  // Nilai yang sudah berformat tidak boleh diformat dua kali.
  assert.equal(w.formatAmount('Rp 5.000', 'in'), 'Rp 5.000');
  // Tidak boleh jadi "Rp NaN" kalau angkanya rusak.
  assert.equal(w.formatAmount(NaN, 'in'), NaN);
  // Dan kotak ringkasan benar-benar memakainya.
  assert.match(w.box('Total Pendapatan', 45000000, 'in'), /Rp 45\.000\.000/, 'kotak tidak diformat');
  assert.match(w.box('Total Pelanggan', 30), />30</, 'jumlah pelanggan ikut jadi rupiah');
  assert.match(w.boxCard('Laba Bersih', 44700000, 'profit'), /Rp 44\.700\.000/, 'kartu tidak diformat');
  w.close();
});

test('struk cetak tidak memakai kelas warna sama sekali', () => {
  const receipt = functionBody('renderTransactionReceipt');
  assert.equal(/money\(/.test(receipt), false, 'struk memakai money() dan akan tercetak berwarna');
  assert.equal(/class="money-/.test(receipt), false, 'struk memakai kelas warna');
  assert.equal(/payroll-(revenue|wage|bonus)/.test(receipt), false, 'struk memakai kelas warna lama');
  // Jaring pengaman: kalau suatu saat kelas warna bocor ke struk,
  // CSS tetap memaksa hitam supaya printer thermal tidak mengacaukan nota.
  assert.match(PALETTE, /#wzReceipt \.money-in/, 'jaring pengaman di #wzReceipt hilang');
  assert.match(PALETTE, /#wzReceipt \.money-cust/, 'kelas kuning tidak dikunci hitam di struk');
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
      receipt.querySelectorAll('.money-in,.money-profit,.money-out,.money-cust,.money-neg,.money-net').length,
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

test('halaman yang dirender nyata memakai kelas warna sesuai aturan', async () => {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(String(e.message || e)));
  const dom = new JSDOM(INDEX, {
    runScripts: 'dangerously',
    url: 'https://wz.test/#finance',
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
    for (let i = 0; i < 200 && typeof w.finance !== 'function'; i++) {
      await new Promise(r => setTimeout(r, 25));
    }
    assert.equal(typeof w.finance, 'function', 'halaman tidak termuat');
    w.currentUser = { id: 'U1', username: 'u', role: 'owner', name: 'Pemilik', businessId: 'BIZ1', branchId: 'B1' };
    w.eval(`
      db.services=[{id:'S001',name:'Haircut',price:60000,active:true,payrollCategory:''}];
      db.employees=[{id:'E001',name:'Budi',role:'Barber',branchId:'B1',active:true}];
      db.customers=[{id:'C001',name:'Andi',visits:3,total:150000}];
      db.branches=[{id:'B1',name:'Pusat',active:true}];
      db.profile={name:'Pemilik',brand:'WZ BARBERSHOP PRO'};
      const hariIni=new Date().toISOString().slice(0,10);
      db.transactions=[{id:'T001',date:hariIni,status:'SELESAI',customerId:'C001',serviceId:'S001',
        employeeId:'E001',payment:'Tunai',total:120000,discount:0}];
      db.shiftReports=[];db.expenses=[{id:'X001',date:hariIni,category:'Bahan',note:'Creambath',amount:30000}];
    `);
    w.finance();
    await new Promise(r => setTimeout(r, 30));
    const html = w.document.getElementById('content').innerHTML;
    // Tiga peran inti harus benar-benar muncul di DOM.
    assert.match(html, /class="[^"]*money-in[^"]*"/, 'omzet tidak hijau di halaman Keuangan');
    assert.match(html, /class="[^"]*money-out[^"]*"/, 'pengeluaran tidak merah di halaman Keuangan');
    assert.match(html, /class="[^"]*money-profit[^"]*"/, 'laba tidak biru di halaman Keuangan');
    // Nominal tidak berubah: hanya warnanya.
    assert.match(html, /Rp 120\.000/, 'pendapatan hilang');
    assert.match(html, /Rp 30\.000/, 'pengeluaran hilang');
    // Tidak boleh ada peran yang sudah dihapus.
    assert.doesNotMatch(html, /money-bonus/, 'peran bonus masih bocor ke halaman');
    assert.deepEqual(errors, [], 'halaman error saat merender Keuangan');
  } finally {
    w.close();
  }
});
