#!/usr/bin/env bash
set -euo pipefail

# This exports source files, never the private repository's Git objects.
root=$(git rev-parse --show-toplevel)
mode=committed
if [ "${1:-}" = --working-tree ]; then
  mode=working-tree
  shift
fi
if [ "$#" -ne 1 ]; then
  echo 'Usage: bash scripts/prepare-publication-snapshot.sh [--working-tree] NEW_DIRECTORY' >&2
  exit 1
fi
destination=$1
command -v gitleaks >/dev/null
command -v python3 >/dev/null

python3 - "$root" "$destination" "$mode" <<'PY'
import fnmatch
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

root = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).absolute()
mode = sys.argv[3]
rules = json.loads((root / 'scripts/publication-exclusions.json').read_text())
if destination.exists() or destination.is_symlink():
    sys.exit('Destination must not already exist')
if not destination.parent.is_dir():
    sys.exit("Destination's parent directory must already exist")
destination = destination.parent.resolve() / destination.name
if destination.is_relative_to(root):
    sys.exit('Destination must be outside the development repository')

def eligible(name):
    path = Path(name)
    if path.is_absolute() or '..' in path.parts:
        sys.exit('Publication blocked by unsafe source path')
    for blocked in rules['blockedPaths']:
        if name == blocked or name.startswith(blocked + '/'):
            sys.exit('Publication blocked by restricted historical path: ' + name)
    if name in rules['excludedPaths']:
        return False
    if any(part in rules['excludedDirectoryNames'] for part in path.parts):
        return False
    if any(fnmatch.fnmatchcase(name, glob) for glob in rules['excludedPatterns']):
        return False
    # Environment examples are source; actual environment files remain private.
    if path.name == '.env' or (path.name.startswith('.env.') and not path.name.endswith('.example')):
        return False
    return True

included = 0
excluded = 0
destination.mkdir()
if mode == 'working-tree':
    names = subprocess.check_output([
        'git', '-C', str(root), 'ls-files', '--cached', '--others',
        '--exclude-standard', '-z',
    ]).decode().split('\0')
    for name in sorted(set(filter(None, names))):
        if not eligible(name):
            excluded += 1
            continue
        source = root / name
        # Preserve worktree deletions and fail closed on links, including parents.
        if any(parent.is_symlink() for parent in (source, *source.parents) if parent != root):
            sys.exit('Publication blocked by source symlink: ' + name)
        if not source.exists():
            continue
        if not source.is_file():
            sys.exit('Publication blocked by non-file source: ' + name)
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        target.chmod(0o755 if source.stat().st_mode & 0o111 else 0o644)
        included += 1
else:
    archive = subprocess.Popen(['git', '-C', str(root), 'archive', 'HEAD'], stdout=subprocess.PIPE)
    with tarfile.open(fileobj=archive.stdout, mode='r|') as files:
        for member in files:
            if member.isdir():
                continue
            if not eligible(member.name):
                excluded += 1
                continue
            if not member.isfile():
                sys.exit('Publication blocked by non-file archive source: ' + member.name)
            target = destination / member.name
            target.parent.mkdir(parents=True, exist_ok=True)
            with files.extractfile(member) as source, target.open('wb') as output:
                shutil.copyfileobj(source, output)
            target.chmod(0o755 if member.mode & 0o111 else 0o644)
            included += 1
    if archive.wait() != 0:
        sys.exit('Git source archive failed')
print(f'Exported {included} {mode} source files; excluded {excluded} files by publication policy.')
PY

gitleaks dir "$destination" --redact=100 --no-banner --max-archive-depth=2
git -C "$destination" init --initial-branch=main
# The export has already filtered private/generated state. Retain source notices
# and README even if old ignore rules match these previously tracked files.
git -C "$destination" add --all --force
git -C "$destination" -c user.name='Nota contributors' -c user.email='contributors@nota.invalid' -c core.hooksPath=/dev/null -c commit.gpgsign=false commit --quiet -m 'Initial Nota source snapshot'
gitleaks git "$destination" --redact=100 --no-banner --max-archive-depth=2
test "$(git -C "$destination" rev-list --all --count)" = 1
test -z "$(git -C "$destination" remote)"
echo 'History-isolated candidate prepared. Review the candidate before publication; nothing was published.'
