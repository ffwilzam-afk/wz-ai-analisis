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
| `tests/` | Unit test helper + smoke test handler API (tanpa database) |
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
`ready` · `auth/register` · `auth/login` · `auth/me` · `auth/logout` · `business` · `branches` (GET/POST/PUT/DELETE) · `employees` (GET/POST/PUT/DELETE) · `employees/me` · `transaction` · `transaction/void` · `shift-report` · `app-state` (GET/PUT) · `profile` · `password` · `reset-business` · `sync-business` · `payroll/settings` · `payroll/employee` (GET/POST/DELETE) · `notifications/read` · `push/subscribe` · `push/unsubscribe` · `push/fcm-token` · `push/vapid-public-key` · `owner-forum/messages` · `owner-forum/reactions` · `owner-forum/read` (GET+POST) · `owner-forum/polls` · `owner-forum/polls/vote` · `subscription` · `subscription/order` · `subscription/webhook`

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
