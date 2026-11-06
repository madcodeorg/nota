#!/usr/bin/env bash
# Validate the actual downloadable formats, not just Forge's staging directory.
set -euo pipefail

: "${RELEASE_VERSION:?}" "${BUILD_TYPE:?}" "${TARGET_ARCH:?}"
root="$PWD"
prefix="$root/builds/nota-$RELEASE_VERSION-$BUILD_TYPE-linux-$TARGET_ARCH"
zip="$prefix.zip"
appimage="$prefix.appimage"
deb="$prefix.deb"
for file in "$zip" "$appimage" "$deb"; do
  test -s "$file"
done
unzip -t "$zip"
dpkg-deb --info "$deb"
version="$(dpkg-deb --field "$deb" Version)"
# electron-installer-debian represents beta prereleases with Debian's '~'.
if [[ "$version" != "$RELEASE_VERSION" && "$version" != "${RELEASE_VERSION/-beta./~beta.}" ]]; then
  echo "Debian version mismatch: $version (expected $RELEASE_VERSION)" >&2
  exit 1
fi

work="$(mktemp -d "${RUNNER_TEMP:-/tmp}/nota-linux-check-XXXXXX")"
package=''
cleanup() {
  if [ -n "$package" ]; then sudo dpkg --remove "$package" || true; fi
  rm -rf "$work"
}
trap cleanup EXIT
unzip -q "$zip" -d "$work/zip"
mapfile -d '' apps < <(find "$work/zip" -maxdepth 2 -type f -name 'Nota*' -executable -print0)
[ "${#apps[@]}" -eq 1 ] || { echo 'Expected one ZIP executable.' >&2; exit 1; }
app="${apps[0]}"
appdir="$(dirname "$app")"
test -s "$appdir/resources/app.asar"
test -s "$appdir/resources/app-update.yml"
test -s "$appdir/resources/app.asar.unpacked/node_modules/@nota/native/nota.linux-$TARGET_ARCH-gnu.node"
test -x "$appdir/resources/native/nota-whisper-helper"
test -x "$appdir/resources/native/nota-llama-server"

# Inspect every ELF in the ZIP payload, including Electron's crash handler.
# The outer AppImage runtime is exercised separately by its launch below.
# Ubuntu 22.04 with current libstdc++ security updates: GLIBC 2.35 /
# GLIBCXX 3.4.30 (libstdc++6 12.3 in jammy-updates).
python3 - "$appdir" "$work/elf-paths" <<'PY'
import os, sys
with open(sys.argv[2], 'wb') as output:
    for directory, _, files in os.walk(sys.argv[1]):
        for name in files:
            file = os.path.join(directory, name)
            with open(file, 'rb') as binary:
                if binary.read(4) == b'\x7fELF':
                    output.write(os.fsencode(file) + b'\0')
PY
while IFS= read -r -d '' file; do
  versions="$(readelf --version-info "$file" 2>/dev/null | grep -oE 'GLIBC_[0-9.]+|GLIBCXX_[0-9.]+' || true)"
  for family in GLIBC GLIBCXX; do
    required="$(printf '%s\n' "$versions" | grep "^${family}_" | cut -d_ -f2 | sort -V | tail -1 || true)"
    [ -n "$required" ] || continue
    limit=2.35
    [ "$family" != GLIBCXX ] || limit=3.4.30
    highest="$(printf '%s\n' "$required" "$limit" | sort -V | tail -1)"
    if [ "$highest" != "$limit" ]; then
      echo "$file requires ${family}_$required (baseline ${family}_$limit)" >&2
      exit 1
    fi
  done
done < "$work/elf-paths"

# Run Node from the Electron workspace so its focused CI dependencies resolve.
smoke() {
  xvfb-run -a yarn nota @nota/electron node ./scripts/smoke-desktop-app.ts \
    --app "$1" --timeout 120 -- "${@:2}"
}
smoke "$app" --disable-gpu
chmod +x "$appimage"
# Type-2 runtime extraction works without FUSE mounts on hosted runners.
smoke "$appimage" --appimage-extract-and-run --disable-gpu

# Exercise Debian's install scripts and runtime dependencies as well.
package="$(dpkg-deb --field "$deb" Package)"
sudo apt-get install -y --no-install-recommends "$deb"
metainfo="/usr/share/metainfo/$package.metainfo.xml"
test -s "$metainfo"
mapfile -d '' installed < <(find "/usr/lib/$package" -maxdepth 1 -type f -name 'Nota*' -executable -print0)
[ "${#installed[@]}" -eq 1 ] || { echo 'Expected one installed Debian executable.' >&2; exit 1; }
smoke "${installed[0]}" --disable-gpu
# Removal is part of acceptance, not just best-effort failure cleanup.
sudo dpkg --remove "$package"
test ! -e "$metainfo"
package=''
printf 'Linux ZIP, AppImage and Debian smoke tests passed for %s.\n' "$RELEASE_VERSION"
