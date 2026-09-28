# WZ MANAGE PRO - Materi Listing Play Store

Semua teks di bawah ini **siap disalin** ke Play Console. Batas karakter Play
dijaga: nama aplikasi 30, short description 80, full description 4000 karakter.

Berkas gambar yang sudah tersedia di folder ini:

| Berkas | Ukuran | Dipakai untuk |
|---|---|---|
| `icon-512.png` | 512x512 PNG, tanpa alpha | Ikon listing (wajib) |
| `feature-graphic.png` | 1024x500 PNG | Banner atas listing (wajib) |
| `screenshots/` | - | Lihat bagian "Screenshot" (wajib, min. 2) |

---

## 1. Detail aplikasi

**Nama aplikasi (30 karakter)**
```
WZ MANAGE PRO
```

**Ringkasan singkat / short description (80 karakter)**
```
Kelola barbershop: kasir, shift, karyawan, payroll, dan laporan.
```
(72 karakter)

**Kategori**
- Kategori: `Business` (Produktivitas)
- Tag opsional, misalnya `point of sale`, `barbershop`, `manajemen`, `kasir`

**Email dukungan** -> isi alamat email bisnis yang aktif.
**Alamat privasi** -> `https://wz-ai-analisis-rust.vercel.app/privacy.html`

---

## 2. Deskripsi lengkap (Indonesia)

```
WZ MANAGE PRO adalah aplikasi manajemen barbershop yang membuat semua kegiatan
tempat POTONG RAMBUT jadi satu layar.

SEMUA DALAM SATU APLIKASI

Dashboard
Ringkasan omzet, laba, jumlah transaksi, dan grafik layanan terlaris plus
top barber untuk periode yang dipilih. Grafik bisa ditanya per hari, minggu,
bulan, atau rentang custom.

Transaksi dan Kasir
Catat penjualan walk-in maupun member, pilih layanan, gunakan promo, terima
pembayaran, dan cetak struk langsung dari printer Android.

Laporan Tutup Shift
Barber sebagai kasir wajib menutup shift. Aplikasi memvalidasi jumlah uang
yang ada di laci terhadap angka yang diinput, jadi selisih tidak bisa lolos
tanpa dicatat.

Karyawan
Data karyawan, jabatan, cabang, kehadiran, dan performa per orang.

Layanan dan Promo
Kelola daftar layanan, harga, durasi, dan promo yang sedang berjalan.

Pelanggan
Simpan data pelanggan, riwayat kunjungan, dan poin loyalitas.

Keuangan
Pemasukan, pengeluaran, komisi, dan saldo bersih dalam satu tampilan.

Laporan dan Analisis Bisnis
Rekap harian, bulanan, per cabang, per layanan, dan per karyawan.

Operasional
Jadwal kerja, absensi, dan aktivitas harian outlet.

Multi Cabang
Kelola beberapa cabang dari satu akun, lengkap dengan pembatasan akses
setiap role.

Notifikasi
Notifikasi real-time ke HP saat ada laporan shift baru, tanpa perlu membuka
aplikasi.

Pengaturan Gaji dan Payroll
Aturan gaji, tunjangan, potongan, dan slip gaji per karyawan.

Peran Pengguna
Pembatasan menu untuk Owner, Manajer, Kasir, dan Barber supaya data sensitif
tidak bisa dibuka oleh orang yang salah.

Bahasa
Tampilan penuh dalam Bahasa Indonesia, cocok untuk barber dan staf di
Indonesia.
```

---

## 3. Full description (English)

```
WZ MANAGE PRO brings your barbershop into one screen, right from your phone.

EVERYTHING IN ONE APP

Dashboard
Revenue, profit, transaction count, plus top-service and top-barber charts for
the period you select. Charts can be viewed by day, week, month, or custom
range.

Transactions and POS
Record walk-in or member sales, pick services, apply promos, take payment, and
print the receipt straight from an Android printer.

Shift Closing Report
Cashiers must close their shift before the day can end. The app validates the
cash actually in the drawer against the number entered, so a discrepancy
cannot slip through unnoticed.

Employees
Staff records, roles, branch assignment, attendance, and per-barber
performance.

Services and Promos
Manage the service list, prices, duration, and running promotions.

Customers
Customer records, visit history, and loyalty points.

Finance
Income, expenses, commissions, and net balance in one view.

Reports and Business Analytics
Daily and monthly summaries by branch, by service, and by employee.

Operations
Staff schedules, attendance, and day-to-day outlet activity.

Multi-branch
Run several branches from one account, with per-role access restrictions.

Notifications
Real-time push notifications to your phone when a shift report is submitted,
without opening the app.

Payroll
Salary rules, allowances, deductions, and payslips per employee.

User Roles
Menu restrictions for Owner, Manager, Cashier, and Barber so sensitive data
stays with the people who need it.

Language
Full Bahasa Indonesia interface, made for barbershops and staff in Indonesia.
```

---

## 4. Screenshot (wajib, minimal 2)

Play Console menerima 2 sampai 8 screenshot per format. Untuk aplikasi ini
disarankan **format_phone**: rasio 9:16, lebar 1080 px (rentang yang
diizinkan 320 sampai 3840 px), tinggi minimal 1920 px. PNG atau JPEG, tanpa
alpha.

Ambil dengan emulator atau HP Samsung Galaxy, lalu potong status bar dan
navigation bar agar bersih. Yang paling meyakinkan untuk reviewer:

1. **Login** - layar login WZ MANAGE PRO.
2. **Dashboard** - grafik dan KPI terisi angka. Pilih periode yang punya
   transaksi supaya grafik tidak kosong.
3. **Transaksi** - form kasir saat ada layanan yang dipilih.
4. **Laporan Tutup Shift** - dialog validasi selisih uang.
5. **Karyawan** - daftar staf.
6. **Analisis Bisnis** - grafik ranking layanan dan barber.

Simpan hasil potret di `web-source/play-store/screenshots/` dengan nama
`01-login.png`, `02-dashboard.png`, `03-transaksi.png`, `04-shift.png`,
`05-karyawan.png`, `06-analisis.png`.

> Screenshot harus dari versi **rilis** yang akan diunggah, bukan dari akun
> dengan data pribadi asli. Pakai data contoh bila perlu.

---

## 5. Formulir Data Safety

Semua jawaban bisa diambil dari kode, jadi tidak perlu menebak:

| Pertanyaan Play Console | Jawaban |
|---|---|
| Apakah aplikasi mengumpulkan atau membagikan data pengguna? | **Ya** |
| Apakah data dienkripsi saat transit? | **Ya** - semua koneksi lewat HTTPS, dan WebView dikunci `usesCleartextTraffic="false"` |
| Apakah pengguna dapat meminta data dihapus? | **Ya** - lewat hapus akun dari pengaturan aplikasi, atau hubungi email dukungan |
| Data apa yang dikumpulkan? | `Nama`, `Alamat email`, `ID pengguna`, `Data aktivitas aplikasi`, `Data keuangan dan transaksi`, `ID perangkat` |
| Tujuan pemrosesan? | Data diproses oleh pemilik aplikasi (WZ) untuk menyediakan layanan manajemen, dan tidak dijual ke pihak ketiga untuk iklan |
| Apakah dikumpulkan untuk prediksi? | **Tidak** |

Dasar teknis: `web-source/api/` menyimpan data di PostgreSQL (Neon), notifikasi
lewat Firebase Cloud Messaging. `api_key` Firebase pada
`android/app/google-services.json` adalah kunci publik identitas proyek, bukan
rahasia, dan memang wajib ada di dalam APK. Tidak ada kunci rahasia yang
di-commit ke repo.

---

## 6. Content rating

- Kategori Everyone, grup Produktivitas.
- Tidak ada konten berbahaya dari pengguna: aplikasi tidak menyimpan konten yang
  dibuat pengguna, hanya data transaksi dan data karyawan.
- Tidak ada fitur messaging publik. Kolom "Obrolan Owner" bersifat internal
  antar-akun di dalam aplikasi, bukan konten yang dikirim ke publik.
- Aplikasi tidak meminta izin lokasi, kamera, atau penyimpanan.
- content rating akan otomatis mendapat skor rendah karena tidak ada kategori
 dewasa, kekerasan, atau bahasa kasar di dalam aplikasi.
