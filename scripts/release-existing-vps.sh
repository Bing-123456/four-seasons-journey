#!/usr/bin/env bash
set -Eeuo pipefail
# Upgrade the configured installation. Keep production secrets, nginx and systemd unchanged.
root=$(cd "$(dirname "$0")/.." && pwd)
target=${GUAYOUJI_SSH_HOST:-maker-camp}
release=${1:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
[[ "$release" =~ ^[A-Za-z0-9._-]+$ ]] || exit 2
archive=$(mktemp -t guayouji-upgrade)
trap 'rm -f "$archive"' EXIT
COPYFILE_DISABLE=1 tar -czf "$archive" -C "$root" --exclude='.DS_Store' server miniprogram package.json package-lock.json
ssh -o BatchMode=yes "$target" "set -e; umask 077; test -L /opt/guayouji/current; test ! -e /opt/guayouji/releases/$release; mkdir /opt/guayouji/releases/$release /opt/guayouji/deployments/$release; tar -xzf - -C /opt/guayouji/releases/$release" < "$archive"
ssh -o BatchMode=yes "$target" bash -s -- "$release" <<'REMOTE'
set -Eeuo pipefail
release=$1
base=/opt/guayouji
state=$base/deployments/$release
next=$base/releases/$release
previous=$(readlink -f "$base/current")
printf '%s\n' "$previous" > "$state/previous-current"
cp -p "$base/shared/.env" "$state/env.previous"
switched=0
rollback() {
  trap - ERR
  if [[ "$switched" == 1 ]]; then
    # The old process has already lost its PrivateTmp. Keep the migrated image
    # directory readable by the previous release instead of reverting to /tmp.
    cp -p "$state/env.rollback" "$base/shared/.env"
  else
    cp -p "$state/env.previous" "$base/shared/.env"
  fi
  ln -sfn "$previous" "$base/current.rollback"
  mv -Tf "$base/current.rollback" "$base/current"
  if [[ "$switched" == 1 ]]; then
    systemctl restart guayouji
    echo "Upgrade failed; previous release restored: $previous" >&2
  else
    echo "Upgrade failed before service switch; original service left running: $previous" >&2
  fi
}
trap 'code=$?; rollback; exit "$code"' ERR
cd "$next"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null
ln -s "$base/shared/.env" "$next/.env"
mkdir -p "$base/shared/artifacts"
# Preserve generated images inside systemd's private /tmp before restarting the old process.
pid=$(systemctl show guayouji -p MainPID --value)
if [[ "$pid" != 0 && -d "/proc/$pid/root/tmp/guayouji-artifacts" ]]; then
  cp -an "/proc/$pid/root/tmp/guayouji-artifacts/." "$base/shared/artifacts/"
fi
# Copy ownership and permissions before changing only non-secret storage paths.
cp -p "$state/env.previous" "$state/env.rollback"
/usr/local/bin/node - "$base" "$state" <<'NODE'
const fs=require('node:fs'),base=process.argv[2],state=process.argv[3],file=base+'/shared/.env';
function ensureValue(text,key,value) {
  const line=new RegExp('^\\s*(?:export\\s+)?'+key+'\\s*=([^\\r\\n]*)','m');
  const match=text.match(line);
  if (match) {
    let current=match[1].trim();
    if ((current.startsWith('"')&&current.endsWith('"'))||(current.startsWith("'")&&current.endsWith("'"))) current=current.slice(1,-1);
    else current=current.replace(/\s+#.*$/,'').trim();
    if (current) return text; // Existing custom storage remains authoritative.
    return text.replace(line,key+'='+value);
  }
  return text+'\n'+key+'='+value+'\n';
}
const original=fs.readFileSync(file,'utf8');
const rollback=ensureValue(original,'ARTIFACT_DIR',base+'/shared/artifacts');
const next=ensureValue(rollback,'BOOKING_DATA_FILE',base+'/shared/bookings.json');
fs.writeFileSync(state+'/env.rollback',rollback,{mode:0o600});
fs.writeFileSync(file,next,{mode:0o600});
NODE
chown -R guayouji:guayouji "$base/shared"
chmod -R a+rX "$next"
/usr/local/bin/node --check server/app.js
ln -sfn "$next" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
switched=1
systemctl restart guayouji
ready=0
for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:8787/health > "$state/health.json"; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
/usr/local/bin/node - "$state/health.json" <<'NODE'
const health=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
if (!health.ok || !health.speech?.configured || !health.placeRecommend?.configured || !health.bookings?.configured) process.exit(1);
console.log(JSON.stringify({ok:health.ok,speech:health.speech.configured,recommendation:health.placeRecommend.configured,bookings:health.bookings.configured}));
NODE
systemctl is-active --quiet guayouji
touch "$state/succeeded"
echo "Active release: $release"
REMOTE
