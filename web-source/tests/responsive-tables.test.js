/* Tabel -> kartu di layar kecil (Android).

   Tabel di aplikasi ini punya `min-width:700px`. Di HP 360px itu selalu
   berakhir jadi geser-horizontal, dan itulah komplain yang paling sering
  heard dari pengguna Android.

   Perbaikannya: di bawah ambang lebar tertentu tiap baris tabel dirender
   sebagai kartu. Nama kolom diambil dari `<thead>` oleh `wzApplyCardMode()`
   lalu ditampilkan lewat `content:attr(data-wz-th)`. Labelnya selalu
   ditempel, keputusan menampilkannya ada di CSS -- jadi perilaku JS-nya bisa
   diuji di jsdom tanpa meniru media query.

   Yang harus tetap utuh: tabel di layar lebar tidak berubah, baris yang
   punya `onclick` tetap bisa diketuk, dan pencarian/filter tabel tetap
   menyembunyikan baris dengan benar.

   Jalankan: node --test tests/responsive-tables.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

const RICH = {
  branches: [{ id: 'B1', name: 'Pusat', active: true }],
  employees: [{ id: 'E1', name: 'Budi', role: 'Barber', branchId: 'B1', salary: 2500000, commission: 0, target: 0, eval: 0, attendance: 0, active: true }],
  services: [
    { id: 'S1', name: 'Haircut', category: 'Umum', payrollCategory: 'haircut', price: 50000, duration: 30, active: true },
    { id: 'S2', name: 'Gundul', category: 'Umum', payrollCategory: 'hairwash', price: 40000, duration: 25, active: true }
  ],
  products: [{ id: 'P1', name: 'Pomade', price: 75000, cost: 40000, stock: 10, active: true }],
  customers: [
    { id: 'C1', name: 'Dewi', phone: '0812', visits: 4, total: 200000, active: true },
    { id: 'C2', name: 'Andi', phone: '0813', visits: 2, total: 100000, active: true }
  ],
  transactions: [
    { id: 'TX1', date: '2026-09-20', time: '10:00', customerId: 'C1', customerName: 'Dewi', employeeId: 'E1', employeeName: 'Budi', serviceId: 'S1', serviceName: 'Haircut', servicePrice: 50000, price: 50000, discount: 0, total: 50000, payment: 'Tunai', status: 'SELESAI', branchId: 'B1' },
    { id: 'TX2', date: '2026-09-21', time: '11:00', customerId: 'C2', customerName: 'Andi', employeeId: 'E1', employeeName: 'Budi', serviceId: 'S2', serviceName: 'Gundul', servicePrice: 40000, price: 40000, discount: 0, total: 40000, payment: 'QRIS', status: 'VOID', branchId: 'B1' }
  ],
  shiftReports: [], expenses: [], attendance: [], schedules: [], notifications: [], accounts: [],
  profile: { analyticsPeriod: 7, notificationSoundEnabled: true },
  payrollSettings: null
};

const openWindows = new Set();
test.after(() => { for (const w of openWindows) { try { w.close(); } catch { } } openWindows.clear(); });

async function bootApp(role = 'owner', html = INDEX) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://wz.test/', virtualConsole, pretendToBeVisual: true,
    beforeParse(w) {
      w.structuredClone = structuredClone;
      w.alert = m => errors.push('ALERT: ' + m);
      w.confirm = () => true;
      w.print = () => { };
      w.fetch = async (target, opts = {}) => {
        const p = String(target).replace('/api/', '').split('?')[0];
        const json = d => { const b = JSON.stringify(d); return { ok: true, status: 200, text: async () => b, json: async () => JSON.parse(b) }; };
        if (p === 'auth/me') return json({ ok: true, user: { id: 'U1', username: 'owner', role: 'owner', name: 'Owner', businessId: 'BIZ1', branchId: 'B1' } });
        if (p === 'business') return json({ ok: true, transactions: RICH.transactions, shiftReports: [], branches: RICH.branches, notifications: [] });
        if (p === 'employees') return json({ ok: true, employees: RICH.employees });
        if (p === 'app-state') return json({ ok: true, data: {}, updatedAt: null });
        if (p === 'payroll/settings') return json({ ok: true, settings: { payrollType: 'BASE_PLUS_SERVICE_BONUS', baseSalary: 2000000, periodStartDay: 24, serviceRules: {} } });
        if (p === 'payroll/employee') return json({ ok: true, settings: [] });
        return json({ ok: true });
      };
    }
  });
  const w = dom.window;
  openWindows.add(w);
  for (let i = 0; i < 200 && typeof w.calculatePayroll !== 'function'; i++) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => setTimeout(r, 300));
  w.eval('currentUser={id:"U1",username:"o",role:' + JSON.stringify(role) + ',name:"Pemilik",businessId:"BIZ1",branchId:"B1",employeeId:' + (role === 'employee' ? "'E1'" : 'null') + '};db=' + JSON.stringify(RICH) + ';true');
  return { w, errors };
}

const labelsOf = row => [...row.querySelectorAll('td')].map(td => td.getAttribute('data-wz-th'));

test('setiap sel data di tabel transaksi punya label dari kolomnya', async () => {
  const { w, errors } = await bootApp('owner');
  await w.eval("go('transactions')");
  await new Promise(r => setTimeout(r, 100));
  const heads = [...w.document.querySelectorAll('#txBody')].length;
  assert.strictEqual(heads, 1, 'tabel transaksi harus ada');
  const head = [...w.document.querySelectorAll('.table-wrap thead th')].map(th => th.textContent.trim());
  assert.ok(head.length >= 8, 'header tabel transaksi tidak terdeteksi: ' + JSON.stringify(head));
  const rows = [...w.document.querySelectorAll('#txBody tr')];
  assert.strictEqual(rows.length, 2, 'dua baris transaksi harus ada');
  for (const row of rows) {
    const labels = labelsOf(row);
    const cells = [...row.querySelectorAll('td')];
    assert.strictEqual(labels.length, cells.length);
    // Semua sel kecuali kolom aksi terakhir (header-nya kosong) harus berlabel.
    for (let i = 0; i < cells.length - 1; i++) {
      assert.strictEqual(labels[i], head[i], 'label sel ke-' + i + ' harus sama dengan judul kolomnya');
    }
    assert.strictEqual(labels[cells.length - 1], null, 'kolom aksi tidak boleh diberi label');
  }
  assert.deepStrictEqual(errors, []);
  w.close(); openWindows.delete(w);
});

test('baris rekap ber-colspan jadi blok catatan, bukan kartu', async () => {
  const { w } = await bootApp('owner');
  await w.eval("document.getElementById('content').innerHTML=" + JSON.stringify(
    '<div class="table-wrap"><table class="table"><thead><tr><th>A</th><th>B</th></tr></thead>' +
    '<tbody><tr><td>1</td><td>2</td></tr><tr><td colspan="2" class="empty">Belum ada data.</td></tr></tbody></table></div>'
  ) + ";wzApplyCardMode(document);true");
  const rows = [...w.document.querySelectorAll('.table-wrap tbody tr')];
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].classList.contains('wz-card-summary'), false, 'baris data bukan baris rekap');
  assert.deepStrictEqual(labelsOf(rows[0]), ['A', 'B']);
  assert.strictEqual(rows[1].classList.contains('wz-card-summary'), true, 'baris colspan harus ditandai rekap');
  assert.strictEqual(rows[1].querySelector('td').getAttribute('data-wz-th'), null, 'baris rekap tidak boleh berlabel kolom');
  w.close(); openWindows.delete(w);
});

test('tabel yang dibuat setelah halaman siap ikut dilabeli otomatis', async () => {
  // Semua halaman dirender lewat render() yang menulis ulang #content, jadi
  // observer harusvelte menutup tabel baru tanpa perlu pemanggilan manual.
  const { w } = await bootApp('owner');
  await w.eval("document.getElementById('content').innerHTML='<div class=\"table-wrap\"><table class=\"table\"><thead><tr><th>Waktu</th><th>Total</th></tr></thead><tbody><tr><td>10:00</td><td>Rp50.000</td></tr></tbody></table></div>';true");
  await new Promise(r => setTimeout(r, 120));
  assert.deepStrictEqual(
    labelsOf(w.document.querySelector('.table-wrap tbody tr')),
    ['Waktu', 'Total'],
    'MutationObserver harus menandai tabel baru yang masuk ke #content'
  );
  w.close(); openWindows.delete(w);
});

test('baris tabel yang punya onclick tetap bisa diketuk', async () => {
  const { w } = await bootApp('owner');
  await w.eval("go('transactions')");
  await new Promise(r => setTimeout(r, 100));
  const row = w.document.querySelector('#txBody tr');
  // Mode kartu hanya mengubah tampilan lewat CSS; struktur dan penangan
  // kliknya harus utuh.
  assert.strictEqual(row.tagName, 'TR', 'baris harus tetap elemen <tr>');
  const button = row.querySelector('button');
  assert.ok(button, 'tombol aksi harus tetap ada di dalam baris');
  const rowId = row.querySelector('td').textContent.trim();
  w.eval('window.__detail=null;var _td=txDetail;txDetail=function(id){window.__detail=id;return _td(id)};true');
  button.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  const detailId = JSON.parse(w.eval('JSON.stringify(window.__detail)'));
  assert.strictEqual(detailId, rowId, 'tombol Detail harus tetap memanggil txDetail dengan id baris itu');
  w.close(); openWindows.delete(w);
});

test('filter tabel tetap menyembunyikan baris dengan benar', async () => {
  const { w } = await bootApp('owner');
  await w.eval("go('transactions')");
  await new Promise(r => setTimeout(r, 100));
  // "Andi" hanya muncul di baris TX2, jadi TX2 yang harus tersisa.
  await w.eval("document.getElementById('txSearch').value='Andi';filterTransactions();true");
  const rows = JSON.parse(w.eval("JSON.stringify([...document.querySelectorAll('#txBody tr')].map(r=>[r.cells[0].textContent.trim(),r.style.display]))"));
  const andi = rows.find(([id]) => id === 'TX2');
  const budi = rows.find(([id]) => id === 'TX1');
  assert.ok(andi && budi, 'kedua baris harus ada: ' + JSON.stringify(rows));
  assert.strictEqual(andi[1], '', 'baris TX2 (pelanggan Andi) harus tetap tampil');
  assert.strictEqual(budi[1], 'none', 'baris TX1 tidak boleh ikut tampil');
  w.close(); openWindows.delete(w);
});

test('CSS: kartu hanya aktif di layar kecil, tabel lebar tetap utuh', async () => {
  const base = INDEX.match(/\.table\{[^}]*min-width:700px[^}]*\}/);
  assert.ok(base, 'aturan min-width:700px pada .table harus tetap ada -- kalau hilang, tabel di laptop ikut jadi kartu');
  assert.doesNotMatch(base[0], /@media/, 'aturan dasar .table tidak boleh berada di dalam media query');

  const cardBlock = INDEX.slice(INDEX.indexOf('@media(max-width:600px){'), INDEX.indexOf('@media(max-width:380px){'));
  assert.ok(cardBlock, 'blok CSS mode kartu di 600px tidak ditemukan');
  for (const rule of [
    '.table-wrap thead{display:none}',
    '.table-wrap table{min-width:0',
    'content:attr(data-wz-th)',
    'tr.wz-card-summary'
  ]) {
    assert.ok(cardBlock.includes(rule), 'aturan CSS mode kartu hilang: ' + rule);
  }
  // Label kolom harus punya label yang bisa dibaca orang, bukan angka indeks.
  assert.doesNotMatch(cardBlock, /content:attr\(data-wz-index\)/, 'label kolom harus berupa teks kolom');

  // Blok ini harus berada paling akhir supaya menang atas aturan 800px yang
  // lebih lama di file.
  assert.ok(INDEX.lastIndexOf('@media(max-width:600px){\n  .table-wrap') > INDEX.indexOf('@media(max-width:800px){.sidebar'),
    'CSS mode kartu harus diletakkan setelah aturan layar kecil yang sudah ada');
});

test('admin.html memakai mode kartu yang sama', async () => {
  const start = ADMIN.indexOf('/* TABEL -> KARTU DI LAYAR KECIL');
  assert.ok(start > 0, 'fungsi mode kartu tidak ada di admin.html');
  assert.ok(ADMIN.includes('viewShell(id,html){'), 'admin.html harus tetap punya viewShell');
  const block = ADMIN.slice(ADMIN.indexOf('@media(max-width:650px){', ADMIN.indexOf('Tabel admin -> kartu')));
  assert.ok(block.includes('content:attr(data-wz-th)'), 'admin.html harus punya aturan label kartu');
  assert.ok(block.includes('tr.wz-card-summary'), 'admin.html harus punya aturan baris rekap');
});

test('tabel riwayat analitik: baris rekap jadi blok catatan, bukan kartu', async () => {
  // Memanggil pembuat tabelnya secara langsung supaya markup-nya benar-benar
  // yang dipakai aplikasi, tanpa bergantung pada data analytics.
  const { w } = await bootApp('owner');
  await w.eval(`document.getElementById('content').innerHTML=analyticsHistoryTable(
    {pelanggan:12,omzet:600000,pengeluaran:150000,laba:450000},
    ['<tr><td>2026-09-26</td><td>6</td><td>4</td><td>300.000</td><td>0</td><td>300.000</td></tr>',
     '<tr><td>2026-09-27</td><td>6</td><td>5</td><td>300.000</td><td>150.000</td><td>150.000</td></tr>'],
    ['Hari','Pelanggan','Transaksi','Omzet','Pengeluaran','Laba Bersih'],
    'Total 7 hari'
  );
  wzApplyCardMode(document);
  true`);
  const info = JSON.parse(w.eval(`JSON.stringify((()=>{
    const t=document.querySelector('.historical-table');
    return {head:[...t.querySelectorAll('thead th')].map(x=>x.textContent.trim()),
      rows:[...t.querySelectorAll('tbody tr')].map(r=>({cls:r.className,summary:r.classList.contains('wz-card-summary'),labels:[...r.querySelectorAll('td')].map(c=>c.getAttribute('data-wz-th'))}))};
  })())`));
  assert.deepStrictEqual(info.head, ['Hari', 'Pelanggan', 'Transaksi', 'Omzet', 'Pengeluaran', 'Laba Bersih']);
  const data = info.rows.filter(r => !r.summary);
  assert.strictEqual(data.length, 2, 'dua baris data harus ada: ' + JSON.stringify(info.rows));
  for (const r of data) {
    assert.deepStrictEqual(r.labels, info.head, 'baris data harus berlabel sesuai judul kolomnya');
  }
  const total = info.rows.find(r => r.cls.includes('historical-total'));
  assert.ok(total, 'baris rekap harus ada: ' + JSON.stringify(info.rows));
  assert.strictEqual(total.summary, true, 'baris rekap harus ditandai sebagai blok catatan');
  assert.deepStrictEqual(total.labels, [null], 'baris rekap tidak boleh punya label kolom');
  w.close(); openWindows.delete(w);
});
