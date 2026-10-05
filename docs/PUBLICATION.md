# Publishing Nota Source

Prepare the public repository from an independent source snapshot. Keep the
development repository private: its older refs contain local agent state, logs,
a test private-key fixture, and upstream backend/native code with separate terms.
Copying the current source without its Git objects avoids publishing those refs.

## Prepare The Candidate

The exporter requires Git, Python 3.9 or later, and
[Gitleaks](https://github.com/gitleaks/gitleaks). Run it from the development
repository. The destination must be a new directory outside the repository, and
its parent must already exist.

For a reviewed committed tree:

```sh
bash scripts/prepare-publication-snapshot.sh /absolute/path/to/nota-public
```

For an explicitly reviewed worktree, including modified tracked files and new
source files that Git does not ignore:

```sh
bash scripts/prepare-publication-snapshot.sh --working-tree /absolute/path/to/nota-public
```

The working-tree option preserves deletions and includes pending implementation
and tests. Review `git status --short` first: any nonignored new file is eligible
unless the publication policy excludes it. Neither option modifies the original
repository, its index, its history, or local user data.

[publication-exclusions.json](../scripts/publication-exclusions.json) is the
machine-readable exclusion inventory. It excludes local agent configuration,
profiles and databases, actual environment files, credentials/signing material,
logs, model weights, installed dependencies, build output and inference binaries.
Environment examples, source, test fixtures, Yarn releases and legal notices are
retained. Source symlinks and removed restricted upstream directories block the
export. The proprietary Satoshi font files are excluded pending a separately
verified distribution license.

The script scans the exported files and nested archives with fully redacted
Gitleaks output, creates
one new root commit on `main`, scans that new history, and verifies there is one
commit and no remote. A failed export or scan leaves an incomplete candidate for
inspection; do not publish that directory or treat it as a successful export.
Secret scanning is heuristic. Review the actual candidate inventory and asset
provenance as well.

## Review And Publish

Run the documented source installation and relevant tests from the candidate;
see [BUILDING.md](BUILDING.md). Confirm the fresh repository contains README,
license/attribution notices, contributor guidance and security instructions.
Check application support/download links point to the Nota project, while
required upstream attribution remains intact. Inspect the independent history:

```sh
git -C /absolute/path/to/nota-public log --oneline --all
git -C /absolute/path/to/nota-public ls-files
git -C /absolute/path/to/nota-public remote -v
```

Rename the old private GitHub repository to an archive name, then create a new
`madcodeorg/nota` repository and push only the candidate's `main` branch. Enable
the public repository after the candidate review. Do not merge the development
repository's old history into it or push old branches/tags. Keep release
workflows manual until their signing credentials and supported platform builds
have been verified.

## Source And Installer Boundaries

Nota's MIT notice does not relicense third-party assets, dependencies, model
weights, native runtimes, or historical code. Preserve the AFFiNE attribution
and applicable component notices. The removed upstream `packages/backend/server`,
`packages/backend/native` and `packages/common/native` directories are blocked;
Nota's current AI backend and MIT-origin frontend native code are separate paths.

The October 4 provenance review found no restricted-only exact or substantial
normalized source match in its reviewed tree, and recorded the owner's
confirmation that the new AI backend and replacement hashcash implementation
were created for Nota without copying restricted code. Review later changes
against that baseline when preparing a new candidate. Source similarity does
not establish legal rights for binaries, assets or model weights.

The source candidate includes no installer or downloaded models. An installer
release requires a clean native/runtime build, the actual packaged component
licenses, fresh-profile recording/storage checks, signing and notarization.
The excluded root inference dylibs must not be used as unexplained release
inputs. The export does not sanitize the old repository, rotate credentials,
or reset an installed Nota profile.
