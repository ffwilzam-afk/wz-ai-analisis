# WZ MANAGE PRO - Panduan Build dan Rilis Play Store

Status rilis saat ini: **versionCode 4 / versionName 1.1.1**, `applicationId`
`com.wzmanagepro.app`, minSdk 29, targetSdk 36.

Workspace cloud Freebuff tidak menyediakan Java, Gradle, maupun Android SDK,
jadi seluruh langkah di bawah harus dijalankan di komputer Anda sendiri.

---

## 0. Ringkasan cepat

| # | Langkah | Di mana |
|---|---|---|
| 1 | Pastikan URL produksi hidup | periksa manual |
| 2 | Buat upload keystore | `bash create-upload-keystore.sh` |
| 3 | Build AAB rilis | `./gradlew clean bundleRelease` |
| 4 | Uji AAB di HP | bundletool |
| 5 | Siapkan listing | `web-source/play-store/` |
| 6 | Closed testing 12 tester x 14 hari | Play Console |
| 7 | Unggah AAB ke produksi | Play Console |

---

## 1. Prasyarat

- JDK 17 atau lebih baru (perintah `keytool` sudah termasuk di dalamnya).
- Android SDK dengan platform API 36 dan build-tools 36.0.0.
- `ANDROID_HOME` dan `ANDROID_SDK_ROOT` diarahkan ke folder SDK tersebut.
- Gradle **tidak** perlu diinstal, repo sudah memuat Gradle wrapper.

---

## 2. URL aplikasi

`START_URL` di `app/src/main/java/com/wzmanagepro/app/MainActivity.java`:

```
https://wz-ai-analisis-rust.vercel.app/
```

Aplikasi ini adalah WebView, jadi **APK tidak pernah perlu di-build ulang
setiap kali web app berubah**. Cukup deploy ke Vercel, lalu naikkan
`versionCode` dan unggah ulang AAB agar pengguna melihat versi terbaru.

Sebelum submit, pastikan:

```bash
curl -I https://wz-ai-analisis-rust.vercel.app/
```

Harus balas `200`. Cek juga `/privacy.html` dan `/sw.js`.

---

## 3. Buat upload keystore (sekali saja)

```bash
cd android
bash create-upload-keystore.sh
```

Skrip tersebut menjalankan `keytool -genkeypair` dan membuat
`keystore/keystore.properties` berisi `storeFile` dan `keyAlias`, lalu
meninggalkan dua baris password kosong untuk Anda isi sendiri.

Buka `keystore/keystore.properties` dan isi:

```properties
storeFile=../keystore/wz-upload.jks
storePassword=ISI_PASSWORD_ANDA
keyAlias=wz-upload
keyPassword=ISI_PASSWORD_ANDA
```

`storeFile` relatif terhadap folder `app/`, itu sebabnya diawali `../keystore/`.
Untuk keystore PKCS12, `storePassword` dan `keyPassword` umumnya sama.

> Folder `android/keystore/` ada di `android/.gitignore`, jadi `.jks` dan
> `keystore.properties` tidak akan pernah ikut ter-commit.
>
> **Simpan salinan `wz-upload.jks` beserta password-nya di tempat kedua.**
> Kalau upload key hilang, aplikasi tidak bisa diperbarui lagi di Play Store.

Bila `keystore.properties` belum ada, build release tetap berjalan tetapi
menghasilkan AAB **unsigned** yang tidak bisa diunggah. Untuk mencoba di
perangkat sebelum keystore siap, pakai `./gradlew assembleDebug`.

---

## 4. Build AAB

```bash
cd android
./gradlew clean bundleRelease
```

Di Windows: `gradlew.bat clean bundleRelease`.

Hasil: `app/build/outputs/bundle/release/app-release.aab`

### Bila ada fitur yang mati setelah minifikasi

Build rilis memakai R8 (`minifyEnabled true` + `shrinkResources true`) supaya
ukuran AAB kecil. Untuk building tanpa minifikasi:

```bash
./gradlew clean bundleRelease -PwzShrink=false
```

Aturan R8 yang wajib sudah ada di `app/proguard-rules.pro`, terutama untuk
`window.WZAndroid.print()` (jembatan cetak struk) dan statis
`notifyNewReport()` yang dipanggil dari service notifikasi.

---

## 5. Verifikasi sebelum unggah

Cek AAB sudah ditandatangani:

```bash
jarsigner -verify -verbose -certs app/build/outputs/bundle/release/app-release.aab
```

Uji AAB di perangkat memakai bundletool:

```bash
bundletool build-apks \
  --bundle=app/build/outputs/bundle/release/app-release.aab \
  --output=/tmp/wz.apks \
  --ks=keystore/wz-upload.jks --ks-key-alias=wz-upload
```

Lalu pasang ke HP yang tersambung:

```bash
bundletool install-apks --apks=/tmp/wz.apks
```

**Wajib uji versi rilis, bukan hanya debug.** Checklist minimal:

- [ ] Login Owner, Manajer, Kasir, dan Barber
- [ ] Simpan satu transaksi
- [ ] Tutup shift dengan selisih kas (harus muncul validasi)
- [ ] Terima notifikasi FCM saat laporan shift baru dibuat
- [ ] Cetak struk dari menu Transaksi (cek jembatan `WZAndroid.print()`)
- [ ] Matikan internet lalu buka aplikasi (layar "Tidak ada koneksi" harus muncul)
- [ ] Tombol BACK dari halaman dalam dan dari halaman utama
- [ ] Ganti orientasi HP saat sedang di aplikasi (tidak boleh logout)

---

## 6. Materi listing

Sudah disiapkan di `web-source/play-store/`:

| Berkas | Ukuran | Status |
|---|---|---|
| `icon-512.png` | 512x512 PNG | siap |
| `feature-graphic.png` | 1024x500 PNG | siap |
| `LISTING.md` | teks | siap, salin ke Play Console |
| `screenshots/` | 2-8 gambar | **perlu Anda ambil sendiri** |

Regenerasi gambar bila perlu:

```bash
cd web-source
python3 tools/patch-play-assets.py      # icon 512 + feature graphic
python3 tools/patch-round-icons.py      # ic_launcher_round.png per density
```

Kedua skrip butuh Pillow (`pip install Pillow`).

`android:roundIcon` menunjuk `@mipmap/ic_launcher_round`. Adaptive icon hanya
ada di `mipmap-anydpi-v26/`, jadi varian PNG wajib tersedia di semua density
untuk perangkat Android 7 dan lebih lama. Kalau `ic_launcher_round.png`
dihapus, build AAB akan gagal.

`LISTING.md` juga memuat jawaban formulir **Data Safety** dan
**Content rating** yang diambil langsung dari kode aplikasi.

---

## 7. Persyaratan Play Console

- `applicationId`: `com.wzmanagepro.app` - minSdk 29 - targetSdk 36
- Akun developer personal yang dibuat setelah 13 Nov 2023 wajib menjalani
  **closed testing minimal 12 tester selama 14 hari berturut-turut** sebelum
  bisa akses produksi. Jadwalkan dari sekarang.
- Akun developer organisasi wajib verifikasi identitas dan alamat (D-U-N-S,
  nomor kontak, dan bukti alamat bisnis).
- Sediakan **akun demo** untuk reviewer Play: satu akun Owner, satu akun Kasir.
  Tuliskan kredensialnya di Play Console, dan pastikan data demo tidak berisi
  informasi pribadi asli.
- Siapkan juga screenshot 9:16 minimal 2 buah, deskripsi, dan URL privacy
  policy (`https://wz-ai-analisis-rust.vercel.app/privacy.html`).

---

## 8. Catatan konfigurasi yang sudah ditangani

- **Dialog native bocor URL.** `WebChromeClient` kosong membuat
  `alert()`/`confirm()`/`prompt()` memakai dialog bawaan Chromium yang
  menampilkan alamat URL. `MainActivity` sekarang menelan `onJsAlert`,
  `onJsConfirm`, dan `onJsPrompt`, karena halaman web sudah menggambar
  dialognya sendiri lewat `konfirmasi()`/`peringatan()`.
- **Predictive back.** `targetSdk 36` memakai predictive back sehingga
  `onBackPressed()` tidak lagi dipanggil di Android 13+. `MainActivity`
  mendaftarkan `OnBackInvokedCallback` dengan logika yang sama, dan
  `onBackPressed()` disimpan sebagai cadangan untuk Android 12 ke bawah.
- **Layar offline.** `onReceivedError` untuk main frame sekarang menampilkan
  halaman "Tidak ada koneksi" berwarna tema aplikasi, bukan halaman error
  WebView yang memamerkan URL.
- **Adaptive icon.** `res/mipmap-anydpi-v26/ic_launcher.xml` dan
  `ic_launcher_round.xml` memakai foreground vektor
  `res/drawable/ic_launcher_foreground.xml` plus latar `#08090B`. Ikon PNG
  lama tetap dipakai di Android 7 dan lebih lama.
- **Backup data.** `allowBackup="false"` dilengkapi `data_extraction_rules.xml` yang menutup jalur backup dan transfer perangkat untuk Android 12+, sehingga cookie sesi login tidak ikut tersalin.
- **Manifest.** `android:label` kini memakai `@string/app_name`,
  `android:roundIcon` ditambah, `configChanges` ditambah supaya WebView tidak
  dimuat ulang saat HP dirotasi.
- **Signing.** Rilis memakai v2 + v3 dan mematikan v1, karena Play Console
  menolak AAB yang hanya bertanda tangan JAR.
- **`android.aapt2FromMavenOverride`** sudah dihapus dari `gradle.properties`.
  Sebelumnya baris itu menunjuk path Termux (`/data/data/com.termux/...`) dan
  akan menggagalkan build di mesin biasa maupun CI.
- **Tema gelap sejak awal.** `styles.xml` memakai `wz_window_background`
  `#08090B` untuk jendela, status bar, dan navigation bar, sama dengan yang
  dipasang `MainActivity.onCreate()`. Sebelumnya tema masih putih sementara
  kode menggantinya saat runtime, sehingga layar putih berkedip singkat tiap
  kali aplikasi dibuka.
- **AndroidX eksplisit.** `androidx.core` dan `androidx.annotation` kini
  dideklarasikan langsung. Sebelumnya hanya datang transitif dari Firebase.
- **`launchMode="singleTop"`.** Dipakai bersama `FLAG_ACTIVITY_CLEAR_TOP`
  dari notifikasi, supaya tidak terbentuk instance `MainActivity` kedua dan
  static `activeInstance` selalu menunjuk instance yang terlihat.
- **Channel notifikasi dibuat sekali.** `ensureNotificationChannel()` mengecek
  `getNotificationChannel()` lebih dulu, tidak lagi membuat ulang tiap pesan.
- **Izin notifikasi diminta sekali.** Ditandai di `wz_permissions`, dan tanda
  itu dibersihkan lagi bila pengguna mencabut izin lewat setelan sistem.
- **TTS dihapus.** Notifikasi tidak lagi dibacakan dengan suara.
- **Notifikasi** bergantung pada `app/google-services.json` dan izin
  `POST_NOTIFICATIONS`. Jangan dihapus.
