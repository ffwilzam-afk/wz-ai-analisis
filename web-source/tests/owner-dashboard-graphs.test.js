/* Grafik "Layanan Terlaris" dan "Top Barber" di dashboard Owner.

   Dua kartu ini sebelumnya hanya menghitung bucket TERAKHIR dari rentang
   grafik -- default-nya adalah HARI INI. Begitu tidak ada transaksi hari itu
   (keadaan yang paling sering terjadi: aplikasi dibuka pagi, atau sudah lewat
   tutup), keduanya menampilkan "Belum ada data." sementara kartu omzet,
   pengeluaran, dan laba tetap normal karena memakai seluruh rentang.   Keluhan pengguna: "grafik layanan terlaris dan grafik top barber tidak berfungsi".

   Sekarang keduanya memakai seluruh rentang yang dipilih. Tes ini mengunci
   perilakunya, termasuk percobaan Diam-diam: nilai bar tidak boleh kembali
   jadi nol, karena peta barber sempat memakai nama field yang salah (`amount`
   sementara kartu membaca `value`).

   Jalankan: node --test tests/owner-dashboard-graphs.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const iso = d => d.toISOString().slice(0, 10);
const TODAY = new Date();
const daysAgo = n => { const d = new Date(TODAY); d.setUTCDate(d.getUTCDate() - n); return iso(d); };

// Sengaja TIDAK ADA transaksi pada hari ini: itulah keadaan yang dulu
// membuat kedua kartu kosong.
const Y1 = daysAgo(1), Y2 = daysAgo(3);

const DB = {
  branches: [{ id: 'B1', name: 'Pusat', active: true }],
  employees: [
    { id: 'E1', name: 'Budi', role: 'Barber', branchId: 'B1', salary: 2500000, commission: 0, target: 0, eval: 80, attendance: 0, active: true },
    { id: 'E2', name: 'Sandi', role: 'Barber', branchId: 'B1', salary: 2500000, commission: 0, target: 0, eval: 70, attendance: 0, active: true }
  ],
  services: [
    { id: 'S1', name: 'Haircut', category: 'Umum', payrollCategory: 'haircut', price: 50000, duration: 30, active: true },
    { id: 'S2', name: 'Gundul', category: 'Umum', payrollCategory: 'hairwash', price: 40000, duration: 25, active: true }
  ],
  products: [], customers: [],
  transactions: [
    { id: 'TX1', date: Y1, time: '10:00', customerId: null, customerName: 'Dewi', employeeId: 'E1', serviceId: 'S1', serviceName: 'Haircut', servicePrice: 50000, price: 50000, discount: 0, total: 50000, payment: 'Tunai', status: 'SELESAI', branchId: 'B1' },
    { id: 'TX2', date: Y2, time: '11:00', customerId: null, customerName: 'Andi', employeeId: 'E2', serviceId: 'S2', serviceName: 'Gundul', servicePrice: 40000, price: 40000, discount: 0, total: 40000, payment: 'QRIS', status: 'SELESAI', branchId: 'B1' }
  ],
  shiftReports: [
    { id: 'SR1', date: Y1, employeeId: 'E1', customers: 4, openingCash: 0, cash: 0, qris: 0, cashExpense: 0, totalOmzet: 300000, services: [{ serviceId: 'S1', serviceName: 'Haircut', qty: 3, price: 50000, total: 150000 }] }
  ],
  expenses: [], attendance: [], schedules: [], notifications: [], accounts: [],
  profile: { analyticsPeriod: 7, notificationSoundEnabled: true }, payrollSettings: null
};

const openWindows = new Set();
test.after(() => { for (const w of openWindows) { try { w.close(); } catch { } } openWindows.clear(); });

async function bootDashboard() {
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
      w.fetch = async (target) => {
        const p = String(target).replace('/api/', '').split('?')[0];
        const json = d => { const b = JSON.stringify(d); return { ok: true, status: 200, text: async () => b, json: async () => JSON.parse(b) }; };
        if (p === 'auth/me') return json({ ok: true, user: { id: 'U1', username: 'o', role: 'owner', name: 'Owner', businessId: 'BIZ1', branchId: 'B1' } });
        if (p === 'business') return json({ ok: true, transactions: DB.transactions, shiftReports: DB.shiftReports, branches: DB.branches, notifications: [] });
        if (p === 'employees') return json({ ok: true, employees: DB.employees });
        if (p === 'app-state') return json({ ok: true, data: {}, updatedAt: null });
        return json({ ok: true });
      };
    }
  });
  const w = dom.window;
  openWindows.add(w);
  for (let i = 0; i < 200 && typeof w.go !== 'function'; i++) await new Promise(r => setTimeout(r, 25));
  await new Promise(r => setTimeout(r, 250));
  w.eval('currentUser={id:"U1",username:"o",role:"owner",name:"Owner",businessId:"BIZ1",branchId:"B1",employeeId:null};db=' + JSON.stringify(DB) + ';go("dashboard");true');
  await new Promise(r => setTimeout(r, 150));
  return { w, errors };
}

const rankCard = (w, title) => [...w.document.querySelectorAll('section.card')]
  .find(c => { const h = c.querySelector('h3'); return h && h.textContent.trim() === title; });

const rankRows = card => [...card.querySelectorAll('.owner-rank-row')].map(row => ({
  name: row.querySelector('.owner-rank-name').textContent.trim(),
  value: row.querySelector('.owner-rank-value').textContent.trim(),
  width: row.querySelector('.owner-rank-fill').style.width
}));

test('kedua kartu ranking tetap terisi walau tidak ada transaksi hari ini', async () => {
  const { w, errors } = await bootDashboard();
  const today = w.eval('dateNow()');
  assert.ok(!DB.transactions.some(t => t.date === today) && !DB.shiftReports.some(r => r.date === today),
    'data tes harus memang tidak punya transaksi hari ini, kalau tidak tes ini tidak berarti');

  const svc = rankCard(w, 'GRAFIK LAYANAN TERLARIS');
  const barber = rankCard(w, 'GRAFIK TOP BARBER');
  assert.ok(svc && barber, 'kedua kartu grafik ranking harus ada');
  assert.ok(svc.querySelector('.owner-ranked-chart'), 'kartu Layanan Terlaris tidak punya chart');
  assert.ok(barber.querySelector('.owner-ranked-chart'), 'kartu Top Barber tidak punya chart');
  assert.ok(!svc.textContent.includes('Belum ada data'), 'Layanan Terlaris tidak boleh kosong');
  assert.ok(!barber.textContent.includes('Belum ada data'), 'Top Barber tidak boleh kosong');
  assert.deepStrictEqual(errors, []);
  w.close(); openWindows.delete(w);
});

test('jumlah terjual dan omzet pada bar sesuai data, bukan nol', async () => {
  const { w } = await bootDashboard();
  const svc = rankRows(rankCard(w, 'GRAFIK LAYANAN TERLARIS'));
  assert.deepStrictEqual(svc.map(r => r.name), ['Haircut', 'Gundul']);
  // Haircut = 1 POS + 3 dari laporan tutup shift = 4, Gundul = 1 POS.
  assert.deepStrictEqual(svc.map(r => r.value), ['4 trx', '1 trx']);
  assert.ok(Number(svc[0].width.replace('%', '')) === 100, 'bar terbesar harus 100%');
  assert.ok(Number(svc[1].width.replace('%', '')) === 25, 'bar kedua harus 25% dari yang terbesar');

  const barber = rankRows(rankCard(w, 'GRAFIK TOP BARBER'));
  // Budi = Rp50.000 POS + Rp300.000 tutup shift, Sandi = Rp40.000 POS.
  assert.deepStrictEqual(barber.map(r => r.name), ['Budi', 'Sandi']);
  assert.deepStrictEqual(barber.map(r => r.value), ['Rp 350.000', 'Rp 40.000']);
  for (const row of barber) {
    assert.notStrictEqual(row.value, 'Rp 0', 'nilai barber tidak boleh nol -- peta barber harus memakai field yang sama dengan kartu');
  }
  w.close(); openWindows.delete(w);
});

test('judul kartu menyebut rentang yang dipilih, bukan hanya satu hari', async () => {
  const { w } = await bootDashboard();
  const label = w.eval('dashboardGraphRangeLabel()');
  assert.ok(/\d+ \w{3} . \d+ \w{3}/.test(label), 'label rentang tidak terbaca: ' + label);
  for (const title of ['GRAFIK LAYANAN TERLARIS', 'GRAFIK TOP BARBER']) {
    const sub = rankCard(w, title).querySelector('.subtle').textContent;
    assert.ok(sub.includes(label), 'kartu ' + title + ' belum menyebut rentang: ' + sub);
  }
  w.close(); openWindows.delete(w);
});

test('mengubah rentang tanggal ikut mengubah isi kedua kartu', async () => {
  const { w } = await bootDashboard();
  // Persempit ke satu hari tanpa transaksi -> kartu harus kosong, bukan menebak.
  w.eval('window.__dashboardGraphRange={from:"' + Y1 + '",to:"' + Y1 + '"};go("dashboard");true');
  await new Promise(r => setTimeout(r, 150));
  const empty = w.eval('JSON.stringify(dashboardServiceCountMap(branchBusinessFeed(null).filter(x=>x.date==="' + Y1 + '")))');
  assert.ok(Object.keys(JSON.parse(empty)).length >= 1, 'hari ' + Y1 + ' memang punya data');

  // Hari tanpa transaksi apa pun.
  const idle = daysAgo(6);
  w.eval('window.__dashboardGraphRange={from:"' + idle + '",to:"' + idle + '"};go("dashboard");true');
  await new Promise(r => setTimeout(r, 150));
  const svc = rankCard(w, 'GRAFIK LAYANAN TERLARIS');
  assert.ok(svc.textContent.includes('Belum ada data'), 'rentang tanpa transaksi harus tetap kosong');
  assert.strictEqual(rankCard(w, 'GRAFIK TOP BARBER').textContent.includes('Belum ada data'), true);
  w.close(); openWindows.delete(w);
});

test('menekan bar membuka rincian rentang, lengkap dengan rincian per periode', async () => {
  const { w } = await bootDashboard();
  const label = w.eval('dashboardGraphRangeLabel()');
  rankCard(w, 'GRAFIK LAYANAN TERLARIS').querySelector('.owner-rank-row').click();
  await new Promise(r => setTimeout(r, 80));
  const dialog = w.document.getElementById('dialog').textContent.replace(/\s+/g, ' ').trim();
  assert.ok(dialog.includes('Detail Layanan Terlaris'), 'dialog tidak terbuka: ' + dialog);
  assert.ok(dialog.includes(label), 'judul dialog harus menyebut rentang: ' + dialog);
  assert.ok(dialog.includes('Rincian per periode'), 'rincian per periode tidak ada: ' + dialog);
  assert.ok(dialog.includes('4 trx'), 'jumlah penjualan tidak ikut: ' + dialog);
  w.close(); openWindows.delete(w);
});

test('menekan bar barber membuka rincian omzet, bukan nol', async () => {
  const { w } = await bootDashboard();
  rankCard(w, 'GRAFIK TOP BARBER').querySelector('.owner-rank-row').click();
  await new Promise(r => setTimeout(r, 80));
  const dialog = w.document.getElementById('dialog').textContent.replace(/\s+/g, ' ').trim();
  assert.ok(dialog.includes('Detail Top Barber'), 'dialog tidak terbuka: ' + dialog);
  assert.ok(dialog.includes('Rp 350.000'), 'omzet barber tidak ikut: ' + dialog);
  assert.ok(dialog.includes('Rincian per periode'), 'rincian per periode tidak ada: ' + dialog);
  w.close(); openWindows.delete(w);
});

test('grafik garis tidak berubah: satu titik tetap satu periode', async () => {
  const { w } = await bootDashboard();
  const card = rankCard(w, 'GRAFIK OMZET');
  assert.ok(card, 'kartu GRAFIK OMZET harus ada');
  const point = card.querySelector('.owner-chart-line .click-point');
  assert.ok(point, 'titik grafik garis tidak ditemukan');
  point.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 80));
  const dialog = w.document.getElementById('dialog').textContent.replace(/\s+/g, ' ').trim();
  assert.ok(dialog.includes('Detail Omzet'), 'dialog omzet tidak terbuka: ' + dialog);
  assert.ok(!dialog.includes('Rincian per periode'),
    'grafik garis harus tetap satu periode, tidak ikut jadi rentang');
  w.close(); openWindows.delete(w);
});

test('penjaga: kartu ranking tidak boleh kembali memakai bucket terakhir saja', () => {
  // `graphBuckets[graphBuckets.length-1]` adalah penyebab asli: hanya hari
  // terakhir yang dihitung, jadi kartu kosong begitu hari itu tanpa transaksi.
  assert.ok(!/serviceGraph\s*=/.test(INDEX) || !/graphBuckets\[graphBuckets\.length-1\][^;\n]*serviceGraph/.test(INDEX),
    'kartu ranking tidak boleh dihitung dari bucket terakhir');
  assert.match(INDEX, /const serviceGraph=Object\.entries\(dashboardServiceCountMap\(rangeRows\)\)/);
  assert.match(INDEX, /const barberGraph=Object\.values\(dashboardBarberAmountMap\(rangeRows\)\)/);
});
