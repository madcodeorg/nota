#!/usr/bin/env bash
# Each platform can ship separately. Never replace a beta feed with a canary,
# and retain an older platform's feed when the newest release lacks its files.
set -euo pipefail
channel="${1:?Usage: site-release-feeds.sh stable|beta}"
case "$channel" in stable|beta) ;; *) exit 2 ;; esac
: "${RUNNER_TEMP:?}" "${GITHUB_REPOSITORY:?}"
records="$RUNNER_TEMP/site-releases.json"
work="$(mktemp -d "$RUNNER_TEMP/nota-feeds-XXXXXX")"
trap 'rm -rf "$work"' EXIT

for platform in macos windows linux; do
  case "$platform" in
    macos) feed=latest-mac.yml; installer='-macos-(arm64|x64)\.zip$'; check='\.zip([[:space:]]|$)' ;;
    windows) feed=latest.yml; installer='-windows-x64\.nsis\.exe$'; check='\.nsis\.exe([[:space:]]|$)' ;;
    linux) feed=latest-linux.yml; installer='-linux-(arm64|x64)\.appimage$'; check='\.appimage([[:space:]]|$)' ;;
  esac
  tag="$(jq -r --arg channel "$channel" --arg feed "$feed" --arg installer "$installer" '
    map(select(.draft | not)) |
    map(select(if $channel == "stable" then
      (.prerelease | not) and (.tag_name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$"))
    else
      .prerelease and (.tag_name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+-beta\\.[0-9]+$"))
    end)) |
    map(select(any(.assets[]; .name == $feed) and any(.assets[]; .name | test($installer; "i")))) |
    sort_by(.published_at) | reverse | .[0].tag_name // empty
  ' "$records")"
  if [ -z "$tag" ]; then
    echo "No published $channel $platform update feed."
    continue
  fi
  mkdir -p "$work/$platform"
  gh release download "$tag" -R "$GITHUB_REPOSITORY" --pattern "$feed" --dir "$work/$platform"
  version="$(awk '$1 == "version:" { print $2; exit }' "$work/$platform/$feed")"
  if [ "$version" != "${tag#v}" ]; then
    echo "Refusing $tag/$feed: version mismatch ($version)." >&2
    exit 1
  fi
  if ! grep -Eiq -- "$check" "$work/$platform/$feed"; then
    echo "Refusing $tag/$feed: no $platform updater file." >&2
    exit 1
  fi
  base="https://github.com/$GITHUB_REPOSITORY/releases/download/$tag"
  mkdir -p "_site/updates/$channel"
  sed -E "s#^([[:space:]]*(- )?(url|path): )(nota-[^ ]*)\$#\1$base/\4#" \
    "$work/$platform/$feed" > "_site/updates/$channel/$feed"
  echo "$platform $channel feed ships $tag"
done
