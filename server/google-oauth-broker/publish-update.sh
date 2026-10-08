#!/usr/bin/env bash
# Publish a signed macOS release to the private Azure Files update share.
# Usage: publish-update.sh <version> <signed.zip> <signed.dmg> [channel]
# Needs: az login with "Storage File Data Privileged Contributor" on the account.
# The Container App mounts the share read-only; only this script writes to it.
set -euo pipefail

VERSION="${1:?version}"
ZIP="${2:?zip path}"
DMG="${3:?dmg path}"
CHANNEL="${4:-stable}"
ACCOUNT="${NOTA_UPDATES_STORAGE_ACCOUNT:?set NOTA_UPDATES_STORAGE_ACCOUNT}"
SHARE="${NOTA_UPDATES_SHARE:-nota-updates}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[[ "${CHANNEL}" =~ ^[a-z0-9]+$ ]] || { echo "bad channel" >&2; exit 1; }

# Refuse unsigned or non-notarized apps so a bad build never reaches users.
if [[ "$(uname)" == "Darwin" && -z "${NOTA_SKIP_SIGN_CHECK:-}" ]]; then
  MNT="$(mktemp -d)"
  hdiutil attach -nobrowse -readonly -mountpoint "${MNT}" "${DMG}" >/dev/null
  trap 'hdiutil detach "${MNT}" >/dev/null 2>&1 || true' EXIT
  APP="$(ls -d "${MNT}"/*.app | head -1)"
  codesign --verify --deep --strict "${APP}"
  spctl --assess --type execute "${APP}"
  xcrun stapler validate "${APP}"
fi

STAGE="$(mktemp -d)"
cp "${ZIP}" "${DMG}" "${STAGE}/"
node "${HERE}/make-update-manifest.cjs" "${STAGE}" "${VERSION}" "$(basename "${ZIP}")" "$(basename "${DMG}")"

AUTH=(--account-name "${ACCOUNT}" --share-name "${SHARE}" --auth-mode login --enable-file-backup-request-intent)
az storage directory create "${AUTH[@]}" --name "${CHANNEL}" -o none 2>/dev/null || true

# Artifacts first, manifest last, so clients never see a manifest without its files.
for f in "$(basename "${ZIP}")" "$(basename "${DMG}")"; do
  az storage file upload "${AUTH[@]}" --source "${STAGE}/${f}" --path "${CHANNEL}/${f}" -o none
done
az storage file upload "${AUTH[@]}" --source "${STAGE}/latest-mac.yml" --path "${CHANNEL}/latest-mac.yml" -o none
echo "Published ${VERSION} to ${CHANNEL}"
