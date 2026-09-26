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
- Notifikasi FCM pesan forum memakai `sendOwnerForumPush()`: Obrolan Owner adalah forum bersama, jadi pesan Admin dikirim ke SEMUA Owner aktif lintas tenant (tanpa filter `business_id`), dan pesan Owner dikirim ke Owner lain dengan pengirim dikecualikan. Ini pengecualian terhadap tenant isolation, yang tetap berlaku penuh untuk transaksi, laporan, karyawan, payroll, subscription, cabang, dan data internal tenant lainnya.
- Status unread Obrolan Owner bersifat personal per Owner (`profile.ownerForumSeenAt`): Owner A yang membuka forum tidak mereset unread Owner B/C.
- Posisi bubble Obrolan Owner mengikuti chat normal: pesan milik user yang sedang login tampil di kanan (`.is-mine`, `flex-direction:row-reverse`), pesan user lain dan semua pesan Admin tampil di kiri. Penentuan memakai identitas sesi `currentUser.id` (`wz_users.id` dari `auth/login` dan `auth/me`) yang dibandingkan dengan `senderId` pesan, bukan nama display.
- Profil Admin di Obrolan Owner: nama tetap "Admin WZ Manage", avatar memakai logo aplikasi existing `/icons/icon-192.png` (`ANDROID_NOTIFICATION_ICON`), dan verified badge biru (SVG inline `.owner-forum-verified`) hanya untuk `sender_role` `platform_admin`/`admin`. Karena ketiganya diturunkan dari `senderRole` yang tersimpan di database, avatar dan badge konsisten pada pesan lama/baru, setelah refresh, auto-refresh, maupun logout-login.
- Semua avatar di Obrolan Owner memakai logo identitas aplikasi Android/APK: `web-source/icons/app-logo.png`, yaitu salinan persis `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` (launcher icon APK). Logonya sudah berbentuk bulat sehingga tidak perlu di-crop dan tidak diubah. Avatar tidak lagi bergantung `senderAvatar` maupun foto pribadi, jadi tetap sama pada pesan lama/baru, refresh, auto-refresh, dan login ulang. `icon-192.png`/`icon-512.png` tetap dipakai untuk PWA/manifest dan icon notifikasi.
- Verified badge Admin bergaya platform sosial modern: lingkaran biru solid `#1877F2` 16px dengan centang putih berupa SVG inline, tanpa gradient/gloss dan tanpa warna gold. Tetap hanya untuk `sender_role` `platform_admin`/`admin`.
- Status read notifikasi bersifat **monotonik di server**. `mergeNotificationsMonotonic()` dipakai saat `PUT /api/app-state`: bila klien mengirim daftar notifikasi yang lebih lama (mis. autosave yang terlambat), notifikasi yang sudah `read` tidak boleh dikembalikan menjadi unread dan notifikasi yang hanya ada di server tidak dihapus. Tanpa aturan ini satu payload basi bisa memunculkan kembali badge notifikasi lama yang sudah dibaca. Notifikasi baru (id baru) tetap masuk sebagai unread.

- Status read notifikasi bisnis dipersist melalui `POST /api/notifications/read` (`{id}` atau `{all:true}`), yang menulis `read`/`readAt` ke `wz_app_states.data.notifications` di dalam transaksi dengan baris terkunci `FOR UPDATE` supaya autosave `app-state` yang berjalan bersamaan tidak menimpanya. Respons mengembalikan daftar notifikasi terbaru agar frontend bisa merekonsiliasi.
- Di frontend, `applyServerNotifications()` membuat status read bersifat monotonik: notifikasi yang sudah pernah ditandai dibaca tidak kembali unread karena hasil load lama yang tiba saat user menekan "Tandai dibaca". Notifikasi baru dari server tetap muncul sebagai unread. Set id read dibersihkan saat `resetTenantState()` (logout/ganti tenant).
- Diagnosis/internal status FCM tidak pernah ditampilkan ke pengguna (`toast()` membuang pesan berlabel FCM). Token FCM, Firebase, permission, service worker, sinkronisasi token, push, dan endpoint `push/fcm-token` tetap berjalan normal.

## Menu Admin

Dashboard, Business, Owner/User, Subscription, Paket, Pembayaran, Obrolan Owner, Notification, Audit Log, dan Pengaturan Sistem tersedia di UI Admin. Dashboard dan tabel menggunakan query server-side dengan pencarian, filter, serta pagination.

Tidak ada endpoint hapus tenant otomatis, tidak ada secret yang dikirim ke frontend, dan perubahan Admin-sensitive masuk ke `wz_admin_audit_logs`.
