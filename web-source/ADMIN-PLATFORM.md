# WZ MANAGE PRO V11 — Admin Platform

Admin Platform tersedia di `/admin.html` dan memakai API catch-all yang sama (`/api/admin/...`) tanpa menambah Serverless Function.

## Authentication

- Admin memakai `wz_admin_session` HttpOnly cookie, terpisah dari `wz_session` tenant.
- Role Admin tidak disimpan di `wz_users` dan tidak dapat dipromosikan dari frontend.
- Tidak ada password default. Akun pertama dibuat secara interaktif:

```bash
cd web-source
npm run admin:provision -- --username admin_nama --name "Nama Admin" --email admin@example.com
```

Script meminta password secara terminal. Jika Terminal workspace tidak tersedia, sementara dapat memakai key `WZ_ADMIN_INITIAL_PASSWORD` melalui Settings → Environment; key tersebut harus dihapus segera setelah provisioning. Script hanya menyimpan hash scrypt dan tidak mencetak password.

Credential Admin yang sudah ada dapat diperbarui dan langsung diperiksa terhadap deployment production tanpa mencetak password:

```bash
npm run admin:provision -- --update --verify-live --current-username admin --username admin --name "Admin WZ Manage" --email admin@wzmanagepro.com
```

## Data dan tenant isolation

- `ADMIN-PLATFORM-V1-MIGRATION.sql` hanya menambahkan tabel/column/index secara non-destruktif.
- Jalankan `npm run admin:preflight` untuk pemeriksaan read-only, lalu `npm run admin:migrate` dengan environment database production yang sudah dikonfirmasi.
- Script migration memakai transaction, advisory lock, lock timeout, dan statement timeout; provisioning tidak menjalankan migration otomatis.
- `npm run admin:verify` menjalankan pemeriksaan server-side dan endpoint read-only dengan sesi sementara yang dibersihkan otomatis; pengujian tidak mengubah data tenant.
- Obrolan Owner memakai `wz_owner_forum_messages` yang sama dan kini memiliki `business_id` serta `sender_admin_id` untuk konteks pengirim.
- Endpoint Owner mengambil user dari session server; pesan Owner dan Admin dalam Obrolan Owner bersifat global sehingga dapat dibaca dan dibalas oleh semua Owner. Data tenant tetap terisolasi pada endpoint bisnis/data Owner lainnya.
- Endpoint Admin hanya dapat dipakai oleh session `wz_admin_session`.
- Notifikasi FCM untuk pesan Owner tetap mengikuti `business_id` pengirim dan hanya dikirim kepada Owner tenant tersebut; pesan Obrolan Owner global tetap tersedia melalui forum.

## Menu Admin

Dashboard, Business, Owner/User, Subscription, Paket, Pembayaran, Obrolan Owner, Notification, Audit Log, dan Pengaturan Sistem tersedia di UI Admin. Dashboard dan tabel menggunakan query server-side dengan pencarian, filter, serta pagination.

Tidak ada endpoint hapus tenant otomatis, tidak ada secret yang dikirim ke frontend, dan perubahan Admin-sensitive masuk ke `wz_admin_audit_logs`.
