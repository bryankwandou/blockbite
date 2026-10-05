#!/usr/bin/env bash
# Builds apps/android into OUT/blockbite.apk with the SDK's build-tools only (no Gradle).
# Usage: bash apps/android/build.sh OUT_DIR KEYSTORE
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; out="$1"; ks="$2"
sdk="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"; bt="$sdk/build-tools/35.0.1"; jar="$sdk/platforms/android-35/android.jar"
w="$(mktemp -d)"; mkdir -p "$w/res" "$w/gen" "$w/cls" "$w/dex" "$out"
"$bt/aapt2" compile --dir "$here/res" -o "$w/res.zip"
"$bt/aapt2" link -o "$w/base.apk" -I "$jar" --manifest "$here/AndroidManifest.xml" --java "$w/gen" "$w/res.zip"
# Paths contain spaces, so pass source lists through files instead of word-splitting.
find "$here/src" "$w/gen" -name '*.java' | while read -r f; do printf '"%s"\n' "$(cygpath -m "$f")"; done > "$w/srcs.txt"
javac -source 11 -target 11 -nowarn -classpath "$jar" -d "$w/cls" @"$w/srcs.txt"
(cd "$w/cls" && find . -name '*.class' > ../classes.txt && "$bt/d8.bat" --release --min-api 24 --lib "$jar" --output "$w/dex" @../classes.txt)
cp "$w/base.apk" "$w/unsigned.apk"; (cd "$w/dex" && jar uf "$w/unsigned.apk" classes.dex)
"$bt/zipalign.exe" -f -p 4 "$w/unsigned.apk" "$w/aligned.apk"
"$bt/apksigner.bat" sign --ks "$ks" --ks-pass env:BB_KS_PASS --out "$out/blockbite.apk" "$w/aligned.apk"
"$bt/apksigner.bat" verify --print-certs "$out/blockbite.apk" | head -3
