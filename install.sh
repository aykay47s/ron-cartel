#!/usr/bin/env bash
# =============================================================
#  Ron Cartel — one-shot installer for a fresh Ubuntu/Debian VPS
#
#    sudo bash install.sh                      # plain HTTP on the server IP
#    sudo bash install.sh shop.example.com     # + HTTPS via Let's Encrypt
#
#  Installs Node, Postgres, nginx; creates the database with a password
#  it generates itself; runs the app under systemd so it restarts on boot
#  and on crash. Safe to run again — it updates rather than duplicates.
# =============================================================
set -euo pipefail

REPO="${REPO:-https://github.com/aykay47s/ron-cartel.git}"
APP_DIR=/opt/ron-cartel
ENV_FILE=/etc/ron-cartel.env
SERVICE=/etc/systemd/system/ron-cartel.service
DOMAIN="${1:-}"
PORT=3000

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this with sudo."
command -v apt-get >/dev/null || die "This script expects Ubuntu or Debian."

say "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git nginx postgresql postgresql-contrib ufw >/dev/null

if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  say "Installing Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
say "Node $(node -v), npm $(npm -v)"

say "Setting up the database"
systemctl enable --now postgresql >/dev/null 2>&1 || true
DB_NAME=roncartel
DB_USER=roncartel
if sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='$DB_USER'" | grep -q 1; then
  say "Database user already exists — keeping the current password"
  DB_PASS="$(grep -oP '(?<=://'"$DB_USER"':)[^@]+' "$ENV_FILE" 2>/dev/null || true)"
  [ -n "$DB_PASS" ] || die "User exists but $ENV_FILE has no password. Remove the role and re-run."
else
  DB_PASS="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)"
  sudo -u postgres psql -qc "create role $DB_USER login password '$DB_PASS';" >/dev/null
fi
sudo -u postgres psql -tAc "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"

say "Fetching the app"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin main -q && git -C "$APP_DIR" reset --hard origin/main -q
else
  rm -rf "$APP_DIR"
  git clone --depth 1 -q "$REPO" "$APP_DIR" \
    || die "Could not clone $REPO — if the repo is private, make it public or set REPO to a URL with a token."
fi

say "Installing dependencies"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund >/dev/null

say "Writing $ENV_FILE"
cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=$PORT
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
EOF
chmod 600 "$ENV_FILE"

id -u roncartel >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin roncartel
chown -R roncartel:roncartel "$APP_DIR"

say "Installing the service"
cat > "$SERVICE" <<EOF
[Unit]
Description=Ron Cartel
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=roncartel
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable ron-cartel >/dev/null 2>&1
systemctl restart ron-cartel

say "Waiting for it to come up"
for i in $(seq 1 30); do
  sleep 1
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then break; fi
  [ "$i" -eq 30 ] && { journalctl -u ron-cartel -n 30 --no-pager; die "The app did not start — log above."; }
done

say "Configuring nginx"
SERVER_NAME="${DOMAIN:-_}"
cat > /etc/nginx/sites-available/ron-cartel <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $SERVER_NAME;
    client_max_body_size 12M;          # product photos and payment screenshots

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/ron-cartel /etc/nginx/sites-enabled/ron-cartel
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 || die "nginx config test failed"
systemctl reload nginx

say "Firewall"
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 'Nginx Full' >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true

if [ -n "$DOMAIN" ]; then
  say "Getting an HTTPS certificate for $DOMAIN"
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
    || say "Certbot did not complete — check the domain's DNS points at this server, then run: certbot --nginx -d $DOMAIN"
fi

IP="$(curl -fsS -4 icanhazip.com 2>/dev/null || hostname -I | awk '{print $1}')"
URL="${DOMAIN:+https://$DOMAIN}"; URL="${URL:-http://$IP}"

cat <<EOF

  ────────────────────────────────────────────────
   Ron Cartel is live

     Shop    $URL
     Admin   $URL/admin      PIN 9247

   Change that PIN in Settings straight away.

   Useful:
     systemctl status ron-cartel
     journalctl -u ron-cartel -f
     bash install.sh${DOMAIN:+ $DOMAIN}     # re-run to update
  ────────────────────────────────────────────────

EOF
