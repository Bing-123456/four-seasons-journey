#!/usr/bin/env bash
set -euo pipefail

# Synchronize only miniprogram. Never read .env or restart backend/nginx.
project_root=$(cd "$(dirname "$0")/.." && pwd)
target=maker-camp # 60.204.231.189, using the existing SSH configuration.
mode=${1:-sync}
sync_id=${2:-}
usage() {
  echo 'Usage: scripts/sync-frontend-vps.sh [--check | --rollback SYNC_ID]'
}
case "$mode" in
  sync|--check) [[ $# -le 1 ]] || { usage >&2; exit 2; } ;;
  --rollback) [[ $# -eq 2 && "$sync_id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]] || { usage >&2; exit 2; } ;;
  --help|-h) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

ssh_args=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
archive_sha=''
if [[ "$mode" != --rollback ]]; then
  command -v python3 >/dev/null || { echo 'Python 3 is required for local file verification.' >&2; exit 1; }
  sync_id=$(date -u +%Y%m%dT%H%M%SZ)-$$
  scratch=$(mktemp -d "${TMPDIR:-/tmp}/guayouji-frontend.XXXXXX")
  trap 'rm -rf "$scratch"' EXIT
  archive=$scratch/frontend.tar.gz
  python3 - "$project_root/miniprogram" "$archive" <<'PACKAGE'
import hashlib, io, json, os, pathlib, sys, tarfile
source, output = map(pathlib.Path, sys.argv[1:])
if not source.is_dir() or source.is_symlink():
    raise SystemExit('Expected a regular miniprogram directory.')
manifest = {'files': [], 'directories': []}
with tarfile.open(output, 'w:gz') as bundle:
    root = tarfile.TarInfo('miniprogram'); root.type = tarfile.DIRTYPE; root.mode = 0o755
    bundle.addfile(root)
    for folder, directories, filenames in os.walk(source, followlinks=False):
        directories.sort(); filenames.sort()
        for name in directories + filenames:
            item = pathlib.Path(folder, name)
            if item.is_symlink():
                raise SystemExit('Symbolic links are not allowed in the frontend package.')
        for name in directories:
            relative = pathlib.Path(folder, name).relative_to(source).as_posix()
            entry = tarfile.TarInfo('miniprogram/' + relative); entry.type = tarfile.DIRTYPE; entry.mode = 0o755
            bundle.addfile(entry); manifest['directories'].append(relative)
        for name in filenames:
            if name == '.DS_Store' or name.startswith('._'):
                continue
            if name == '.env' or name.startswith('.env.') or name.endswith(('.pem', '.key')):
                raise SystemExit('A private configuration/key filename was found; packaging stopped.')
            item = pathlib.Path(folder, name)
            if not item.is_file():
                raise SystemExit('Only regular frontend files are allowed.')
            relative = item.relative_to(source).as_posix()
            data = item.read_bytes()
            manifest['files'].append({'path': relative, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
            entry = tarfile.TarInfo('miniprogram/' + relative); entry.size = len(data); entry.mode = 0o644
            bundle.addfile(entry, io.BytesIO(data))
    manifest['files'].sort(key=lambda item: item['path']); manifest['directories'].sort()
    data = json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode()
    entry = tarfile.TarInfo('manifest.json'); entry.size = len(data); entry.mode = 0o600
    bundle.addfile(entry, io.BytesIO(data))
# Verify the actual archive bytes, not a second read of a changing source tree.
with tarfile.open(output, 'r:gz') as bundle:
    for item in manifest['files']:
        data = bundle.extractfile('miniprogram/' + item['path']).read()
        if len(data) != item['size'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise SystemExit('Local archive verification failed.')
print('Frontend package verified: %d files.' % len(manifest['files']))
PACKAGE
  if [[ "$mode" == --check ]]; then
    echo 'Local check complete. No VPS connection was made.'
    exit 0
  fi
  archive_sha=$(python3 - "$archive" <<'DIGEST'
import hashlib, pathlib, sys
print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
DIGEST
)
  remote_state=/opt/guayouji/frontend-sync/$sync_id
  echo "Frontend sync identifier: $sync_id"
  # sync_id is generated above from UTC time and PID; it contains no shell syntax.
  ssh "${ssh_args[@]}" "$target" "set -eu; umask 077; mkdir -p /opt/guayouji/frontend-sync; mkdir '$remote_state'; cat > '$remote_state/incoming.tar.gz'" < "$archive"
fi

ssh "${ssh_args[@]}" "$target" python3 - "$mode" "$sync_id" "$archive_sha" <<'REMOTE'
import ctypes, fcntl, hashlib, json, os, pathlib, re, signal, sys, tarfile
mode, sync_id, incoming_sha = sys.argv[1:]
if os.geteuid() != 0:
    raise SystemExit('Frontend sync requires the configured root SSH account.')
if not re.fullmatch(r'\d{8}T\d{6}Z-\d+', sync_id):
    raise SystemExit('Invalid sync identifier.')
base = pathlib.Path('/opt/guayouji')
state_base = base / 'frontend-sync'
state = state_base / sync_id
if not state.is_dir() or state.is_symlink():
    raise SystemExit('Sync state directory is missing or invalid.')
os.umask(0o077)
lock = open(state_base / '.lock', 'a')
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit('Another frontend sync or rollback is running.')

# Linux atomically exchanges two directories on the same filesystem.
# If the kernel/libc lacks this facility, abort without changing the live tree.
libc = ctypes.CDLL(None, use_errno=True)
exchange = getattr(libc, 'renameat2', None)
if exchange is None:
    raise SystemExit('Atomic directory exchange is unavailable; no files changed.')
exchange.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
exchange.restype = ctypes.c_int

def swap(left, right):
    if exchange(-100, os.fsencode(left), -100, os.fsencode(right), 2) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))

def identity(directory):
    try:
        stat = directory.stat()
    except FileNotFoundError:
        return None
    return stat.st_dev, stat.st_ino

def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()

def tree(directory):
    if directory.is_symlink() or not directory.is_dir():
        raise RuntimeError('Expected a regular frontend directory.')
    result = {'files': [], 'directories': []}
    for item in sorted(directory.rglob('*')):
        if item.is_symlink():
            raise RuntimeError('Frontend symlinks are not allowed for verified directory exchange.')
        relative = item.relative_to(directory).as_posix()
        if item.is_dir():
            result['directories'].append(relative)
        elif item.is_file():
            result['files'].append({'path': relative, 'size': item.stat().st_size, 'sha256': digest(item)})
        else:
            raise RuntimeError('The frontend contains a non-regular file.')
    result['files'].sort(key=lambda item: item['path']); result['directories'].sort()
    return result

def verify(directory, expected):
    if tree(directory) != expected:
        raise RuntimeError('Frontend file SHA-256/size/list verification failed.')

def save_json(filename, value):
    temporary = state / (filename + '.tmp')
    with temporary.open('w') as stream:
        json.dump(value, stream, ensure_ascii=False, sort_keys=True)
        stream.flush(); os.fsync(stream.fileno())
    temporary.replace(state / filename)

def stopped(signum, frame):
    raise InterruptedError('Frontend sync interrupted.')

for signum in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
    signal.signal(signum, stopped)

release = (base / 'current').resolve(strict=True)
if release.parent != base / 'releases' or not release.is_dir():
    raise SystemExit('Current release is outside the expected releases directory.')
live = release / 'miniprogram'
staging = release / ('.frontend-sync-' + sync_id)
previous = staging / 'miniprogram'
receipt = state / 'receipt.json'
original_identity = None
finished = False
try:
    if mode == '--rollback':
        metadata = json.loads(receipt.read_text())
        if metadata['release'] != str(release) or metadata['status'] not in ('active', 'prepared'):
            raise RuntimeError('This sync is not active on the current release; rollback stopped.')
        new_manifest = json.loads((state / 'incoming.manifest.json').read_text())
        old_manifest = json.loads((state / 'previous.manifest.json').read_text())
        verify(live, new_manifest)
        verify(previous, old_manifest)
        # On a rollback failure, restore the version that was active on entry.
        original_identity = identity(live)
        swap(live, previous)
        verify(live, old_manifest)
        metadata['status'] = 'rolled-back'
        save_json('receipt.json', metadata)
    else:
        if receipt.exists() or staging.exists():
            raise RuntimeError('This sync identifier has already been used.')
        archive = state / 'incoming.tar.gz'
        if not re.fullmatch('[a-f0-9]{64}', incoming_sha) or digest(archive) != incoming_sha:
            raise RuntimeError('Uploaded archive SHA-256 verification failed.')
        old_manifest = tree(live)
        original_identity = identity(live)
        owner = live.stat()
        save_json('previous.manifest.json', old_manifest)
        backup = state / 'miniprogram.before.tar.gz'
        with tarfile.open(backup, 'w:gz') as bundle:
            bundle.add(live, arcname='miniprogram', recursive=True)
        with backup.open('rb') as stream:
            os.fsync(stream.fileno())
        # Confirm the full backup contains every original file with its hash.
        with tarfile.open(backup, 'r:gz') as bundle:
            for item in old_manifest['files']:
                content = bundle.extractfile('miniprogram/' + item['path']).read()
                if len(content) != item['size'] or hashlib.sha256(content).hexdigest() != item['sha256']:
                    raise RuntimeError('Complete backup verification failed.')
        (state / 'miniprogram.before.tar.gz.sha256').write_text(digest(backup) + '  miniprogram.before.tar.gz\n')
        verify(live, old_manifest)
        # Extraction only permits regular files/directories inside miniprogram.
        staging.mkdir(mode=0o700)
        with tarfile.open(archive, 'r:gz') as bundle:
            members = bundle.getmembers()
            seen = set()
            for member in members:
                parts = pathlib.PurePosixPath(member.name).parts
                if member.name in seen or not parts or member.name.startswith('/') or '..' in parts:
                    raise RuntimeError('Invalid/duplicate archive member.')
                seen.add(member.name)
                if member.name == 'manifest.json':
                    if not member.isfile():
                        raise RuntimeError('Invalid file manifest.')
                    continue
                if parts[0] != 'miniprogram' or not (member.isfile() or member.isdir()):
                    raise RuntimeError('The archive contains an unsupported path or link.')
            new_manifest = json.load(bundle.extractfile('manifest.json'))
            for member in members:
                if member.name == 'manifest.json':
                    continue
                destination = staging / member.name
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True)
                    destination.chmod(0o755)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.extractfile(member) as source, destination.open('wb') as output:
                        for block in iter(lambda: source.read(1024 * 1024), b''):
                            output.write(block)
                    destination.chmod(0o644)
                os.chown(destination, owner.st_uid, owner.st_gid)
        verify(previous, new_manifest)
        save_json('incoming.manifest.json', new_manifest)
        metadata = {'release': str(release), 'previousDirectory': str(previous), 'status': 'prepared'}
        save_json('receipt.json', metadata)
        if (base / 'current').resolve(strict=True) != release:
            raise RuntimeError('The current release changed during preparation; sync stopped.')
        verify(live, old_manifest)
        swap(live, previous)
        verify(live, new_manifest)
        verify(previous, old_manifest)
        metadata['status'] = 'active'
        save_json('receipt.json', metadata)
    if (base / 'current').resolve(strict=True) != release:
        raise RuntimeError('The current release changed during synchronization.')
    finished = True
except BaseException as error:
    # Identity checks also cover interruption immediately after the atomic swap.
    if original_identity is not None and identity(live) != original_identity:
        try:
            if identity(previous) != original_identity:
                raise RuntimeError('Previous directory identity changed.')
            swap(live, previous)
            if receipt.exists():
                metadata = json.loads(receipt.read_text())
                metadata['status'] = 'active' if mode == '--rollback' else 'failed-restored'
                save_json('receipt.json', metadata)
            print('Frontend synchronization failed; the previous active directory was restored.', file=sys.stderr)
        except BaseException:
            print('Automatic restore needs attention. Retained backup: ' + str(state), file=sys.stderr)
    else:
        print('Frontend synchronization stopped before changing the live directory.', file=sys.stderr)
    print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
    raise SystemExit(1)

if finished:
    print('Frontend ' + ('rollback' if mode == '--rollback' else 'sync') + ' verified: ' + sync_id)
    print('Retained directory: ' + str(previous))
    print('Complete backup: ' + str(state / 'miniprogram.before.tar.gz'))
    if mode != '--rollback':
        print('Rollback command: bash scripts/sync-frontend-vps.sh --rollback ' + sync_id)
REMOTE
