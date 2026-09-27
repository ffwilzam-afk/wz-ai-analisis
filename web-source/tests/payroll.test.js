/* Tes mesin perhitungan gaji (payroll engine) dari web-source/index.html.
   Engine ini hidup inline di dalam SPA, jadi satu-satunya cara mengujinya
   tanpa memfaktorkan ulang logikanya (yang berisiko menyimpang dari
   kode yang benar-benar berjalan) adalah memuat index.html di jsdom lalu
   memanggil fungsi aslinya.

   Semua test memakai data buatan; tidak menyentuh database atau jaringan.
   Jalankan: node --test tests/  (atau: npm test) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const INDEX = path.join(__dirname, '..', 'index.html');

/* Memuat index.html sekali lalu memakai ulang window-nya. index.html cukup
   berat, dan boot cukup lambat; memuat ulang untuk tiap test tidak sepadan. */
let windowRef = null;
async function boot() {
  if (windowRef) return windowRef;
  const html = fs.readFileSync(INDEX, 'utf8');
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://wz.test/',
    virtualConsole,
    pretendToBeVisual: true,
    beforeParse(w) {
      w.structuredClone = structuredClone;
      // Tidak ada jaringan di dalam tes. Semua endpoint dibalas kosong;
      // logika yang diuji di sini semua berjalan di memori saja.
      w.fetch = async (url) => {
        const path = String(url).replace('/api/', '');
        const json = data => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
        if (path === 'auth/me') return json({ ok: true, user: { id: 'U1', username: 'owner', role: 'owner', name: 'Owner', businessId: 'BIZ1', branchId: 'B1' } });
        if (path === 'app-state') return json({ ok: true, data: {}, updatedAt: null });
        if (path === 'business') return json({ ok: true, transactions: [], shiftReports: [], branches: [], notifications: [] });
        if (path === 'employees') return json({ ok: true, employees: [] });
        return json({ ok: true });
      };
    }
  });
  // Event `load` bisa sudah lewat sebelum listener dipasang, jadi tunggu saja
  // sampai engine benar-benar terdefinisi.
  const w = dom.window;
  for (let i = 0; i < 200 && typeof w.calculatePayroll !== 'function'; i++) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.strictEqual(typeof w.calculatePayroll, 'function', 'index.html gagal memuat mesin payroll');
  windowRef = w;
  return windowRef;
}

// index.html menyalakan interval auto-refresh. Tanpa menutup window-nya,
// proses test tidak akan pernah selesai.
test.after(() => {
  if (windowRef) windowRef.close();
  windowRef = null;
});

const SERVICES = [
  { id: 'S1', name: 'Haircut', payrollCategory: 'haircut', price: 50000, duration: 30, active: true },
  { id: 'S2', name: 'Cuci Rambut', payrollCategory: 'hairwash', price: 15000, duration: 10, active: true },
  { id: 'S3', name: 'Gundul', payrollCategory: '', price: 50000, duration: 30, active: true }
];

/* Memasang data uji lewat eval: db/calculatePayroll dideklarasikan di
   script level, jadi tidak bisa dijangkau dari luar sebagai properti. */
function seed(w, { settings, employees, transactions, shiftReports }) {
  w.eval(`
    db.branches=[{id:'B1',name:'Pusat',active:true}];
    db.employees=${JSON.stringify(employees || [{ id: 'E1', name: 'Budi', role: 'Barber', branchId: 'B1', salary: 2000000, target: 0, eval: 0, attendance: 0, active: true }])};
    db.services=${JSON.stringify(SERVICES)};
    db.transactions=${JSON.stringify(transactions || [])};
    db.shiftReports=${JSON.stringify(shiftReports || [])};
    db.attendance=[];
    db.payrollSettings=${JSON.stringify(settings ?? null)};
    true;
  `);
}

function tx(n, serviceId, date, employeeId = 'E1') {
  return Array.from({ length: n }, (_, i) => ({
    id: 'TX' + serviceId + date + i, date, employeeId, customerId: 'C1',
    serviceId, servicePrice: 50000, total: 50000, payment: 'CASH', status: 'SELESAI', discount: 0
  }));
}

function shift(date, employeeId, services) {
  return {
    id: 'SR' + date + employeeId, date, employeeId, shiftType: 'Pagi', customers: 10,
    totalOmzet: 500000, services
  };
}

const payroll = (w, employeeId, date) => JSON.parse(w.eval(`JSON.stringify(calculatePayroll(${JSON.stringify(employeeId)},${JSON.stringify(date)}))`));

test('payroll: ambang Haircut dipakai, bukan angka hardcode', async () => {
  const w = await boot();
  seed(w, { transactions: tx(200, 'S1', '2026-09-25') });
  const normal = payroll(w, 'E1', '2026-09-25');
  // 200 pelanggan, ambang 157 -> 44 pelanggan berbonus.
  assert.strictEqual(normal.counts.haircut.customers, 200);
  assert.strictEqual(normal.counts.haircut.bonusCustomers, 44);
  assert.strictEqual(normal.counts.haircut.bonus, 440000);

  // Owner menaikkan ambang ke 300: bonus harus hilang. Sebelumnya angka
  // 156 ditulis langsung di kode sehingga ambang ini diabaikan.
  seed(w, {
    settings: { baseSalary: 2000000, periodStartDay: 24, serviceRules: { Haircut: { threshold: 300, bonus: 10000 } } },
    transactions: tx(200, 'S1', '2026-09-25')
  });
  const raised = payroll(w, 'E1', '2026-09-25');
  assert.strictEqual(raised.counts.haircut.threshold, 300);
  assert.strictEqual(raised.counts.haircut.bonusCustomers, 0);
  assert.strictEqual(raised.counts.haircut.bonus, 0);
});

test('payroll: bonus 0 berarti dimatikan, bukan diganti bawaan', async () => {
  const w = await boot();
  seed(w, {
    settings: { baseSalary: 2000000, periodStartDay: 24, serviceRules: { Hairwash: { threshold: 1, bonus: 0 } } },
    transactions: tx(3, 'S2', '2026-09-25')
  });
  const pay = payroll(w, 'E1', '2026-09-25');
  assert.strictEqual(pay.counts.hairwash.customers, 3);
  assert.strictEqual(pay.counts.hairwash.bonus, 0);
  assert.strictEqual(pay.totalBonus, 0);
});

test('payroll: ambang 0 menghitung semua pelanggan', async () => {
  const w = await boot();
  seed(w, {
    settings: { baseSalary: 2000000, periodStartDay: 24, serviceRules: { Hairwash: { threshold: 0, bonus: 2000 } } },
    transactions: tx(4, 'S2', '2026-09-25')
  });
  const pay = payroll(w, 'E1', '2026-09-25');
  assert.strictEqual(pay.counts.hairwash.bonusCustomers, 4);
  assert.strictEqual(pay.counts.hairwash.bonus, 8000);
});

test('payroll: tanggal batas periode tidak dihitung dua kali', async () => {
  const w = await boot();
  seed(w, { transactions: tx(1, 'S1', '2026-09-24') });
  const previous = payroll(w, 'E1', '2026-09-10');   // 2026-08-24 -> 2026-09-23
  const current = payroll(w, 'E1', '2026-10-01');   // 2026-09-24 -> 2026-10-23
  assert.strictEqual(previous.periodStart, '2026-08-24');
  assert.strictEqual(previous.periodEnd, '2026-09-23');
  assert.strictEqual(previous.counts.haircut.customers, 0);
  assert.strictEqual(current.counts.haircut.customers, 1);
});

test('payroll: layanan yang sama di POS dan laporan shift dibayar satu kali', async () => {
  const w = await boot();
  seed(w, {
    transactions: tx(10, 'S1', '2026-09-25'),
    shiftReports: [shift('2026-09-25', 'E1', [{ serviceId: 'S1', serviceName: 'Haircut', qty: 10, total: 500000 }])]
  });
  const pay = payroll(w, 'E1', '2026-09-25');
  assert.strictEqual(pay.counts.haircut.customers, 10, 'POS pada tanggal yang sama harus diabaikan');
});

test('payroll: POS tetap dihitung bila tidak ada laporan shift', async () => {
  const w = await boot();
  seed(w, { transactions: tx(10, 'S1', '2026-09-25') });
  assert.strictEqual(payroll(w, 'E1', '2026-09-25').counts.haircut.customers, 10);
});

test('payroll: kategori gaji eksplisit dipakai, nama lokal tetap bisa', async () => {
  const w = await boot();
  seed(w, { transactions: [...tx(2, 'S3', '2026-09-25')] });
  // S3 bernama "Gundul" dan tidak punya kategori gaji. KopCadangan dari nama
  // masih mengenali "gundul" sebagai haircut.
  assert.strictEqual(payroll(w, 'E1', '2026-09-25').counts.haircut.customers, 2);
  const key = w.eval(`JSON.stringify(payrollServiceKey({name:'Smoothing'}))`);
  assert.strictEqual(JSON.parse(key), null, 'nama yang tidak dikenal tidak boleh nebak-nebak');
});

test('payroll: pengaturan khusus karyawan mengungguli pengaturan umum', async () => {
  const w = await boot();
  const settings = {
    baseSalary: 2000000, periodStartDay: 24,
    serviceRules: { Haircut: { threshold: 157, bonus: 10000 } }
  };
  const employees = [
    { id: 'E1', name: 'Budi', role: 'Barber', branchId: 'B1', salary: 2000000, target: 0, eval: 0, attendance: 0, active: true },
    { id: 'E2', name: 'Sari', role: 'Barber', branchId: 'B1', salary: 2000000, target: 0, eval: 0, attendance: 0, active: true }
  ];
  const settingsWithOwn = {
    ...settings,
    employees: {
      E2: { employeeId: 'E2', baseSalary: 2750000, periodStartDay: 1, serviceRules: { Haircut: { threshold: 51, bonus: 20000 } } }
    }
  };
  // Keduanya dapat 60 Haircut supaya perbedaannya murni dari pengaturan.
  seed(w, {
    settings: settingsWithOwn,
    employees,
    transactions: [...tx(60, 'S1', '2026-09-25', 'E1'), ...tx(60, 'S1', '2026-09-25', 'E2')]
  });

  const common = payroll(w, 'E1', '2026-09-25');
  assert.strictEqual(common.counts.haircut.bonusCustomers, 0, 'ambang umum 157 belum tercapai');
  assert.strictEqual(common.baseSalary, 2000000);
  assert.strictEqual(common.customized, false);

  const own = payroll(w, 'E2', '2026-09-25');
  assert.strictEqual(own.counts.haircut.threshold, 51);
  assert.strictEqual(own.counts.haircut.bonusCustomers, 10);
  assert.strictEqual(own.counts.haircut.bonus, 200000);
  assert.strictEqual(own.baseSalary, 2750000);
  assert.strictEqual(own.baseSalarySource, 'Pengaturan khusus karyawan');
  assert.strictEqual(own.customized, true);
  assert.strictEqual(own.totalPay, 2750000 + 200000);
  // Aturan yang tidak diatur khusus karyawan tetap ikut pengaturan umum.
  assert.strictEqual(own.counts.hairwash.threshold, 1);
});

test('payroll: tanggal periode khusus karyawan dipakai', async () => {
  const w = await boot();
  const settings = {
    baseSalary: 2000000, periodStartDay: 24, serviceRules: {},
    employees: { E1: { employeeId: 'E1', baseSalary: 0, periodStartDay: 1, serviceRules: {} } }
  };
  seed(w, { settings, transactions: tx(1, 'S1', '2026-09-10') });
  const pay = payroll(w, 'E1', '2026-09-15');
  assert.strictEqual(pay.periodStart, '2026-09-01');
  assert.strictEqual(pay.periodEnd, '2026-09-30');
  assert.strictEqual(pay.counts.haircut.customers, 1);
});

test('payroll: gaji khusus 0 tidak menimpa gaji pada data karyawan', async () => {
  const w = await boot();
  const settings = {
    baseSalary: 2000000, periodStartDay: 24, serviceRules: {},
    employees: { E1: { employeeId: 'E1', baseSalary: 0, periodStartDay: null, serviceRules: {} } }
  };
  seed(w, { settings });
  const pay = payroll(w, 'E1', '2026-09-25');
  assert.strictEqual(pay.baseSalary, 2000000);
  assert.strictEqual(pay.baseSalarySource, 'Gaji pada data karyawan');
});

test('payroll: karyawan tanpa data gaji memakai pengaturan umum bisnis', async () => {
  const w = await boot();
  const employees = [{ id: 'E9', name: 'Tanpa Gaji', role: 'Barber', branchId: 'B1', salary: 0, target: 0, eval: 0, attendance: 0, active: true }];
  seed(w, { settings: { baseSalary: 3300000, periodStartDay: 24, serviceRules: {} }, employees });
  const pay = payroll(w, 'E9', '2026-09-25');
  assert.strictEqual(pay.baseSalary, 3300000);
  assert.strictEqual(pay.baseSalarySource, 'Pengaturan umum bisnis');
});

test('payroll: halaman Pengaturan Gaji memuat pengaturan lewat bridge window', async () => {
  const w = await boot();
  // Fungsi sync PayrollSettings berada di dalam IIFE bridge. Kalau halaman
  // memanggilnya langsung, ReferenceError tertelan try/catch dan halaman
  // diam-diam menampilkan nilai bawaan, bukan yang tersimpan.
  assert.strictEqual(typeof w.WZOnlinePayroll?.settings, 'function', 'bridge WZOnlinePayroll belum dipublish');
  assert.strictEqual(typeof w.WZOnlinePayroll?.employee, 'function');
});

test('payroll: kasus dasar sesuai aturan bawaan 24-24', async () => {
  const w = await boot();
  seed(w, { transactions: [...tx(160, 'S1', '2026-09-25'), ...tx(3, 'S2', '2026-09-25')] });
  const pay = payroll(w, 'E1', '2026-09-25');
  assert.strictEqual(pay.periodStart, '2026-09-24');
  assert.strictEqual(pay.periodEnd, '2026-10-23');
  assert.strictEqual(pay.counts.haircut.bonus, 40000);   // 4 x 10.000
  assert.strictEqual(pay.counts.hairwash.bonus, 6000);   // 3 x 2.000
  assert.strictEqual(pay.totalBonus, 46000);
  assert.strictEqual(pay.totalPay, 2046000);
});

test('payroll: nama layanan tidak berpengaruh, yang dipakai kategorinya', async () => {
  const w = await boot();
  // Nama lokal yang tidak ada padanannya di sistem gaji. Sistem gaji tidak
  // pernah menyimpan nama layanan, jadi nama ini boleh se bebas apa pun.
  const services = [
    { id: 'S1', name: 'Gundul', payrollCategory: 'haircut', price: 45000, duration: 25, active: true },
    { id: 'S2', name: 'Paket Rambut', payrollCategory: 'hairwash', price: 15000, duration: 10, active: true }
  ];
  const build = names => `
    db.branches=[{id:'B1',name:'Pusat',active:true}];
    db.employees=[{id:'E1',name:'Budi',role:'Barber',branchId:'B1',salary:2000000,target:0,eval:0,attendance:0,active:true}];
    db.services=${JSON.stringify(names)};
    db.transactions=[]; db.attendance=[];
    db.shiftReports=[{id:'SR1',date:'2026-09-25',employeeId:'E1',shiftType:'Pagi',customers:15,totalOmzet:600000,services:[
      {serviceId:'S1',serviceName:${JSON.stringify(names[0].name)},payrollCategory:'haircut',qty:12,price:45000,total:540000},
      {serviceId:'S2',serviceName:${JSON.stringify(names[1].name)},payrollCategory:'hairwash',qty:3,price:15000,total:45000}
    ]}];
    db.payrollSettings=${JSON.stringify({
      payrollType:'BASE_PLUS_SERVICE_BONUS',baseSalary:2000000,targetAmount:0,periodStartDay:24,
      serviceRules:{Haircut:{threshold:10,bonus:10000},Hairwash:{threshold:1,bonus:2000},Hairstyling:{threshold:1,bonus:2000},Shaving:{threshold:1,bonus:2000},Haircoloring:{threshold:1,bonus:20000}},
      employees:{}
    })};
    true;`;

  w.eval(build(services));
  const a = payroll(w, 'E1', '2026-09-25');
  assert.strictEqual(a.counts.haircut.customers, 12);
  assert.strictEqual(a.counts.haircut.bonus, 30000);   // 12 - (10-1) = 3 x 10.000
  assert.strictEqual(a.counts.hairwash.bonus, 6000);
  assert.strictEqual(a.totalPay, 2036000);

  // Nama diganti jadi sesuatu yang sama sekali tidak ada hubungannya.
  w.eval(build([
    { ...services[0], name: 'Zebra' },
    { ...services[1], name: 'QQQQ' }
  ]));
  const b = payroll(w, 'E1', '2026-09-25');
  assert.deepEqual(b.counts, a.counts, 'nama layanan tidak boleh memengaruhi upah');
  assert.strictEqual(b.totalPay, a.totalPay);
});

test('payroll: snapshot kategori menyelamatkan laporan yang layanannya sudah dihapus', async () => {
  const w = await boot();
  w.eval(`
    db.branches=[{id:'B1',name:'Pusat',active:true}];
    db.employees=[{id:'E1',name:'Budi',role:'Barber',branchId:'B1',salary:2000000,target:0,eval:0,attendance:0,active:true}];
    db.services=[]; db.transactions=[]; db.attendance=[];
    db.shiftReports=[{id:'SR1',date:'2026-09-25',employeeId:'E1',shiftType:'Pagi',customers:12,totalOmzet:540000,services:[
      {serviceId:'S1',serviceName:'Paket-exclusive',payrollCategory:'haircut',qty:12,price:45000,total:540000}
    ]}];
    db.payrollSettings=${JSON.stringify({
      payrollType:'BASE_PLUS_SERVICE_BONUS',baseSalary:2000000,targetAmount:0,periodStartDay:24,
      serviceRules:{Haircut:{threshold:10,bonus:10000},Hairwash:{threshold:1,bonus:2000},Hairstyling:{threshold:1,bonus:2000},Shaving:{threshold:1,bonus:2000},Haircoloring:{threshold:1,bonus:20000}},
      employees:{}
    })};
    true;`);
  const pay = payroll(w, 'E1', '2026-09-25');
  assert.strictEqual(pay.counts.haircut.customers, 12, 'snapshot harus dipakai saat master sudah kosong');
  assert.strictEqual(pay.counts.haircut.bonus, 30000);
});

test('payroll: master menang atas snapshot, jadi perbaikan kategori berlaku ke riwayat', async () => {
  const w = await boot();
  w.eval(`
    db.branches=[{id:'B1',name:'Pusat',active:true}];
    db.employees=[{id:'E1',name:'Budi',role:'Barber',branchId:'B1',salary:2000000,target:0,eval:0,attendance:0,active:true}];
    db.services=[{id:'S1',name:'Paket-exclusive',payrollCategory:'hairstyling',price:45000,duration:25,active:true}];
    db.transactions=[]; db.attendance=[];
    db.shiftReports=[{id:'SR1',date:'2026-09-25',employeeId:'E1',shiftType:'Pagi',customers:12,totalOmzet:540000,services:[
      {serviceId:'S1',serviceName:'Paket-exclusive',payrollCategory:'haircut',qty:12,price:45000,total:540000}
    ]}];
    db.payrollSettings=${JSON.stringify({
      payrollType:'BASE_PLUS_SERVICE_BONUS',baseSalary:2000000,targetAmount:0,periodStartDay:24,
      serviceRules:{Haircut:{threshold:10,bonus:10000},Hairwash:{threshold:1,bonus:2000},Hairstyling:{threshold:1,bonus:2000},Shaving:{threshold:1,bonus:2000},Haircoloring:{threshold:1,bonus:20000}},
      employees:{}
    })};
    true;`);
  const pay = payroll(w, 'E1', '2026-09-25');
  assert.strictEqual(pay.counts.haircut.customers, 0, 'kategori lama tidak boleh masih dipakai');
  assert.strictEqual(pay.counts.hairstyling.customers, 12);
  assert.strictEqual(pay.counts.hairstyling.bonus, 24000);
});

test('payroll: dropdown kategori menampilkan keadaan sebenarnya, bukan opsi pertama', async () => {
  const w = await boot();
  // S3 "Gundul" sengaja dibiarkan tanpa payrollCategory. Namanya cocok dengan
  // haircut, jadi ia masuk ke grup Haircut lewat pencocokan nama -- tapi yang
  // benar-benar tersimpan tetap kosong, dan dropdown harus jujur soal itu.
  const unassigned = w.eval(`payrollServiceOptions('')`);
  assert.ok(/<option value="" selected>Belum diatur<\/option>/.test(unassigned),
    'opsi kosong harus terpilih untuk layanan yang belum berkategori');
  // Layanan yang sudah berkategori tidak boleh memakai opsi kosong.
  const assigned = w.eval(`payrollServiceOptions('hairwash')`);
  assert.ok(assigned.includes('<option value="hairwash" selected>Hairwash</option>'),
    'kategori tersimpan harus terpilih');
  assert.ok(!/<option value=""[^>]*selected/.test(assigned),
    'opsi kosong tidak boleh terpilih pada layanan yang sudah berkategori');
});

test('payroll: memilih kategori pada halaman Pengaturan Gaji benar-benar tersimpan', async () => {
  const w = await boot();
  w.eval(`
    db.branches=[{id:'B1',name:'Pusat',active:true}];
    db.employees=[];
    db.transactions=[]; db.attendance=[]; db.shiftReports=[];
    db.services=[{id:'S3',name:'Gundul',payrollCategory:'',price:50000,duration:30,active:true}];
    currentUser={id:'U1',username:'owner',role:'owner',name:'Owner',businessId:'BIZ1',branchId:'B1'};
    true;`);
  // Pilih Hairwash lewat jalur yang sama dengan dropdown di layar.
  await w.setServicePayrollCategory('S3', 'hairwash');
  assert.strictEqual(JSON.parse(w.eval(`JSON.stringify(db.services[0].payrollCategory)`)), 'hairwash');
  assert.strictEqual(w.eval(`payrollServiceKey(db.services[0])`), 'hairwash');
  assert.strictEqual(w.eval(`payrollServiceGroups().unassigned.length`), 0);
  // Memilih ulang kategori yang sama harus tetap aman.
  await w.setServicePayrollCategory('S3', 'hairwash');
  assert.strictEqual(w.eval(`payrollServiceKey(db.services[0])`), 'hairwash');
});
