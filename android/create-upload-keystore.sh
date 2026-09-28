#!/usr/bin/env bash
#
# Buat upload keystore + keystore.properties untuk build rilis WZ MANAGE PRO.
#
# Jalankan sekali saja, dari folder android/:
#     bash create-upload-keystore.sh
#
# Folder android/keystore/ ada di .gitignore, jadi file .jks dan
# keystore.properties tidak akan pernah ikut ter-commit. Skrip ini sendiri
# diletakkan di luar folder tersebut supaya ikut tersimpan di repo.
set -euo pipefail

cd "$(dirname "$0")"

JKS="keystore/wz-upload.jks"
PROPS="keystore/keystore.properties"
ALIAS="wz-upload"

if ! command -v keytool >/dev/null 2>&1; then
  echo "ERROR: keytool tidak ditemukan." >&2
  echo "Pasang JDK 17 atau lebih baru, lalu pastikan JAVA_HOME menunjuk" >&2
  echo "ke folder JDK tersebut." >&2
  exit 1
fi

if [ -e "$JKS" ]; then
  echo "ERROR: $JKS sudah ada, jadi skrip berhenti." >&2
  echo "JANGAN membuat ulang upload key: key yang hilang membuat aplikasi" >&2
  echo "tidak bisa diperbarui lagi di Play Store." >&2
  exit 1
fi

echo "== Membuat upload keystore =="
echo "Simpan file dan password ini di tempat aman (mis. password manager)."
echo
keytool -genkeypair -v \
  -keystore "$JKS" \
  -alias "$ALIAS" \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000 \
  -storetype PKCS12

echo
echo "== Menulis $PROPS =="
mkdir -p keystore
cat > "$PROPS" <<EOF
storeFile=../$JKS
keyAlias=$ALIAS
storePassword=
keyPassword=
EOF
chmod 600 "$PROPS"

echo "$PROPS dibuat."
echo "Password sengaja dikosongkan, bukan diisi otomatis, demi keamanan."
echo "Buka file itu lalu isi dua baris terakhir dengan password Anda:"
echo "  storePassword=..."
echo "  keyPassword=..."
echo
echo "Untuk keystore PKCS12, storePassword dan keyPassword umumnya sama."
echo
echo "Langkah berikutnya:"
echo "  1. Isi kedua password di $PROPS"
echo "  2. ./gradlew clean bundleRelease"
echo "  3. Hasil: app/build/outputs/bundle/release/app-release.aab"
echo
echo "Simpan salinan $JKS di tempat lain juga. Jangan pernah menghapusnya."
