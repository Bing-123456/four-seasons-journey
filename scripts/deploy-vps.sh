#!/usr/bin/env bash
set -euo pipefail

# Deploy only this project. Credentials travel on SSH stdin, never in the archive.
project_root=$(cd "$(dirname "$0")/.." && pwd)
target=${GUAYOUJI_SSH_HOST:-maker-camp}
mode=${1:-deploy}
release=${2:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
if [[ "$mode" != deploy && "$mode" != --rollback ]] || [[ ! "$release" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo 'Usage: scripts/deploy-vps.sh [deploy | --rollback RELEASE]' >&2
  exit 2
fi
ssh_args=(-o BatchMode=yes -o ConnectTimeout=10)
if [[ "$mode" == deploy ]]; then
  [[ -f "$project_root/.env" ]] || { echo 'Missing project .env' >&2; exit 1; }
  archive=$(mktemp -t guayouji-release)
  trap 'rm -f "$archive"' EXIT
  COPYFILE_DISABLE=1 tar -czf "$archive" -C "$project_root" --exclude='.DS_Store' server miniprogram package.json node_modules/ws
  ssh "${ssh_args[@]}" "$target" "umask 077; mkdir -p /opt/guayouji/releases/$release /opt/guayouji/shared /opt/guayouji/deployments/$release"
  ssh "${ssh_args[@]}" "$target" "tar -xzf - -C /opt/guayouji/releases/$release" < "$archive"
  ssh "${ssh_args[@]}" "$target" "umask 077; cat > /opt/guayouji/shared/.incoming-$release" < "$project_root/.env"
fi

ssh "${ssh_args[@]}" "$target" bash -s -- "$mode" "$release" <<'REMOTE'
set -Eeuo pipefail
mode=$1
release=$2
base=/opt/guayouji
state=$base/deployments/$release
nginx_file=/etc/nginx/conf.d/demo.conf
snippet=/etc/nginx/snippets/guayouji.conf
unit=/etc/systemd/system/guayouji.service
node_bin=/usr/local/bin/node
[[ $(id -u) == 0 ]] || { echo 'Deployment requires the configured root SSH account' >&2; exit 1; }

restore() {
  trap - ERR
  set +e
  restore_status=0
  systemctl stop guayouji.service >/dev/null 2>&1
  if [[ -f "$state/unit.absent" ]]; then systemctl disable guayouji.service >/dev/null 2>&1; fi
  for item in nginx snippet unit env; do
    case "$item" in
      nginx) destination=$nginx_file ;;
      snippet) destination=$snippet ;;
      unit) destination=$unit ;;
      env) destination=$base/shared/.env ;;
    esac
    if [[ -f "$state/$item.previous" ]]; then
      cp -p "$state/$item.previous" "$destination" || restore_status=1
    elif [[ -f "$state/$item.absent" ]]; then
      rm -f "$destination" || restore_status=1
    fi
  done
  if [[ -s "$state/previous-current" ]]; then
    ln -sfn "$(cat "$state/previous-current")" "$base/current" || restore_status=1
  else
    rm -f "$base/current" || restore_status=1
  fi
  systemctl daemon-reload || restore_status=1
  if [[ -f "$state/unit.previous" ]]; then
    systemctl restart guayouji.service || restore_status=1
  fi
  if nginx -t; then systemctl reload nginx || restore_status=1; else restore_status=1; fi
  rm -f "$base/shared/.incoming-$release"
  if [[ "$restore_status" == 0 ]]; then
    echo "Restored the state before deployment $release"
  else
    echo "Rollback needs attention; inspect backups in $state" >&2
  fi
  return "$restore_status"
}

if [[ "$mode" == --rollback ]]; then
  [[ -f "$state/backup-complete" ]] || { echo 'No complete backup for this release' >&2; exit 1; }
  [[ $(readlink "$base/current") == "$base/releases/$release" ]] || { echo 'Only the currently active release can be rolled back' >&2; exit 1; }
  restore
  exit $?
fi
[[ -x "$node_bin" && -f "$nginx_file" ]] || { echo 'Expected Node/nginx installation not found' >&2; exit 1; }
[[ ! -e "$state/backup-complete" ]] || { echo 'Release identifier already used' >&2; exit 1; }
[[ -e "$base/current" ]] && readlink -f "$base/current" > "$state/previous-current" || : > "$state/previous-current"
for item in nginx snippet unit env; do
  case "$item" in
    nginx) source=$nginx_file ;;
    snippet) source=$snippet ;;
    unit) source=$unit ;;
    env) source=$base/shared/.env ;;
  esac
  if [[ -f "$source" ]]; then cp -p "$source" "$state/$item.previous"; else touch "$state/$item.absent"; fi
done
touch "$state/backup-complete"
trap 'status=$?; echo "Deployment failed; restoring previous state" >&2; restore; exit "$status"' ERR

id guayouji >/dev/null 2>&1 || useradd --system --home-dir "$base" --no-create-home --shell /usr/sbin/nologin guayouji
chmod 755 "$base" "$base/releases" "$base/releases/$release"
chmod -R a+rX "$base/releases/$release"
chown guayouji:guayouji "$base/shared"
chmod 750 "$base/shared"
"$node_bin" - "$base" "$release" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [base, release] = process.argv.slice(2);
const { loadEnv } = require(base + '/releases/' + release + '/server/env');
const { readConfig } = require(base + '/releases/' + release + '/server/config');
const old = {}, env = {};
loadEnv(base + '/shared/.env', old);
loadEnv(base + '/shared/.incoming-' + release, env);
env.HOST = '127.0.0.1';
env.PORT = '8787';
env.API_TOKEN = old.API_TOKEN && old.API_TOKEN.length >= 24 ? old.API_TOKEN : crypto.randomBytes(32).toString('hex');
const config = readConfig(env);
const lines = Object.entries(env).map(([key, value]) => {
  if (/[\r\n]/.test(value)) throw new Error('Multiline environment values are unsupported');
  return key + '=' + value;
});
fs.writeFileSync(base + '/shared/.env', lines.join('\n') + '\n', { mode: 0o600 });
console.log(JSON.stringify({ textModelConfigured: config.provider !== 'disabled', visionConfigured: !!(config.vision && config.vision.apiKey), imageConfigured: config.image.provider !== 'disabled' }));
NODE
chown guayouji:guayouji "$base/shared/.env"
chmod 600 "$base/shared/.env"
rm -f "$base/shared/.incoming-$release"
ln -s "$base/shared/.env" "$base/releases/$release/.env"
ln -sfn "$base/releases/$release" "$base/current"

cat > "$unit" <<'UNIT'
[Unit]
Description=Guayouji application API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=guayouji
Group=guayouji
WorkingDirectory=/opt/guayouji/current
ExecStart=/usr/local/bin/node /opt/guayouji/current/server/index.js
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/guayouji/shared
MemoryMax=384M

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable guayouji.service >/dev/null
systemctl restart guayouji.service
for attempt in 1 2 3 4 5; do
  curl -fsS --max-time 5 http://127.0.0.1:8787/health >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS --max-time 5 http://127.0.0.1:8787/health | "$node_bin" -e 'let data=""; process.stdin.on("data", c=>data+=c); process.stdin.on("end",()=>{ const h=JSON.parse(data); if(!h.ok || !h.auth.required || h.auth.authenticated) process.exit(1); });'

cat > "$snippet" <<'NGINX'
location = /guayouji { return 308 /guayouji/; }
location ^~ /guayouji/ {
    proxy_pass http://127.0.0.1:8787/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    proxy_read_timeout 130s;
    client_max_body_size 4m;
}
NGINX
python3 - "$nginx_file" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
include = '    include /etc/nginx/snippets/guayouji.conf;'
anchor = '    ssl_certificate_key /etc/letsencrypt/live/demo.orionsheep.com/privkey.pem;'
if include not in text:
    if text.count(anchor) != 1:
        raise RuntimeError('Expected HTTPS server anchor was not found exactly once')
    path.write_text(text.replace(anchor, anchor + '\n' + include))
PY
nginx -t
systemctl reload nginx
curl -fsS --max-time 15 https://demo.orionsheep.com/guayouji/health | "$node_bin" -e 'let data=""; process.stdin.on("data", c=>data+=c); process.stdin.on("end",()=>{ const h=JSON.parse(data); if(!h.ok || !h.auth.required || h.auth.authenticated) process.exit(1); console.log(JSON.stringify({httpsHealth:true, authenticationRequired:h.auth.required, textModel:h.model, vision:h.vision, image:h.image, inkPainting:h.inkPainting})); });'
status=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{"text":"三人周末出游"}' https://demo.orionsheep.com/guayouji/api/profile)
[[ "$status" == 401 ]]
touch "$state/succeeded"
trap - ERR
echo "Deployed $release; anonymous POST returned 401"
echo "API: https://demo.orionsheep.com/guayouji"
echo "Rollback: scripts/deploy-vps.sh --rollback $release"
REMOTE
