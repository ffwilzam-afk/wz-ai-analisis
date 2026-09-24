# WZ MANAGE PRO — Play Store build

## Prasyarat (dijalankan di komputer Anda)

- JDK 17 atau lebih baru (perintah `keytool` sudah termasuk di dalamnya).
- Android SDK dengan platform API 36 dan build-tools 36.0.0.
- `ANDROID_HOME` dan `ANDROID_SDK_ROOT` diarahkan ke folder SDK tersebut.
- Gradle **tidak** perlu diinstal, repo sudah memuat Gradle wrapper.

Workspace cloud Freebuff tidak menyediakan Java, Gradle, maupun Android SDK, jadi seluruh langkah build di bawah harus dijalankan di komputer Anda sendiri.

## 1. URL aplikasi

`START_URL` di `app/src/main/java/com/wzmanagepro/app/MainActivity.java` saat ini:

```
https://wz-ai-analisis-rust.vercel.app/
```

Pastikan alamat ini benar-benar hidup (bukan 404/unreachable) sebelum submit. Bila nanti pindah ke domain sendiri, ubah baris `START_URL` tersebut.

## 2. Buat upload keystore (sekali saja, lalu simpan baik-baik)

```bash
cd android
keytool -genkeypair -v \
  -keystore keystore/wz-upload.jks \
  -alias wz-upload \
  -keyalg RSA -keysize 4096 -validity 10000
```

`keytool` akan menanyakan password, nama, dan organisasi. Simpan file `.jks` beserta password-nya di tempat aman: **kalau upload key hilang, aplikasi tidak bisa diperbarui lagi di Play Store**.

Folder `android/keystore/` sudah ada di `android/.gitignore`, jadi file keystore dan password-nya tidak akan ikut ter-commit.

## 3. Buat `android/keystore/keystore.properties`

```properties
storeFile=../keystore/wz-upload.jks
storePassword=ISI_PASSWORD_ANDA
keyAlias=wz-upload
keyPassword=ISI_PASSWORD_ALIAS
```

Nilai `storeFile` relatif terhadap folder `app/`, karena itu diawali `../keystore/`.

Bila file ini belum ada, build release tetap berjalan tetapi menghasilkan AAB/APK **unsigned** sehingga tidak bisa diunggah ke Play Console. Untuk uji coba di perangkat sebelum keystore siap, pakai `./gradlew assembleDebug` (APK sudah ditandatangani debug key).

## 4. Build AAB

```bash
cd android
./gradlew clean bundleRelease
```

Di Windows: `gradlew.bat clean bundleRelease`.

Hasil: `app/build/outputs/bundle/release/app-release.aab`

## 5. Verifikasi sebelum unggah

```bash
jarsigner -verify -verbose -certs app/build/outputs/bundle/release/app-release.aab
```

Opsional, uji AAB di perangkat memakai bundletool:

```bash
bundletool build-apks \
  --bundle=app/build/outputs/bundle/release/app-release.aab \
  --output=/tmp/wz.apks \
  --ks=keystore/wz-upload.jks --ks-key-alias=wz-upload
```

Selalu uji versi rilis (bukan hanya debug), termasuk login, simpan transaksi, tutup shift, dan notifikasi.

## 6. Persyaratan Play Console

- `applicationId`: `com.wzmanagepro.app` · minSdk 29 · targetSdk 36
- Versi saat ini: **versionCode 2 / versionName 1.0.1**. Setiap unggahan berikutnya wajib menaikkan `versionCode` (berikutnya: 3).
- Akun developer personal yang dibuat setelah 13 Nov 2023 wajib menjalani closed testing minimal **12 tester selama 14 hari berturut-turut** sebelum bisa akses produksi.
- Siapkan materi listing: ikon 512×512, feature graphic 1024×500, minimal 2 screenshot, deskripsi, privacy policy (repo sudah menyediakan `web-source/privacy.html`), serta formulir Data safety.

## Catatan konfigurasi

- Notifikasi Android bergantung pada `app/google-services.json` (ada di repo) dan izin `POST_NOTIFICATIONS`. Jangan dihapus.
- `android.aapt2FromMavenOverride` sudah dihapus dari `gradle.properties`. Sebelumnya baris itu menunjuk path Termux (`/data/data/com.termux/...`) dan akan menggagalkan build di mesin biasa maupun CI.
- Signing release kini kondisional (`hasReleaseSigning` di `app/build.gradle`), sehingga build tidak langsung gagal ketika keystore lokal belum tersedia.
