# WZ MANAGE PRO — FULL ONLINE

WZ MANAGE PRO menggunakan server/Neon PostgreSQL sebagai sumber data bisnis. Browser tidak lagi menyimpan data aplikasi secara persisten; data bisnis dikelola oleh server.

## Arsitektur online
- Login/logout memakai session HttpOnly dari server.
- Transaksi, VOID transaksi, dan laporan tutup shift disimpan di Neon.
- Dashboard Owner/Manager membaca ulang data server sehingga laporan yang dibuat di Device A dapat tampil di Device B.
- Master karyawan dan akun login dikelola melalui API server.
- Pengaturan, pelanggan, layanan, produk, cabang, profil, pengeluaran, dan data UI Owner/Manager dipersistenkan sebagai state aplikasi server melalui endpoint `app-state`.
- `save()` hanya memperbarui state di memori dan menjadwalkan penyimpanan server; tidak ada browser storage.
- Tidak ada fallback offline untuk transaksi/laporan. Bila server gagal, data tidak dianggap tersimpan.

## Database
Vercel memakai environment variable PostgreSQL Neon. API menerima `WZDATABASE` (prioritas utama), `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, atau `NEON_DATABASE_URL`.

## Web Push
Environment:
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

Buat key dengan `npx web-push generate-vapid-keys`.

## Akun seed
- owner / owner123
- manager / manager123
- rizky / rizky123
- alvin / alvin123
- kyong / kyong123
- iwan / iwan123
- dika / dika123

## Catatan
PWA cache hanya untuk shell/static assets. `/api/*` tidak pernah dicache oleh service worker.

## QA
Sebelum deploy, jalankan:
```bash
node --check api/[...path].js
node --check tools/patch-online.js
node --check tools/online-bridge.js
```
Kemudian pastikan pencarian terhadap API penyimpanan browser tidak menghasilkan referensi pada source runtime.
