# WZ MANAGE PRO — FULL ONLINE

WZ MANAGE PRO menggunakan server/Neon PostgreSQL sebagai sumber data bisnis. Browser tidak menyimpan data aplikasi secara persisten; data bisnis dikelola oleh server.

## Struktur sumber
| Path | Isi |
| --- | --- |
| `index.html` | Seluruh UI aplikasi (SPA berbasis `location.hash`) + online bridge inline |
| `api/[...path].js` | Satu-satunya backend: semua endpoint API (Vercel serverless) |
| `api/<domain>/**.js` | Shim 1 baris yang meneruskan ke `api/[...path].js` |
| `lib/helpers.js` | Helper bersama: hash password, token, cookie, validasi transaksi/shift |
| `lib/routes/*.js` | Modul rute per domain (`auth`, `push`, dan seterusnya) yang dipanggil handler catch-all |
| `tests/` | Unit test helper, smoke test handler API, dan audit UI di jsdom (tanpa database) |
| `sw.js`, `manifest.json`, `icons/` | Dukungan PWA (cache hanya shell/static asset) |
| `vercel.json` | Config Vercel (`/api/:path*` di-rewrite ke `api/[...path]`) |
| `.vercelignore` | File yang tidak diunggah/disajikan Vercel (tes, dokumen, `.env`, file rahasia) |

Online bridge (login, hidrasi state, sinkronisasi transaksi/shift, FCM) berada **inline di `index.html`**. Jangan dibuatkan lagi salinan terpisah — pernah ada `tools/online-bridge.js` + `tools/patch-online.js` yang menulis ke `app/index.html`, dan keduanya tidak lagi tersinkron dengan file yang benar-benar disajikan.

## Arsitektur online
- Login/logout memakai session HttpOnly dari server.
- Transaksi, VOID transaksi, dan laporan tutup shift disimpan di Neon.
- Dashboard Owner/Manager membaca ulang data server sehingga laporan yang dibuat di Device A dapat tampil di Device B.
- Master karyawan dan akun login dikelola melalui API server.
- Pengaturan, pelanggan, layanan, produk, cabang, profil, pengeluaran, dan data UI Owner/Manager dipersistenkan sebagai state aplikasi server melalui endpoint `app-state`.
- `save()` hanya memperbarui state di memori dan menjadwalkan penyimpanan server; tidak ada browser storage.
- Tidak ada fallback offline untuk transaksi/laporan. Bila server gagal, data tidak dianggap tersimpan.

## Multi-tenant & langganan
- Setiap pendaftaran membuat satu bisnis (`wz_businesses`) dengan cabang dan akun owner sendiri.
- Login memakai `username`; bila username sama dipakai di beberapa bisnis, `businessId` wajib diisi.
- Bisnis baru mendapat trial 35 hari. Bila langganan tidak aktif, data bisnis bersifat read-only sampai pembayaran diterima lewat webhook Xendit.
- Migrasi lama tersedia di `MULTI-TENANT-V11-MIGRATION.sql`, `SUBSCRIPTION-V1-MIGRATION.sql`, dan `RESET-LEGACY-WZ001-ONCE.sql`.

## Database
Vercel memakai environment variable PostgreSQL Neon. API menerima `WZDATABASE` (prioritas utama), `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, atau `NEON_DATABASE_URL`.

Tabel dibuat/di-upgrade otomatis oleh `ensureSchema()` saat request pertama: `wz_businesses`, `wz_branches`, `wz_employees`, `wz_users`, `wz_sessions`, `wz_transactions`, `wz_shift_reports`, `wz_subscriptions`, `wz_subscription_orders`, `wz_subscription_plans`, `wz_push_subscriptions`, `wz_fcm_tokens`, `wz_app_states`, `wz_user_profiles`, `wz_owner_forum_messages`, `wz_owner_forum_reactions`, `wz_owner_forum_polls`, `wz_owner_forum_poll_options`, `wz_owner_forum_poll_votes`, `wz_owner_forum_reads`, `wz_payroll_settings`, `wz_employee_payroll`.

## Web Push & notifikasi
Environment:
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (notifikasi Android)

Buat key VAPID dengan `npx web-push generate-vapid-keys`.

## Endpoint API utama
`ready` · `auth/register` · `auth/login` · `auth/me` · `auth/logout` · `business` · `branches` (GET/POST/PUT/DELETE) · `employees` (GET/POST/PUT/DELETE) · `employees/me` · `transaction` · `transaction/void` · `shift-report` · `app-state` (GET/PUT) · `profile` · `password` · `reset-business` (opsional `from`/`to` untuk hapus per periode) · `sync-business` · `payroll/settings` · `payroll/employee` (GET/POST/DELETE) · `notifications/read` · `push/subscribe` · `push/unsubscribe` · `push/fcm-token` · `push/vapid-public-key` · `owner-forum/messages` · `owner-forum/reactions` · `owner-forum/read` (GET+POST) · `owner-forum/polls` · `owner-forum/polls/vote` · `subscription` · `subscription/order` · `subscription/webhook`

## Akun & registrasi
Tidak ada akun seed di kode. Akun owner dibuat lewat `POST /api/auth/register` (nama bisnis, nama owner, nama cabang, username, password), dan akun karyawan dibuat oleh owner/manager dari halaman Karyawan. Daftar akun lama (`owner/owner123`, dst.) sudah tidak berlaku sejak skema multi-tenant.

## Cetak struk (printer thermal)
Nota transaksi dirancang untuk printer struk 1-bit (thermal), bukan printer kantor:

- **Ukuran kertas** bisa dipilih 80mm (area cetak 72mm) atau 58mm (area cetak 48mm), baik dari dialog nota saat mencetak maupun dari halaman **Pengaturan → Ukuran Kertas Struk**. Pilihan ini dipakai lintas perangkat lewat `app-state`.
- Lebar dan ukuran font nota dikendalikan variabel CSS `--wz-receipt-width` dan `--wz-receipt-font`, yang diatur fungsi `applyReceiptPaper()`.
- Saat mencetak, hanya `#wzReceipt` yang tampil (`body *{visibility:hidden}`), halaman memakai `@page{margin:0}`, dan seluruh warna abu-abu dipaksa hitam penuh agar tidak tercetak sebagai pola titik samar.
- **Ukuran halaman tidak dipaksa lewat CSS**, supaya printer roll tidak membuang kertas atau memotong struk. Pilih ukuran kertas gulungan di dialog cetak atau di aplikasi print service.
- Di Android, tombol Cetak Nota memakai `WZAndroid.print()` (Android Print framework). Perangkat memerlukan print service; bila tidak ada, Android menyediakan **Save as PDF**. Untuk printer thermal Bluetooth murah, biasanya perlu aplikasi perantara print service (mis. RawBT) yang menyediakan layanan cetak ESC/POS.

Catatan: printer 58mm menggunakan area cetak sekitar 48mm, jadi teks panjang seperti ID transaksi dapat terpotong. Gunakan 80mm bila struk memuat banyak baris.

## Sistem gaji (payroll)
Tiga lapis, dari paling umum ke paling khusus. Yang tidak diisi di lapis khusus otomatis memakai lapis di atasnya.

| Lapis | Sumber | Dipakai untuk |
| --- | --- | --- |
| Bawaan | `PAYROLL_CATEGORIES` di `index.html` | Nilai sebelum ada pengaturan tenant |
| Umum bisnis | `wz_payroll_settings` | Halaman **Pengaturan Gaji → Aturan Umum** |
| Khusus karyawan | `wz_employee_payroll` | Tombol **Atur Gaji** per karyawan |

- `GET/POST/DELETE /api/payroll/employee` (+ `?employeeId=`) — pengaturan khusus karyawan. `periodStartDay` boleh `null` = ikut pengaturan umum.
- **Setiap owner hanya mengatur karyawannya sendiri.** `business_id` selalu diambil dari sesi, tidak pernah dari body, dan `employee_id` diverifikasi milik tenant tersebut sebelum ditulis. Tes: `tests/payroll-routes.test.js` membuktikan Owner A mendapat 404 untuk karyawan Owner B **dan tidak ada satu pun query tulis yang terkirim**.
- `base_salary` pada `wz_employee_payroll` bernilai `0` berarti "tidak menimpa", bukan "gaji 0". Urutan sumber gaji pokok: pengaturan khusus karyawan → gaji pada data karyawan → pengaturan umum bisnis.
- **Nilai 0 selalu sah** di semua angka aturan (ambang 0 = semua pelanggan dihitung, bonus 0 = bonus dimatikan). Sebelumnya `||` dipakai sehingga 0 diam-diam diganti bawaan.
- Periode gaji bersifat setengah terbuka: `[tanggal mulai, tanggal mulai berikutnya)`. Tanggal mulai periode **sudah milik periode berikutnya**, jadi tidak ada transaksi yang terhitung di dua periode.
- Transaksi POS pada tanggal yang sama dengan laporan tutup shift karyawan diabaikan untuk komisi, karena laporan shift adalah catatan karyawan sendiri. Tanpa ini satu pekerjaan bisa dibayar dua kali.
- **Kategori gaji ada di master layanan** (`payrollCategory`), bukan ditebak dari nama. Data lama tanpa kategori masih dicocokkan dari nama sebagai cadangan.
- Halaman **Pengaturan Gaji → Layanan Master Owner** mencerminkan data layanan tenant itu sendiri: layanan dikelompokkan per kategori, dan layanan yang belum berkategori ditandai **tidak mendapat bonus** beserta dropdown untuk mengaturnya langsung di sana. Dialog **Atur Gaji** per karyawan juga menyebut layanan apa saja yang masuk tiap kategori.
- Dropdown **Kategori gaji** selalu menampilkan keadaan sebenarnya, termasuk opsi **Belum diatur** untuk layanan yang belum punya kategori. Sebelumnya tidak ada opsi kosong sama sekali, sehingga browser otomatis menyorot opsi pertama (Haircut) untuk layanan yang belum berkategori: layar berbohong, dan memilih ulang Haircut tidak memicu event `change` sehingga kategori tidak pernah tersimpan.
- Layanan yang hanya cocok lewat nama (mis. "Gundul") tetap dihitung, tetapi ditandai **belum diatur, dicocokkan dari nama** supaya jelas bonusnya berasal dari pencocokan cadangan, bukan dari pilihan Owner.
- Form **Tambah/Ubah Karyawan** tidak lagi menampilkan blok "Aturan Bonus Upah" dengan angka hardcode. Aturan bonus hanya diatur di **Atur Gaji** (khusus karyawan) dan **Aturan Umum** (umum bisnis).
- Tes: `tests/payroll.test.js` memuat `index.html` di jsdom dan memanggil engine aslinya, jadi regresi di sini tertangkap `npm test`.

## Validasi laporan tutup shift (role karyawan)

Aturan bentuk dan angka laporan tutup shift hidup di satu tempat: `normalizeShiftReport()` di `lib/helpers.js`. Endpoint `shift-report` (dipakai form karyawan) dan `sync-business` sama-sama memakainya, jadi data yang masuk database selalu bentuknya sama. Di sisi perangkat, pasangan statisnya adalah `readShiftReportForm()` di `index.html`; kedua jalur simpan -- lokal maupun online -- memakai fungsi itu, sehingga data salah ditolak di perangkat dengan pesan yang menyebut field-nya, bukanditeruskan ke server.

**Angka turunan dihitung ulang, bukan dipercaya.** `totalPayment`, `expectedCash`, `cashDifference`, `serviceTotal`, `productTotal`, dan `totalOmzet` dihitung dari angka mentah form. Nilai yang dikirim klien tetap dibandingkan sebagai klaim, dan kalau beda lebih dari Rp1 laporan ditolak dengan pesan yang menyebut kedua angkanya. Sebelumnya angka turunan itu ditulis apa adanya dari body, sehingga laporan berisi Rp300.000 bisa menyimpan `totalOmzet` Rp999.999.999 -- angka yang justru dibaca Owner, mesin payroll, dan laporan pajak.

Aturan yang ditegakkan:

| Field | Aturan |
| --- | --- |
| `date` | Format `YYYY-MM-DD`, tanggal benar-benar ada di kalender, tidak di masa depan, maksimal 366 hari ke belakang |
| `shiftType` | Harus salah satu dari `Full Shift`, `Pagi`, `Siang`, `Sore` |
| `customers` | Bilangan bulat, tidak negatif, maksimal 100.000 |
| `openingCash`, `cash`, `qris`, `cashExpense`, `physicalCash` | Angka rupiah bulat, tidak negatif |
| `services[]` | Array; `qty` bilangan bulat > 0; `price` >= 0; `total` harus sama dengan `qty x price`; `serviceId` wajib ada; `payrollCategory` ikut disimpan sebagai snapshot |
| `products[]` | Array; `name` wajib; `qty` bilangan bulat >= 0; `price` >= 0; `total` harus sama dengan `qty x price` |
| `note` | Teks, maksimal 2.000 karakter |
| selisih kasir | `physicalCash - (openingCash + cash - cashExpense)` harus Rp 0 (toleransi Rp1 untuk derau floating point) |
| nama karyawan | Diambil dari data karyawan di server, bukan dari body klien |

Pesan error juga diperbaiki. Sebelumnya nilai negatif pada kas awal atau pengeluaran kas lolos ke perhitungan dan dilaporkan sebagai "selisih kasir harus Rp 0" -- penyebabnya (tanda minus) tidak pernah disebut. Sekarang nilai kas dicek lebih dulu dan pesannya langsung menunjuk field-nya.

Tes: `tests/shift-report-validation.test.js` (10 tes) mengirim 20 payload salah dan 12 isian form salah lewat jalur HTTP dan jsdom, lalu memastikan **tidak ada satu pun query INSERT yang terkirim** saat data ditolak. Dua tes terakhir mengunci bentuk kodenya (endpoint tidak boleh kembali menulis angka turunan dari body; kedua jalur simpan wajib lewat validasi bersama) supaya perbaikan ini tidak bisa hilang diam-diam.

## Reset laporan tutup shift per periode

Menu **Sistem & Data -> Reset Laporan Tutup Shift** (Khusus Manager/Owner) punya dua pilihan:

- **Semua periode** -- perilaku lama: hapus seluruh transaksi dan seluruh laporan tutup shift.
- **Pilih periode (tanggal)** -- hanya data pada rentang `Dari` sampai `Sampai` yang dihapus.

Kolom `Dari` dan `Sampai` terkunci sampai mode periode dipilih. Begitu dipilih, `Dari` terisi otomatis dengan tanggal data paling lama yang ada dan `Sampai` dengan hari ini, dan teks ringkasan selalu menyebut berapa transaksi serta berapa laporan tutup shift yang akan hilang -- jadi angka yang terlihat sebelum menekan tombol bukan lagi tebakan. Mengubah tanggal langsung memperbarui ringkasan.

Perjalanan datanya:

- `shiftResetPeriod()` membaca form dan menolak rentang yang tidak lengkap atau terbalik sebelum ada request apa pun.
- `window.WZOnlineBusiness.reset({from, to})` mengirim body JSON hanya kalau kedua tanggalnya valid. Tanpa `from`/`to`, body kosong -- jadi reset penuh tetap bekerja seperti sebelumnya.
- Endpoint `POST /api/reset-business` memvalidasi ulang di server: salah satu tanggal kosong, format di luar `YYYY-MM-DD`, tanggal yang tidak ada di kalender, atau tanggal awal melewati tanggal akhir semuanya ditolak dengan `400 RESET_PERIOD_INVALID` dan **tidak ada satu pun `DELETE` yang terkirim**. Perhatikan bahwa hanya satu tanggal yang dikirim tidak dianggap "hapus semua" -- requestnya ditolak.
- Komponen `date` di `wz_transactions` dan `wz_shift_reports` bertipe `DATE`, jadi batas periode ditulis `date >= $2::date AND date <= $3::date` supaya tidak bergantung pada tipe parameter.
- State lokal disaring dengan rentang yang sama, jadi layar tidak sempat menampilkan data yang sudah dihapus. Baris di luar periode tetap utuh di perangkat maupun di server.

Jalur ini tidak menyentuh data lain: karyawan, cabang, pelanggan, layanan, pengeluaran, absensi, pengaturan, dan langganan tidak ikut terhapus.

Tes: `tests/reset-shift-period.test.js` (10 tes) memanggil handler sungguhan dengan pool palsu yang mencatat SQL-nya, lalu memastikan batas tanggal benar-benar ikut terkirim, empat bentuk periode tidak valid ditolak tanpa `DELETE` apa pun, dan bentuk kode sisi UI terkunci.

## Notifikasi & chat: hanya sejak akun dibuat

Notifikasi bisnis dan Obrolan Owner dimiliki oleh **bisnis**, tapi setiap akun hanya boleh melihat apa yang terjadi **sejak akun itu dibuat**. Batasnya adalah `wz_users.created_at`.

Gejalanya sebelum diperbaiki: akun baru yang ditambahkan ke bisnis yang sudah lama langsung melihat seluruh riwayat notifikasi bisnis sebagai belum dibaca (badge langsung penuh), ditambah seluruh chat Owner dari tenant lain. Semuanya terjadi sebelum akunnya ada, jadi bukan miliknya.

Perbaikannya:

- `authUser()` sekarang juga mengambil `u.created_at AS "createdAt"`, jadi batasnya tersedia di setiap rute.
- `filterSinceAccount(list, since)` di `api/[...path].js` menyaring notifikasi memakai `createdAt` (dibuat server) atau, kalau tidak ada, `date` (dibuat perangkat, `YYYY-MM-DD`). Notifikasi tanpa keduanya dibiarkan, supaya tidak ada notifikasi sah yang ikut hilang.
- Saringan yang sama dipakai di tiga tempat: `GET /api/business`, `GET /api/app-state`, dan balasan `POST /api/notifications/read`. Yang terakhir penting karena "tandai dibaca" mengembalikan daftar penuh -- tanpa saringan, menekan tombol itu akan memunculkan kembali notifikasi lama.
- Chat Owner memakai batas waktu yang sama di SQL: `AND ($4::timestamptz IS NULL OR m.created_at>=$4)` untuk `owner-forum/messages`, dan `$3` untuk hitungan unread di `owner-forum/read`. Karena forum bersifat lintas tenant, tanpa batas ini akun baru melihat seluruh riwayat obrolan.
- Akun tanpa `createdAt` tidak disaring apa pun -- lebih baik menampilkan terlalu banyak daripada menyembunyikan notifikasi milik akun sendiri.

Data lama tidak dihapus dari database. Notifikasi tetap tersimpan di `wz_app_states`, hanya tidak dikirim ke akun yang belum berhak melihatnya.

## Pengaturan gaji tidak ikut di app-state

Bug: "Simpan pengaturan gaji tidak benar-benar berhasil tersimpan." Nilai yang baru disimpan Owner **berubah sendiri** di layar.

Akar masalahnya bukan di endpoint `payroll/settings` -- permintaan simpannya benar dan database juga benar. Yang salah adalah `payrollSettings` ikut di dalam `appStateSnapshot()`, jadi ia ikut dikirim ke `app-state` bersama blob state bisnis lainnya. Akibatnya:

1. `queueAppStateSave()` menulis ulang salinan gaji ke `wz_app_states`.
2. Auto-refresh 30 detik kemudian memanggil `hydrateAppState()`, yang menimpa `db.payrollSettings` dengan salinan basi itu.
3. Layar menampilkan angka lama, dan perubahan Owner berikutnya ditulis berdasarkan angka yang sudah salah.

Akar masalah yang sama berlaku untuk pengaturan khusus karyawan (`db.payrollSettings.employees`).

Perbaikannya: `payrollSettings` dikeluarkan dari snapshot dan diabaikan saat load.

- `NON_BUSINESS_KEYS` di `index.html` bertambah `payrollSettings`, jadi `appStateSnapshot()` tidak pernah memuatnya.
- `hydrateAppState()` menghapus `payrollSettings` dari state server sebelum `Object.assign`, sehingga blob lama yang sudah terlanjur menyimpan gaji tidak bisa menimpa nilai yang benar.
- `stripAppStatePayroll()` di server membersihkan `payrollSettings` saat `GET /api/app-state`, dan `app-state` `PUT` menghapus key itu dari body yang ditulis -- termasuk dari klien versi lama yang masih mengirimkannya. `Object.assign` tidak bisa dipakai untuk ini karena tidak pernah menghapus key, hanya menimpa.
- `refreshAppData()` kini menyinkronkan ulang `payroll/settings` dan `payroll/employee` untuk Owner/Manager supaya perubahan dari perangkat lain langsung terlihat.

Sumber kebenaran pengaturan gaji tetap hanya dua tabel: `wz_payroll_settings` (umum) dan `wz_employee_payroll` (per karyawan), keduanya hanya diubah lewat endpoint `payroll/*`. Aturan perhitungan gaji tidak disentuh sama sekali.

Tes: `tests/account-scope-and-payroll.test.js` (12 tes) menjalankan handler sungguhan dengan pool palsu untuk memastikan batas notifikasi bekerja di ketiga endpoint dan `payrollSettings` benar-benar hilang dari blob yang ditulis, lalu menjalankan aplikasi penuh di jsdom untuk memastikan nilai gaji yang disimpan tetap utuh setelah auto-refresh.

## Dialog aplikasi (confirm/alert bawaan membocorkan URL)

`confirm` dan `alert` bawaan browser, saat dipanggil dari dalam WebView Android, memunculkan **dialog sistem** yang judulnya diambil dari halaman yang sedang dimuat. Karena judul halaman kosong, WebView memakai alamatnya -- sehingga `wz-ai-analisis-rust.vercel.app` ikut terbaca. Symptom-nya: menghapus karyawan memunculkan dialog bertuliskan alamat web view. `MainActivity` memasang `WebChromeClient` kosong, jadi tidak ada yang WattsApp itu.

Semua dialog kini milik aplikasi sendiri:

- `konfirmasi(pesan, {judul, okLabel, danger})` -- mengembalikan `Promise<boolean>`. Dijalankan lewat `await`, jadi enam pemanggilan `confirm` (hapus karyawan, void transaksi, reset online, restore backup, hapus semua data, reset password owner) ikut jadi `async`.
- `peringatan(pesan, {judul})` -- menggantikan 41 `alert`. Nilai balik `alert` tidak pernah dipakai, jadi `peringatan` boleh tidak memblokir tanpa mengubah alur kode.
- `wzResolveDialog()` menyelesaikan promise; tombol BACK Android ikut membatalkan dialog lewat handler `popstate`, jadi alur yang menunggu tidak pernah menggantung.
- Dialog baru menggantikan dialog lama (yang tertimpa dianggap batal), dan pesan pengguna selalu di-escape -- `peringatan('<img src=x onerror=...>')` tetap tampil sebagai teks.

**`admin.html` dapat perlakuan yang sama**, termasuk penghapusan wrapper `confirmStatus()`.

### z-index modal

`.modal` dinaikkan ke `300` (dari `50`) dan `.toast` ke `310` (dari `70`). Alasannya bukan estetika: `.login-screen` ber-`z-index:100` dan `.wz-startup-loading` ber-`z-index:200`, sedangkan formulir pendaftaran berada di dalam `.login-screen`. Dengan nilai lama, peringatan "Pendaftaran berhasil! Kode Bisnis: ..." akan tampil **di belakang** layar login -- dialog native selalu ada di atas, dialog aplikasi tidak. Ada tes yang membandingkan angka-angka ini supaya tidak diturunkan diam-diam.

### Pencegahan

`tests/webview-dialogs.test.js` memindai `index.html` dan `admin.html` (komentar dikecualikan) dan **gagal** kalau ada `alert`/`confirm`/`prompt` bawaan yang dipakai lagi, atau kalau ada yang mencetak `location.href` ke pengguna. Jadi menambahkan `confirm()` di kemudian hari tidak bisa lolos ke rilis tanpa ketahuan.

## Tampilan khusus Android: tabel jadi kartu

Semua tabel punya `min-width:700px`. Di HP 360px itu **selalu** berakhir jadi geser-horizontal -- dan itu komplain yang paling sering masuk dari pengguna Android. Di bawah ambang lebar tertentu (600px di aplikasi, 650px di panel admin, mengikuti titik di mana layout masing-masing berubah) tiap baris tabel dirender sebagai kartu:

- `wzApplyCardMode()` di `index.html` dan `admin.html` membaca nama kolom dari `<thead>` lalu ditempel ke setiap sel sebagai `data-wz-th`.
- CSS menampilkannya lewat `content:attr(data-wz-th)`, jadi tiap sel jadi "**Total** · Rp50.000".
- Label selalu ditempel; keputusan menampilkannya ada di CSS. Ini disengaja supaya perilakunya bisa diuji di jsdom tanpa meniru media query.
- Baris rekap yang cuma punya satu sel ber-`colspan` (mis. baris total analitik, atau "Belum ada transaksi") ditandai `wz-card-summary` dan jadi blok catatan penuh lebar -- bukan kartu yang labelnya salah.
- Fungsi ini jalan untuk **setiap** tabel, jadi tabel yang dibuat berikutnya ikut rapi tanpa perlu menambah kode. `MutationObserver` pada `#content`, `#dialog`, dan `#modalBody` menutup tabel baru yang masuk lewat render, dialog, dan panel admin.

Yang sengaja tidak diubah: `min-width:700px` di `.table` tetap di luar media query, jadi tabel di laptop dan tablet **tidak berubah sama sekali**. Baris `onclick` dan tombol aksi tetap berfungsi, dan `filterTransactions()` tetap menyembunyikan baris lewat inline `display:none` (inline style menang atas aturan CSS).

Sekalian di layar kecil: `.quick-grid` turun dari 5 ke 3 kolom, `.kpis` dirapatkan, `.section-head` jadi menumpuk dengan tombol selebar layar, dan `.detail-grid` jadi 2 kolom supaya halaman detail laporan shift tidak memanjang.

## Teks tidak bisa diseleksi: kesan aplikasi native

APK Android memuat halaman ini di WebView, jadi tanpa penanganan tambahan perilakunya persis seperti situs: **tekan-tahan pada teks menyorot kata, memunculkan "Salin"**, dan teks bisa diseret. Itulah keluhan yang bikin aplikasi terasa seperti website.

Dua lapis, keduanya di `index.html` dan tidak menyentuh layout, z-index, atau logika bisnis:

- **CSS**: `user-select:none` + `-webkit-touch-callout:none` dipasang pada container aplikasi -- `html,body`, splash, layar login, `#mainApp`, `.wz-bottom-nav`, `.modal`, dan `.toast`. Sifatnya diwarisi, jadi semua teks turunan ikut tidak bisa diseleksi tanpa perlu menulis aturan per elemen. Kolom isian (`input`, `textarea`, `select`, `option`, `contenteditable`) dikembalikan ke `user-select:text` di aturan berikutnya, jadi form tetap normal dipakai.
- **JS**: penjaga `contextmenu`, `dragstart`, dan `selectstart` dipanggil dengan `preventDefault()` kecuali target-nya kolom isian. Lapis ini wajib karena WebView Android masih menyorot teks walau `user-select` sudah `none`.

Buka Wali untuk teks yang memang harus bisa disalin: tambahkan kelas `wz-copyable` pada elemennya (dipakai di CSS dan di penjaga JS). Kalau ini nanti diubah, `user-select:none` **harus** tetap diwarisi ke bawah dan kolom isian harus tetap dikecualikan -- jangan dipasang per-elemen satu-satu.

Tes: `tests/native-feel.test.js` (4 tes) memeriksa bentuk aturan CSS (termasuk urutan `none` sebelum `text`), keberadaan ketiga penjaga event, lalu menjalankan penjaga itu di jsdom: `contextmenu`/`dragstart`/`selectstart` pada teks biasa diblokir, sedangkan pada `input`, `textarea`, dan `.wz-copyable` tetap lolos.

## Tanda loading: hanya di tombol yang sedang menjalankan perintah

Audit tombol di `index.html` menunjukkan hampir tidak ada aksi yang memberi umpan balik. Indikator "Tersimpan online" di topbar justru disembunyikan di HP (kelas `.wz-top-hidden`), jadi di Android **tidak ada apa pun** yang memberi tahu pengguna bahwa tombolnya masih bekerja di server. Sebagian aksi sinkron (`saveService`, `saveExpense`, `saveSettings`, `saveCustomer`) bahkan langsung menutup dialog dan menampilkan toast sukses padahal tulisannya ke server masih berjalan di latar.

Perbaikannya **hanya di tombol yang ditekan**:

- `window.fetch` dibungkus satu kali (`wzWatchRequests`) hanya untuk **menghitung** permintaan yang sedang berjalan, lalu `wzInstallBusyFeedback()` membungkus daftar aksi di `WZ_BUSY_ACTIONS` (29 nama). Tombol yang ditekan dapat kelas `.wz-busy` (isi tombol diganti spinner), `aria-busy`, dan `disabled=true` supaya tidak bisa terkirim dua kali. Nama aksi dipasang sebagai `title` (tooltip di layar lebar) dan dikembalikan seperti semula setelah selesai.
- Tombol baru dibuka setelah **tidak ada lagi permintaan yang menggantung**, bukan hanya setelah fungsinya selesai.

**Tanda di luar tombol SENGAJA tidak ada.** Percobaan pertama memakai pil "Menyimpan..." mengambang di tengah bawah, tapi simpan latar (auto-refresh 30 detik, FCM, `save()` 250ms) membuatnya **berkedip berulang** persis seperti yang dilaporkan, dan `aria-live` membuat pembaca layar mengulanginya terus. Pil itu dihapus; `tests/loading-feedback.test.js` mengunci ketiadaannya (`id="wzNet"`, `.wz-net`, `wzNetText`/`wzNetPaint`/`wzNetBegin`/`wzNetEnd`, dan `aria-live` tidak boleh muncul lagi).

Cara pasangnya tanpa `data-busy` di HTML: tombol yang diketuk dicatat listener capture (`wzRememberTap`, lalu dibersihkan di task berikutnya supaya pemanggilan dari timer tidak ikut memakai tombol lama), lalu pembungkus aksi memakainya. Jadi tombol yang dibuat belakangan di dalam dialog pun ikut dapat tanda tanpa disentuh.

Batas tunggu ada dua, supaya aplikasi tidak pernah terkunci: `WZ_BUSY_LIMITS.idle` (40 x 80ms) untuk permintaan yang masih menggantung setelah aksi selesai, dan `WZ_BUSY_LIMITS.hard` (20 detik) sebagai pagar pengaman terakhir kalau promise aksi tidak pernah selesai.

Yang SENGAJA tidak diberi tanda: `login` dan `logout` (keduanya meneruskan ke `window.login`/`window.logout`, jadi dibungkus akan memanggil dirinya sendiri terus-menerus; keduanya sudah punya teks "MEMASUK..." sendiri), `submitRegisterBusiness` (sudah punya `setActionLoading`), tombol yang hanya membuka dialog atau menutup modal, `printTransactionReceipt` (dialog print Android), dan `requestNotificationPermission` (dialog izin browser).

Tes: `tests/loading-feedback.test.js` (10 tes) menjalankan blok status proses dari `index.html` di jsdom dengan fetch yang dikendalikan penuh. Yang diuji: spinner + `disabled` + `aria-busy` selama perintah berjalan, tooltip label dikembalikan utuh, tombol terbuka lagi setelah gagal, aksi sinkron (`saveService`) juga dapat tanda dan menunggu permintaannya, permintaan latar dihitung tanpa memunculkan apa pun, dan kedua batas tunggu melepas tombol. `login`/`logout` diuji tidak terbungkus.

Belum diterapkan di `admin.html` (panel admin) -- tombolnya masih seperti sebelumnya.

## Toast "tersimpan" harus jujur (aksi sinkron)

Enam aksi di `index.html` menutup dialog lalu langsung `toast('... tersimpan.')`, padahal `save()` baru menulis ke server di latar belakang: aksi tidak pernah menunggu, jadi toast sukses bisa muncul padahal datanya belum sampai. Di HP tidak ada apa pun yang memperlihatkan keadaan aslinya, jadi Owner bisa mengira pengaturannya sudah aman.

`saveReportThenToast(promise, okMessage, failMessage)` menunda toast sampai `save()` menjawab. `save()` sudah mengembalikan `Promise<boolean>` (`true` = benar-benar tersimpan), jadi helper ini tinggal memakainya:

- Gagal: `toast(failMessage + alasan, true)` -- alasannya diambil dari `lastSaveError` (konflik versi, langganan tidak aktif, state kebesaran), bukan tebakan "periksa koneksi". Pola ini sudah dipakai `setServicePayrollCategory()` dan sekarang disamakan untuk **tambah layanan, ubah layanan, pengeluaran, pengaturan, pelanggan, dan absensi**.
- Sukses: toast seperti sebelumnya, hanya sekarang muncul setelah server mengonfirmasi.
- **Role karyawan dikecualikan.** Mereka tidak memakai `app-state`, jadi `queueAppStateSave()` selalu mengembalikan `false` untuk mereka. Tanpa pengecualian ini, setiap absensi karyawan akan berbunyi "gagal". Jalur karyawan di `saveCustomer()` memang sudah `await` endpoint sendiri, jadi tidak memakai helper ini.

Transaksi dan laporan shift **tidak** ikut memakai helper: keduanya sudah punya jalur async sendiri yang menunggu server, dan tidak lewat `save()`.

Tes: `tests/save-failure-toast.test.js` (8 tes) menjalankan helper di jsdom dengan `toast` dan `currentUser` palsu: toast sukses ditunda sampai jawabannya datang, gagal memunculkan pesan + alasan, exception juga dilaporkan, role karyawan tetap melihat sukses, dan enam aksi di atas terkunci memakai helper (bukan toast langsung) sementara `saveTransaction`/`saveShiftReport` dikunci **tidak** memakainya.

## Menu geser menutup sendiri saat diketuk di luar

Ikon garis tiga membuka sidebar, tapi di HP **mengetuk di luar menu tidak menutupnya** -- menu tetap menempel sampai ikon ditekan lagi. Penyebabnya `toggleMenu()` hanya membalik kelas `open`, sedangkan `closeMobileMenu()` sudah ada tapi tidak pernah dipanggil dari mana pun.

- **Penedup layar** `#wzScrim` (`position:fixed`, `inset:0`, `z-index:19`) muncul bersama menu. Angkanya disengaja: di atas konten (`topbar` 10) tapi di bawah sidebar (20) dan modal (300), jadi area yang ditutup penedup selalu bagian layar di luar menu.
- **Listener klik fase capture** `sidebarDismiss` pada `document`. Ketukan di luar sidebar dan di luar tombol hamburger menutup menu **tanpa membatalkan ketukan itu sendiri**, jadi ketukan tetap sampai ke halaman atau bottom nav di bawahnya. Ketukan di dalam sidebar tidak menutup apa-apa.
- **Escape** menutup menu, untuk pemakaian di laptop dan keyboard.
- **`go()`** menutup menu setiap pindah halaman, jadi memilih menu di sidebar tidak meninggalkan sidebar terbuka.
- Tombol hamburger memakai `aria-expanded` + `aria-controls="sidebar"`, jadi status terbuka-tertutup terbaca pembaca layar.

Yang tidak berubah: lebar sidebar 252px, posisinya `fixed`, dan `padding-bottom:calc(68px + env(safe-area-inset-bottom))` di bawah 600px (lihat bagian Menu keluar akun di Android). Bottom nav tetap `z-index:1200` di atas sidebar seperti sebelumnya.

Tes: `tests/sidebar-outside-close.test.js` (9 tes) memeriksa bentuk CSS penedup (z-index di antara sidebar dan modal, benar-benar menutup layar), listener capture, Escape, dan `go()`; lalu menjalankan fungsi yang sama di jsdom untuk mengukur perilakunya -- ketukan luar menutup tanpa membatalkan ketukan, ketukan dalam tidak menutup, hamburger masih bisa menutup.

## Menu keluar akun di Android

Keluar akun di HP tidak bisa disentuh: di bawah 600px navigasi pindah ke **bottom nav tetap** (`.wz-bottom-nav`, `position:fixed`, `z-index:1200`, tinggi `68px`), sementara tombol "Keluar" hanya ada di dasar sidebar yang `z-index:20`. Akibatnya 68px paling bawah sidebar tertutup bar ikon, dan karena menu geser itu tidak bisa digulir ke bawah, tombolnya benar-benar tidak terlihat.

Dua perbaikan, tanpa menyentuh struktur bottom nav:

- Sidebar dapat `padding-bottom:calc(68px + env(safe-area-inset-bottom))` di bawah 600px, jadi tombol keluar bisa digulir keluar dari bayangan bar ikon. Snackbar `.toast` (yang tadinya `bottom:18px`, juga tertutup bar ikon) dinaikkan ke `calc(68px + 14px + env(safe-area-inset-bottom))` dan dibuat selebar layar.
- **Halaman Profil** sekarang punya kartu **Sesi** dengan tombol **Keluar Akun** (`#wzLogoutButton`). Jadi keluar akun tidak bergantung pada menu geser sama sekali. Tombol ini memanggil `requestLogout()`, yang konfirmasi dulu lewat `konfirmasi()` lalu menjalankan `logout()` seperti biasa -- jadi tidak ada alur keluar kedua yang bisa berbeda. Semua role (Owner, Manager, Karyawan) sudah punya akses halaman Profil.

Tes: `tests/mobile-logout-access.test.js` (9 tes). jsdom tidak menghitung layout, jadi aturan CSS dibaca dari bentuk sumbernya -- tinggi bottom nav, `z-index`, dan nilai `padding-bottom` sidebar dibandingkan satu sama lain, sehingga mengubah tinggi bar ikon tanpa menyesuaikan ruang bawah akan gagal tes. Sisanya menjalankan `index.html` di jsdom: tombol Profil ada untuk tiga role, diklik -> dialog konfirmasi muncul -> "KELUAR" memanggil `logout()` tepat sekali, dan "BATAL" tidak mengeluarkan akun.

Tes: `tests/responsive-tables.test.js` (8 tes) menjalankan `index.html` di jsdom dan memeriksa pelabelan kolom pada tabel transaksi, penanganan baris `colspan`, pemicu otomatis untuk tabel yang dibuat belakangan, tabel riwayat analitik, klik tombol Detail, filter pencarian, dan bentuk blok CSS-nya.

## Grafik Layanan Terlaris & Top Barber (dashboard Owner)

Dua kartu di **GRAFIK BISNIS** -- `GRAFIK LAYANAN TERLARIS` dan `GRAFIK TOP BARBER` -- sebelumnya hanya menghitung **bucket terakhir** dari rentang grafik, yang default-nya adalah **hari ini**:

```js
const selectedBucket=graphBuckets[graphBuckets.length-1];
const selectedRows=feed.filter(x=>selectedBucket&&dashboardInRange(x.date,selectedBucket.start,selectedBucket.end));
```

Begitu tidak ada transaksi pada hari itu, keduanya menampilkan "Belum ada data." Padahal kartu omzet, pengeluaran, dan laba di sebelahnya tetap benar karena memakai seluruh rentang, jadi dashboard terlihat setengah mati. Keadaan "tidak ada transaksi hari ini" justru yang paling sering terjadi: aplikasi dibuka pagi, atau sudah lewat waktu tutup.

Sekarang keduanya memakai **seluruh rentang yang dipilih** lewat `dashboardGraphRangeBounds()` / `dashboardGraphRangeLabel()` -- rentang yang sama dengan tiga grafik garis, jadi mengubah kolom Dari/Sampai langsung mengubah isi kedua kartu. Subtitle kartu ikut menyebut rentangnya, jadi tidak ada lagi angka yang tidak tahu periodenya.

Perhitungan yang sebelumnya tertulis inline dipindah ke tiga helper supaya kartu grafik dan dialog detail memakai sumber angka yang sama:

- `dashboardServiceCountMap(rows)` -- jumlah terjual per layanan dari POS **dan** laporan tutup shift.
- `dashboardBarberAmountMap(rows)` -- omzet (`value`) dan jumlah layanan (`tx`) per karyawan. Field-nya `value`, bukan `amount`, dan `id` ikut dibawa: peta barber sempat memakai `amount` sementara kartu membaca `value`, dan hasilnya semua bar tampil "Rp 0".
- `dashboardRangeBreakdown(...)` -- rincian per periode di dialog detail, jadi angka rentang penuh masih bisa ditelusuri per hari/minggu/bulan.

Menekan sebuah bar membuka `dashboardGraphDetail('service'|'barber', ...)`. Kartu ranking mengirim **label rentang**, jadi detailnya memakai seluruh rentang dan menambahkan blok *Rincian per periode*. Tiga grafik garis tidak berubah sama sekali: titik masih membuka satu bucket.

Tes: `tests/owner-dashboard-graphs.test.js` (8 tes) menjalankan dashboard di jsdom dengan data yang **sengaja tidak punya transaksi hari ini** -- itulah kondisi yang dulu tidak terlihat sama sekali. Tes memastikan kedua kartu terisi, urutan dan nilainya benar (4 trx Haircut, Rp 350.000 Budi), lebar bar proporsional, subtitle menyebut rentang, rentang tanpa transaksi tetap kosong, dialog rincian terbuka dengan rincian per periode, dan grafik garis tetap satu bucket. Satu penjaga statis menahan kartu ranking agar tidak kembali menghitung dari `graphBuckets[graphBuckets.length-1]`.

## ID karyawan lintas tenant
- `wz_employees.id` adalah **PRIMARY KEY global**: satu ID hanya boleh dimiliki satu bisnis di seluruh database.
- Klien menebak ID berurutan dari jumlah karyawannya sendiri (`E001`, `E002`, ...), jadi dua bisnis bisa sama-sama meminta `E001`. Sebelumnya itu jadi *no-op senyap* — `ON CONFLICT(id) DO UPDATE ... WHERE business_id=EXCLUDED.business_id` tidak menyentuh baris dan tidak memunculkan error, server tetap membalas `200 ok`, dan karyawannya hilang begitu layar disegarkan.
- Sekarang `POST /api/employees` memakai ID dari klien sebagai **saran saja**: kalau ID itu sudah dipakai tenant lain, server membuat ID sendiri dan mengirimkannya lewat `employee.id`. Kalau baris akhirnya tidak ada, server membalas 500, bukan sukses palsu.
- Klien wajib memakai `employee.id` yang dikembalikan server, bukan tebakan lokalnya.
- Tes: `tests/payroll-routes.test.js` — dua bisnis sama-sama meminta `E001`, keduanya tetap tersimpan dengan `business_id` masing-masing.

## Ganti username & password sendiri

Semua pemilik akun (Owner, Manager, Karyawan) bisa mengganti **username** dan **password** miliknya sendiri dari halaman **Profil Saya**.
- `POST /api/account/username` dengan `{currentPassword, username}`. Password lama wajib dimasukkan, karena mengganti username sama bergunanya dengan mengganti password untuk mengambil alih akun. Body tidak menerima `userId`, jadi tidak ada jalan untuk mengganti akun orang lain.
- Aturan username mengikuti `auth/register`: huruf kecil, angka, titik, garis bawah, atau strip, 3-50 karakter. Unik **per bisnis**, bukan global (indeks `wz_users_business_username_uq`) -- username yang sama di bisnis lain tetap boleh karena login sudah membedakan lewat kode bisnis.
- Sesi yang sedang berjalan tidak ikut putus: `wz_sessions` menyimpan `user_id`, bukan username.
- `POST /api/password` (yang sudah ada) untuk mengganti password.
- **Manager sebelumnya tidak punya akses ke halaman `profile`** (`ACCESS.manager`), jadi tidak bisa membuka halaman akunnya sendiri sama sekali. Sudah ditambahkan.
- Tes: `tests/account.test.js` (jalur HTTP dengan stub pg) dan bagian profil di `tests/payroll.test.js` (jalur UI lewat jsdom).

## Password owner di panel admin

`wz_users.password_hash` menyimpan `scrypt(salt + password)` -- satu arah. **Password owner tidak bisa dibaca, bukan karena disembunyikan, tapi karena plaintext-nya memang tidak ada di mana pun.** Karena itu panel admin sengaja tidak punya kolom password, dan tidak akan pernah ada: menambahkannya berarti menyimpan password owner dalam bentuk yang bisa dibaca, yang justru membuat setiap kebocoran database langsung jadi semua credential.

Yang tersedia sebagai gantinya:
- **Kode bisnis** (`wz_businesses.id`) dan **username owner** tampil di tab **Owner / User** dan di detail bisnis.
- `POST /api/admin/users/:id/reset-password` hanya untuk akun **Owner**. Admin bisa menentukan password baru atau membiarkan server membuatkannya, lalu menyampaikannya ke owner. Sesi owner di perangkat lain langsung dicabut (`DELETE FROM wz_sessions`), dan aksinya tercatat di `wz_admin_audit_logs` sebagai `admin.user.reset_password`.
- Mengubah username owner bukan urusan admin; owner melakukannya sendiri lewat halaman Profil.

## Badge unread Obrolan Owner
- Penanda "sudah dibaca" disimpan **di server per user** pada `wz_owner_forum_reads.last_read_at` lewat `POST /api/owner-forum/read` (waktu server yang jadi sumber kebenaran), bukan hanya di `app-state`.
- `GET /api/owner-forum/read` mengembalikan `{lastReadAt, unread}`; `refreshOwnerForumBadge()` memakai angka itu untuk badge `wzChatBadge`.
- Alasannya: `app-state` adalah satu blob JSON per bisnis yang hanya bisa ditulis Owner/Manager dan bisa gagal karena konflik `expectedUpdatedAt`, subscription read-only, atau aplikasi ditutup sebelum debounce 250ms selesai. Akibatnya badge lama muncul lagi setiap aplikasi dibuka ulang, seolah obrolan tidak pernah dibaca.
- `db.profile.ownerForumSeenAt` masih ditulis sebagai cadangan, dan `refreshOwnerForumBadge()` masih punya jalur lama (40 pesan terbaru + timestamp) kalau endpoint `owner-forum/read` gagal — misalnya saat DDL belum sempat dijalankan.

## Audit UI menyeluruh

`tests/ui-audit.test.js` memuat `index.html` dan `admin.html` di jsdom lalu menjalankan **seluruh menu × seluruh role**, semua dialog, dan semua jalur simpan. Tes ini lahir dari audit manual sebelum rilis dan menangkap empat bug nyata yang tidak terlihat dari tes biasa:

1. **Fungsi privat IIFE yang dipanggil script #1.** `payrollSettingsFromServer()` hidup di dalam IIFE bridge, padahal dipakai `payrollSettingsPage()` dan `saveEmployeePayroll()` yang ada di script #1. Hasilnya `ReferenceError` yang tertelan `try/catch`, jadi halaman **Pengaturan Gaji diam-diam jatuh ke nilai bawaan** dan pengaturan Owner tidak pernah terbaca. Fungsi itu sekarang tinggal di script #1. Tes mem statically mencari pola yang sama: fungsi yang dideklarasikan di dalam IIFE tapi dipanggil dari luar harus terjangkau sebagai global.
2. **`ACCESS.manager` tidak punya `payrollSettings`.** Server sudah mengizinkan manager pada `/api/payroll/*`, dan tombol **Atur Gaji** tetap terlihat untuknya -- tapi `guard()` menutupnya sehingga yang muncul hanya toast. Sekarang Manager benar-benar bisa membuka dialognya.
3. **Simpan pertama pada Atur Gaji justru menghapus.** `readPayrollEmployeeForm()` membaca `enabled` hanya dari kotak centang, dan kotak itu tidak tercentang untuk karyawan yang belum punya pengaturan khusus. Jadi `saveEmployeePayroll()` selalu jatuh ke `resetEmployeePayroll()`: semua angka yang diketik Owner dibuang, dan toast-nya berbunyi *"Pengaturan khusus karyawan dihapus"* -- Owners mengira pengaturan mereka sudah tersimpan. Sekarang isian yang ada selalu menang, dan mengetik angka otomatis mencentang kotaknya.
4. **`loadView()` di `admin.html` tidak menangkap kegagalan async.** `return loadDashboard()` di dalam `try` tidak masuk `catch` (catch hanya menangani throw sinkron dan `await`), jadi satu kegagalan jaringan membuat panel admin **menggantung selamanya** di "Memuat data Admin..." tanpa pesan apa pun. Sekarang `return await`, plus pesan error dan tombol Coba lagi.

Audit juga memverifikasi hal-hal yang harus benar, bukan hanya "tidak error": setiap handler `on*` harus punya fungsi global, setiap halaman harus merender isi (dengan data kosong maupun data nyata), dan angka yang diketik Owner harus benar-benar muncul di payload POST.

## Presisi timestamp pada app-state (penyebab "tersimpan tapi hilang")

`wz_app_states.updated_at` bertipe `timestamptz`, jadi `NOW()` menyimpan **mikrodetik**. Nilai yang dikirim klien -- dan yang kembali lagi lewat JSON -- hanya punya **milidetik**, karena objek `Date` di JavaScript tidak menyimpan mikrodetik.

Akibatnya `WHERE business_id=$1 AND updated_at=$3` **hampir tidak pernah cocok**: setiap penyimpanan kedua dan seterusnya dijawab `409 STATE_CONFLICT` dengan pesan *"Data server sudah berubah. Muat ulang sebelum menyimpan"* -- padahal tidak ada yang berubah. Gejalanya: Owner mengubah sesuatu, aplikasi menampilkan "Tersimpan", lalu perubahannya hilang begitu aplikasi ditutup. Semua yang lewat `app-state` terkena: kategori gaji layanan, pengeluaran, pengaturan, dan lainnya.

- `writeAppState()` membandingkan dengan `date_trunc('milliseconds',updated_at) = $3::timestamptz`, sehingga kedua sisi presisi sama tanpa kehilangan proteksi konflik antar-perangkat.
- Pemeriksaan awal di handler membedakan objek `Date` (yang dikirim `pg`) dari teks. `String(date)` menghasilkan *"Sun Nov 07 2026 ..."* yang tidak bisa diparse -- kalau tidak ditangani, setiap simpan ditolak 409.
- **Konflik tidak lagi membuang perubahan.** Dulu `persistAppState()` memanggil `hydrateAppState()` + `render()` saat konflik, yang menimpa perubahan Owner dengan versi server. Sekarang ia mengambil `updatedAt` terbaru lalu mengirim ulang **snapshot yang sama**.
- Error asli kini dibawa sampai ke layar. `api()` menyertakan `code` dari server, dan `setServicePayrollCategory()` menampilkan penyebab sebenarnya, bukan tebakan "periksa koneksi" yang ternyata menyesatkan.
- Tes: `tests/app-state-conflict.test.js`. Salah satunya memeriksa **SQL-nya** secara langsung, karena stub perilaku bisa lulus meski query-nya salah.

## Menyimpan state & balapan dengan auto-refresh

`tests/state-save.test.js` menjalankan aplikasi di jsdom dengan server sungguhan (app-state benar-benar tersimpan), lalu mengukur **apa yang benar-benar tersimpan ke server**.

- **Snapshot diambil saat antrean dibuat, bukan saat timer berbunyi.** `queueAppStateSave()` menunda penulisan 250ms. Selama jeda itu ada tiga pemicu auto-refresh yang bisa memanggil `hydrate()`: timer 30 detik, `visibilitychange` setiap kali aplikasi dibuka lagi dari latar belakang, dan FCM. Kalau salah satu datang di tengah jeda, perubahan Owner tertimpa state lama dari server, dan penulisan yang tertunda mengirim **nilai lama kembali** -- jadi perubahan hilang permanen, bukan sekadar tidak tampil. `hydrateAppState()` juga dilewati selama ada simpan yang masih tertunda.
- **`save()` mengembalikan `Promise<boolean>`** yang true hanya kalau benar-benar tersimpan. `setServicePayrollCategory()` menunggunya, jadi Owner diberi tahu kalau gagal, bukan melihat toast "disimpan" padahal tidak ada yang sampai ke server.
- **Halaman Pengaturan Gaji tidak berkedip lagi.** Placeholder "Memuat pengaturan gaji tenant..." hanya muncul saat halaman benar-benar dibuka, bukan setiap render ulang -- Owner sempat berpikir aplikasinya menyimpan dua kali.

## Ketahanan: data rusak & service worker

`tests/resilience.test.js` mengirim state bermasalah lewat jalur nyata (`app-state` server) dan memastikan aplikasi tidak pernah layar kosong.

- **`normalizeDbState()`** adalah satu penjaga di satu titik, dipanggil saat state server dimuat.Sebelumnya `db` dipakai apa adanya, jadi `services` berupa string atau `customers` berisi `null` langsung memicu `db.x.filter is not a function` di banyak halaman sekaligus. Error itu tidak tertangkap: layar jadi kosong tanpa tombol keluar -- gejala khas "HP freeze setelah update".
- **`payrollRuleBucket()`** tidak pernah mengembalikan `null`. `typeof null` adalah `'object'`, jadi penjaga `typeof x === 'object' && !Array.isArray(x)` meloloskan `serviceRules: null`, lalu pemanggil melakukan `bucket[key]` pada `null` dan seluruh halaman berhenti.
- **Handler detail** (`txDetail`, `customerDetail`, `employeeDetail`) memberi pesan "tidak ditemukan" alih-alih melempar error.
- **Service worker** hanya menyimpan respons sukses sebagai app shell. Sebelumnya halaman error 5xx ikut ter-cache sebagai `/index.html`, jadi pengguna yang sedang offline mendapat halaman error, bukan aplikasi. `/api/*` tetap tidak pernah di-cache.
- **Teks bermusuhan** (nama pelanggan/layanan/karyawan, catatan, notifikasi) selalu berakhir sebagai teks: tes memindai setiap elemen DOM untuk atribut `on*` berisi payload dan untuk elemen `<img>`/`<script>` yang disisipkan. Saat ini tidak ada yang lolos.

## Alur autentikasi

`tests/auth.test.js` menguji login, registrasi, sesi, dan logout dari sisi server:
- Username yang dipakai di dua bisnis mewajibkan **Kode Bisnis**; tanpa itu tidak ada sesi yang dibuat.
- Password salah dan username tidak dikenal mengembalikan **pesan yang sama** (401), supaya tidak bisa dipakai menebak username mana yang terdaftar.
- `normalizeBusinessId()` menyaring ke huruf/angka kapital, jadi upaya SQL injection lewat kode bisnis tidak pernah sampai ke SQL mentah, dan akun bisnis lain tidak bisa dibuka.
- Registrasi membungkus seluruh penulisan dalam satu transaksi, dan password owner tersimpan sebagai hash scrypt -- tidak pernah teks polos.
- `auth/me` tidak pernah menyertakan `password_hash`.

## Verifikasi sebelum deploy
```bash
npm run check   # node --check untuk API, helper, dan service worker
npm test        # check + unit test helper + smoke test handler API
```

`npm test` tidak butuh database: modul `pg`, `web-push`, dan `firebase-admin` diganti stub, lalu handler dipanggil dengan request palsu (`/api/ready`, rute tak dikenal, `auth/login` tanpa kredensial, `auth/me` tanpa sesi, `auth/logout`, dan `push/vapid-public-key`).

Workflow `.github/workflows/ci.yml` di root repo menjalankan rangkaian yang sama pada setiap push ke `main` dan setiap pull request.

## Jaring pengaman lokal (git hook)

Repo ini punya pre-commit hook di `.githooks/pre-commit` yang menjalankan `npm test` dan membatalkan commit kalau test gagal. Karena hook tidak ikut ter-*clone* secara default, aktifkan sekali per clone:

```bash
git config core.hooksPath .githooks
```

Bypass yang disengaja (hanya kalau memang yakin): `git commit --no-verify`.

Hook ini penting karena `npm test` adalah satu-satunya verifikasi otomatis yang benar-benar berjalan pada klon lokal. GitHub Actions menjalankan rangkaian yang sama di setiap push ke `main`, tapi hanya kalau kuota Actions akun tersedia.

## Catatan maintenance
- PWA cache hanya untuk shell/static assets. `/api/*` tidak pernah dicache oleh service worker.
- File backup/duplikat (`index-before-*.html`, `index.html.bak-*`, `app/`, `api-backups/`, `tools/`) sudah dihapus karena tidak pernah disajikan dan membuat perubahan mudah salah tempat. Isinya masih ada di riwayat git bila sewaktu-waktu diperlukan.
- `lib/helpers.js` sengaja berada di luar `api/` agar tidak menjadi serverless function tersendiri di Vercel.
- `validMoney()` bersifat ketat: hanya menerima angka atau string numerik yang benar-benar terisi. `null`, `undefined`, `''`, dan string berisi spasi saja ditolak. Perubahan ini menggantikan perilaku lama yang menganggap nilai kosong sebagai Rp0, sehingga payload transaksi/laporan shift yang mengirim nilai kosong sekarang ditolak dengan status 400.
- Pemecahan `api/[...path].js` berjalan bertahap: rute yang sudah dipindah ada di `lib/routes/`, sisanya masih di file catch-all. Kontrak modul rute: `module.exports = async (ctx, req, res, path) => boolean`, mengirim responsnya sendiri, dan dispatcher berhenti ketika `res.writableEnded` bernilai `true`.
- **Penting soal scope di `index.html`.** Bridge online ada di dalam IIFE (`(function(){ ... })();`), jadi fungsi di dalamnya TIDAK global. Aturan: setiap fungsi yang dipanggil dari atribut `onclick`/`onchange` di HTML harus diekspos lewat `window.namaFungsi = namaFungsi`, dan kode di luar IIFE harus memanggil lewat `window.WZOnline...`. Pernah ada 5 fungsi terlewat (termasuk `printTransactionReceipt` dan `savePayrollSettings`) sehingga tombolnya tidak berfungsi, serta `refreshAppData` yang memanggil `hydrateAppState`/`syncBusiness` secara langsung sehingga auto-refresh selalu gagal diam-diam.
