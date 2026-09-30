#!/bin/bash
# AragonTask APK build (no gradle: aapt2 + javac + d8 + zipalign + apksigner)
set -e
SDK=$HOME/android-sdk
BT=$SDK/build-tools/34.0.0
PLAT=$SDK/platforms/android-34/android.jar
cd "$(dirname "$0")/app"
rm -rf build && mkdir -p build/gen build/classes

echo "[1/7] aapt2 compile"
"$BT/aapt2" compile --dir res -o build/res.zip

echo "[2/7] aapt2 link"
"$BT/aapt2" link -o build/base.apk -I "$PLAT" \
  --manifest AndroidManifest.xml \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code 6 --version-name 1.5 \
  -A assets --java build/gen build/res.zip

echo "[3/7] javac"
find build/gen src -name "*.java" > build/srcs.txt
javac -classpath "$PLAT" -d build/classes @build/srcs.txt

echo "[4/7] d8 dex"
"$BT/d8" --release --min-api 24 --lib "$PLAT" --output build $(find build/classes -name "*.class")

echo "[5/7] package dex into apk"
python3 - <<'PY'
import zipfile
z = zipfile.ZipFile("build/base.apk", "a", zipfile.ZIP_DEFLATED)
z.write("build/classes.dex", "classes.dex")
z.close()
print("  classes.dex appended")
PY

echo "[6/7] zipalign"
"$BT/zipalign" -f 4 build/base.apk build/aligned.apk

echo "[7/7] sign"
if [ ! -f ../terra.keystore ]; then
  keytool -genkeypair -keystore ../terra.keystore -alias terra -keyalg RSA -keysize 2048 \
    -validity 10950 -storepass terra2024 -keypass terra2024 \
    -dname "CN=Terra, O=Terra Labs, C=CN" >/dev/null 2>&1
  echo "  keystore created"
fi
"$BT/apksigner" sign --ks ../terra.keystore --ks-pass pass:terra2024 --key-pass pass:terra2024 \
  --out ../AragonTask-v1.5.apk build/aligned.apk

"$BT/apksigner" verify --print-certs ../AragonTask-v1.5.apk | head -4
echo "BUILD_OK -> $(cd .. && pwd)/AragonTask-v1.5.apk"
