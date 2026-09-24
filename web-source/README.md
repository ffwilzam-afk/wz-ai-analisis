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

Tabel dibuat/di-upgrade otomatis oleh `ensureSchema()` saat request pertama: `wz_businesses`, `wz_branches`, `wz_employees`, `wz_users`, `wz_sessions`, `wz_transactions`, `wz_shift_reports`, `wz_subscriptions`, `wz_subscription_orders`, `wz_subscription_plans`, `wz_push_subscriptions`, `wz_fcm_tokens`, `wz_app_states`, `wz_user_profiles`, `wz_owner_forum_messages`, `wz_owner_forum_reactions`, `wz_payroll_settings`.

## Web Push & notifikasi
Environment:
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (notifikasi Android)

Buat key VAPID dengan `npx web-push generate-vapid-keys`.

## Endpoint API utama
`ready` · `auth/register` · `auth/login` · `auth/me` · `auth/logout` · `business` · `branches` (GET/POST/PUT/DELETE) · `employees` (GET/POST/PUT/DELETE) · `employees/me` · `transaction` · `transaction/void` · `shift-report` · `app-state` (GET/PUT) · `profile` · `password` · `reset-business` · `sync-business` · `payroll/settings` · `notifications/read` · `push/subscribe` · `push/unsubscribe` · `push/fcm-token` · `push/vapid-public-key` · `owner-forum/messages` · `owner-forum/reactions` · `subscription` · `subscription/order` · `subscription/webhook`

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

## Verifikasi sebelum deploy
```bash
npm run check   # node --check untuk API, helper, dan service worker
npm test        # check + unit test helper + smoke test handler API
```

`npm test` tidak butuh database: modul `pg`, `web-push`, dan `firebase-admin` diganti stub, lalu handler dipanggil dengan request palsu (`/api/ready`, rute tak dikenal, `auth/login` tanpa kredensial, `auth/me` tanpa sesi, `auth/logout`, dan `push/vapid-public-key`).

Workflow `.github/workflows/ci.yml` di root repo menjalankan rangkaian yang sama pada setiap push ke `main` dan setiap pull request.

## Catatan maintenance
- PWA cache hanya untuk shell/static assets. `/api/*` tidak pernah dicache oleh service worker.
- File backup/duplikat (`index-before-*.html`, `index.html.bak-*`, `app/`, `api-backups/`, `tools/`) sudah dihapus karena tidak pernah disajikan dan membuat perubahan mudah salah tempat. Isinya masih ada di riwayat git bila sewaktu-waktu diperlukan.
- `lib/helpers.js` sengaja berada di luar `api/` agar tidak menjadi serverless function tersendiri di Vercel.
- `validMoney()` bersifat ketat: hanya menerima angka atau string numerik yang benar-benar terisi. `null`, `undefined`, `''`, dan string berisi spasi saja ditolak. Perubahan ini menggantikan perilaku lama yang menganggap nilai kosong sebagai Rp0, sehingga payload transaksi/laporan shift yang mengirim nilai kosong sekarang ditolak dengan status 400.
- Pemecahan `api/[...path].js` berjalan bertahap: rute yang sudah dipindah ada di `lib/routes/`, sisanya masih di file catch-all. Kontrak modul rute: `module.exports = async (ctx, req, res, path) => boolean`, mengirim responsnya sendiri, dan dispatcher berhenti ketika `res.writableEnded` bernilai `true`.
- **Penting soal scope di `index.html`.** Bridge online ada di dalam IIFE (`(function(){ ... })();`), jadi fungsi di dalamnya TIDAK global. Aturan: setiap fungsi yang dipanggil dari atribut `onclick`/`onchange` di HTML harus diekspos lewat `window.namaFungsi = namaFungsi`, dan kode di luar IIFE harus memanggil lewat `window.WZOnline...`. Pernah ada 5 fungsi terlewat (termasuk `printTransactionReceipt` dan `savePayrollSettings`) sehingga tombolnya tidak berfungsi, serta `refreshAppData` yang memanggil `hydrateAppState`/`syncBusiness` secara langsung sehingga auto-refresh selalu gagal diam-diam.
