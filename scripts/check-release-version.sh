#!/usr/bin/env bash
# Retry draft builds, but never retarget tags or overwrite published installers.
set -euo pipefail
: "${GITHUB_REPOSITORY:?}" "${GITHUB_SHA:?}" "${RELEASE_VERSION:?}"
tag="v$RELEASE_VERSION"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# Listing avoids treating authentication/network failures as a missing release.
gh api "repos/$GITHUB_REPOSITORY/releases" --paginate --jq '.[]' | jq -s '.' > "$work/releases.json"
if jq -e --arg tag "$tag" 'any(.[]; .tag_name == $tag and (.draft | not))' "$work/releases.json" > /dev/null; then
  echo "$tag is already published. Choose a new version; installers will not be overwritten." >&2
  exit 1
fi
branch=main
if [[ "$RELEASE_VERSION" == *-beta.* ]]; then
  branch=beta
else
  beta="$(jq -r --arg prefix "v$RELEASE_VERSION-beta." 'map(select((.draft | not) and .prerelease and (.tag_name | startswith($prefix)))) | sort_by(.published_at) | .[-1].tag_name // empty' "$work/releases.json")"
  if [ -z "$beta" ]; then
    echo 'A stable draft requires a published beta of the same version first.' >&2
    exit 1
  fi
  beta_object="$(gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$beta" --jq .object)"
  for _ in 1 2 3 4 5; do
    [ "$(jq -r .type <<< "$beta_object")" = tag ] || break
    beta_object="$(gh api "repos/$GITHUB_REPOSITORY/git/tags/$(jq -r .sha <<< "$beta_object")" --jq .object)"
  done
  [ "$(jq -r .type <<< "$beta_object")" = commit ]
  beta_sha="$(jq -r .sha <<< "$beta_object")"
  git fetch --no-tags --depth=1 origin "$beta_sha"
  # Compare trees, not ancestry: squash promotion changes commit identities.
  # Only these explicit release-metadata files may differ from the tested beta.
  changed="$(git diff --name-only "$beta_sha" "$GITHUB_SHA" -- . ':!CHANGELOG.md' ':!RELEASING.md' ':!docs/PLATFORMS.md' ':!packages/frontend/apps/electron/resources/nota.metainfo.xml')"
  if [ -n "$changed" ]; then
    echo "Stable payload differs from published $beta. Ship these changes in a new beta first:" >&2
    printf '%s\n' "$changed" >&2
    exit 1
  fi
fi
status="$(gh api "repos/$GITHUB_REPOSITORY/compare/$GITHUB_SHA...$branch" --jq .status)"
if [ "$status" != identical ] && [ "$status" != ahead ]; then
  echo "The build commit is not on $branch. Promote/test the source before releasing it." >&2
  exit 1
fi
gh api "repos/$GITHUB_REPOSITORY/git/matching-refs/tags/$tag" > "$work/refs.json"
object="$(jq -c --arg tag "refs/tags/$tag" '.[] | select(.ref == $tag) | .object' "$work/refs.json")"
if [ -n "$object" ]; then
  # Follow annotated tags as well as lightweight tags.
  for _ in 1 2 3 4 5; do
    [ "$(jq -r .type <<< "$object")" = tag ] || break
    object="$(gh api "repos/$GITHUB_REPOSITORY/git/tags/$(jq -r .sha <<< "$object")" --jq .object)"
  done
  if [ "$(jq -r .type <<< "$object")" != commit ] || [ "$(jq -r .sha <<< "$object")" != "$GITHUB_SHA" ]; then
    echo "$tag does not identify the build commit. Existing tags will not be moved." >&2
    exit 1
  fi
fi
