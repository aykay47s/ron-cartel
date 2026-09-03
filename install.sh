#!/usr/bin/env bash
# =============================================================
#  Ron Cartel — one-shot installer
#
#    sudo bash install.sh                      # HTTP on the server IP
#    sudo bash install.sh shop.example.com     # + HTTPS via Let's Encrypt
#
#  Works on AlmaLinux / Rocky / RHEL 9 (dnf) and Ubuntu / Debian (apt).
#  Installs Node, Postgres and nginx, generates its own database password,
#  and runs the app under systemd so it survives reboots and crashes.
#  Safe to run again — it updates rather than duplicates.
# =============================================================
set -euo pipefail

REPO="${REPO:-https://github.com/aykay47s/ron-cartel.git}"
APP_DIR=/opt/ron-cartel
ENV_FILE=/etc/ron-cartel.env
SERVICE=/etc/systemd/system/ron-cartel.service
DOMAIN="${1:-}"
PORT=3000

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  ! \033[0m%s\n' "$*"; }
die()  { printf '\n\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this with sudo."

# ---------- which family are we on ----------
if   command -v dnf     >/dev/null 2>&1; then FAM=rhel;   PKG="dnf -y -q"
elif command -v apt-get >/dev/null 2>&1; then FAM=debian; PKG="apt-get -y -qq"
else die "Needs dnf (AlmaLinux/Rocky/RHEL) or apt (Ubuntu/Debian)."
fi
say "Detected $( . /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-$FAM}" )"

# ---------- packages ----------
say "Installing packages"
if [ "$FAM" = rhel ]; then
  $PKG install curl ca-certificates git nginx policycoreutils-python-utils \
               postgresql-server postgresql-contrib firewalld >/dev/null
else
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  $PKG install curl ca-certificates gnupg git nginx postgresql postgresql-contrib ufw >/dev/null
fi

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  say "Installing Node 22"
  if [ "$FAM" = rhel ]; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
    $PKG install nodejs >/dev/null
  else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
    $PKG install nodejs >/dev/null
  fi
fi
say "Node $(node -v), npm $(npm -v)"

# ---------- postgres ----------
say "Setting up Postgres"
if [ "$FAM" = rhel ]; then
  # AlmaLinux/Rocky 8 default the postgresql module to version 10, which is
  # long dead and stores passwords as md5 — that silently mismatches the
  # scram-sha-256 we set in pg_hba below. Take a modern stream if one exists.
  if dnf -q module list postgresql >/dev/null 2>&1; then
    for v in 16 15 13; do
      if dnf -q module list "postgresql:$v" >/dev/null 2>&1; then
        dnf -y -q module reset postgresql >/dev/null 2>&1 || true
        dnf -y -q module enable "postgresql:$v" >/dev/null 2>&1 && \
          { say "Using PostgreSQL $v"; dnf -y -q install postgresql-server postgresql-contrib >/dev/null; break; }
      fi
    done
  fi

  PGDATA_DIR=/var/lib/pgsql/data
  [ -f "$PGDATA_DIR/PG_VERSION" ] || postgresql-setup --initdb >/dev/null
  say "PostgreSQL $(cat "$PGDATA_DIR/PG_VERSION" 2>/dev/null || echo '?') data directory ready"

  # Store new passwords as scram, or the role we create below will be md5 and
  # authentication fails with a very unhelpful message.
  CONF="$PGDATA_DIR/postgresql.conf"
  if grep -qE '^\s*#?\s*password_encryption' "$CONF"; then
    sed -i -E 's|^\s*#?\s*password_encryption.*|password_encryption = scram-sha-256|' "$CONF"
  else
    echo "password_encryption = scram-sha-256" >> "$CONF"
  fi

  # RHEL ships pg_hba with 'ident' for local TCP, which rejects password logins.
  HBA="$PGDATA_DIR/pg_hba.conf"
  sed -i -E 's|^(host\s+all\s+all\s+127\.0\.0\.1/32\s+).*|\1scram-sha-256|' "$HBA"
  sed -i -E 's|^(host\s+all\s+all\s+::1/128\s+).*|\1scram-sha-256|' "$HBA"

  systemctl enable postgresql >/dev/null 2>&1 || true
  systemctl restart postgresql
  for i in $(seq 1 20); do
    sudo -u postgres psql -tAc 'select 1' >/dev/null 2>&1 && break
    sleep 1
    [ "$i" -eq 20 ] && { systemctl status postgresql --no-pager -l | tail -20; die "Postgres would not start."; }
  done
else
  systemctl enable --now postgresql >/dev/null 2>&1 || true
fi

DB_NAME=roncartel
DB_USER=roncartel
if sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='$DB_USER'" | grep -q 1; then
  say "Database user exists — reusing the password from $ENV_FILE"
  DB_PASS="$(sed -n 's|.*://'"$DB_USER"':\([^@]*\)@.*|\1|p' "$ENV_FILE" 2>/dev/null || true)"
  [ -n "$DB_PASS" ] || die "Role exists but $ENV_FILE has no password. Drop the role and re-run."
else
  DB_PASS="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)"
  sudo -u postgres psql -qc "create role $DB_USER login password '$DB_PASS';" >/dev/null
fi
sudo -u postgres psql -tAc "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"

# ---------- app ----------
say "Fetching the app"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin main -q && git -C "$APP_DIR" reset --hard origin/main -q
else
  rm -rf "$APP_DIR"
  git clone --depth 1 -q "$REPO" "$APP_DIR" \
    || die "Could not clone $REPO — if the repo is private, make it public or pass REPO=https://TOKEN@github.com/..."
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

id -u roncartel >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /sbin/nologin roncartel 2>/dev/null \
  || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin roncartel
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
ExecStart=$(command -v node) src/index.js
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
  curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break
  [ "$i" -eq 30 ] && { journalctl -u ron-cartel -n 40 --no-pager; die "App did not start — log above."; }
done

# ---------- nginx ----------
say "Configuring nginx"
SERVER_NAME="${DOMAIN:-_}"
VHOST='server {
    listen 80;
    listen [::]:80;
    server_name '"$SERVER_NAME"';
    client_max_body_size 12M;

    location / {
        proxy_pass http://127.0.0.1:'"$PORT"';
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}'
if [ "$FAM" = rhel ]; then
  printf '%s\n' "$VHOST" > /etc/nginx/conf.d/ron-cartel.conf
  # stop the stock welcome page winning the default_server slot
  [ -f /etc/nginx/nginx.conf ] && sed -i '/^\s*server\s*{/,/^\s*}/{ /listen\s*80 default_server/d }' /etc/nginx/nginx.conf || true
  # SELinux blocks nginx talking to a local port unless told otherwise
  if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" != "Disabled" ]; then
    setsebool -P httpd_can_network_connect 1 >/dev/null 2>&1 && say "SELinux: allowed nginx to reach the app" \
      || warn "Could not set the SELinux boolean — if you get 502s, run: setsebool -P httpd_can_network_connect 1"
  fi
else
  mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
  printf '%s\n' "$VHOST" > /etc/nginx/sites-available/ron-cartel
  ln -sf /etc/nginx/sites-available/ron-cartel /etc/nginx/sites-enabled/ron-cartel
  rm -f /etc/nginx/sites-enabled/default
fi
nginx -t >/dev/null 2>&1 || { nginx -t; die "nginx config test failed"; }
systemctl enable --now nginx >/dev/null 2>&1 || true
systemctl reload nginx 2>/dev/null || systemctl restart nginx

# ---------- firewall ----------
say "Opening the firewall"
if [ "$FAM" = rhel ]; then
  systemctl enable --now firewalld >/dev/null 2>&1 || true
  firewall-cmd --permanent --add-service=http  >/dev/null 2>&1 || true
  firewall-cmd --permanent --add-service=https >/dev/null 2>&1 || true
  firewall-cmd --permanent --add-service=ssh   >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
else
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 'Nginx Full' >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
fi

# ---------- hardening ----------
say "Hardening"
if [ "$FAM" = debian ]; then
  $PKG install unattended-upgrades fail2ban >/dev/null 2>&1 || true
  # Security patches apply themselves. A shop nobody patches is a shop that
  # eventually gets owned by a bug someone fixed a year ago.
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
else
  $PKG install epel-release >/dev/null 2>&1 || true
  $PKG install fail2ban dnf-automatic >/dev/null 2>&1 || true
  sed -i 's/^apply_updates.*/apply_updates = yes/' /etc/dnf/automatic.conf 2>/dev/null || true
  systemctl enable --now dnf-automatic.timer >/dev/null 2>&1 || true
fi

# Ban repeated SSH guessing. The console showed real brute-force noise already.
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
EOF
systemctl enable --now fail2ban >/dev/null 2>&1 || true

# Postgres listens on localhost only — never expose the database to the internet.
if [ "$FAM" = debian ]; then
  PGCONF="$(ls -d /etc/postgresql/*/main 2>/dev/null | tail -1)/postgresql.conf"
else
  PGCONF="$PGDATA_DIR/postgresql.conf"
fi
if [ -f "$PGCONF" ] && ! grep -qE "^listen_addresses *= *'localhost'" "$PGCONF"; then
  sed -i -E "s|^\s*#?\s*listen_addresses.*|listen_addresses = 'localhost'|" "$PGCONF"
  systemctl restart postgresql >/dev/null 2>&1 || true
  say "Database bound to localhost only"
fi

# ---------- backups ----------
say "Setting up nightly backups"
mkdir -p /var/backups/ron-cartel
cat > /usr/local/bin/ron-cartel-backup <<EOF
#!/usr/bin/env bash
# Nightly dump, 14 days kept. Orders are the one thing here that cannot be rebuilt.
set -euo pipefail
. $ENV_FILE
OUT=/var/backups/ron-cartel/\$(date +%Y-%m-%d).sql.gz
pg_dump "\$DATABASE_URL" | gzip > "\$OUT"
find /var/backups/ron-cartel -name '*.sql.gz' -mtime +14 -delete
EOF
chmod +x /usr/local/bin/ron-cartel-backup
cat > /etc/systemd/system/ron-cartel-backup.service <<'EOF'
[Unit]
Description=Ron Cartel database backup
[Service]
Type=oneshot
ExecStart=/usr/local/bin/ron-cartel-backup
EOF
cat > /etc/systemd/system/ron-cartel-backup.timer <<'EOF'
[Unit]
Description=Nightly Ron Cartel backup
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now ron-cartel-backup.timer >/dev/null 2>&1 || true
/usr/local/bin/ron-cartel-backup >/dev/null 2>&1 \
  && say "First backup written to /var/backups/ron-cartel" \
  || warn "First backup did not run — check: ron-cartel-backup"

# ---------- https ----------
if [ -n "$DOMAIN" ]; then
  say "Getting an HTTPS certificate for $DOMAIN"
  if [ "$FAM" = rhel ]; then
    $PKG install epel-release >/dev/null 2>&1 || true
    $PKG install certbot python3-certbot-nginx >/dev/null 2>&1 || true
  else
    $PKG install certbot python3-certbot-nginx >/dev/null 2>&1 || true
  fi
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
          --register-unsafely-without-email --redirect \
    || warn "Certbot did not finish — point the domain's DNS at this server, then: certbot --nginx -d $DOMAIN"
fi

IP="$(curl -fsS -4 --max-time 8 icanhazip.com 2>/dev/null || hostname -I | awk '{print $1}')"
URL="${DOMAIN:+https://$DOMAIN}"; URL="${URL:-http://$IP}"

cat <<EOF

  ────────────────────────────────────────────────
   Ron Cartel is live

     Shop    $URL
     Admin   $URL/admin      PIN 9247

   Do these two things first:
     1. Change the PIN in Settings
     2. Fill in Settings -> Business details (trading name, address, contact)
        Without them your Terms and footer say "not set yet", which looks worse
        than saying nothing.

   ${DOMAIN:+}${DOMAIN:-NOTE: running on a bare IP with no HTTPS. Browsers will
   say \"Not secure\" to every customer. Point a domain here and re-run with it
   to fix that: bash install.sh yourdomain.co.uk}

     systemctl status ron-cartel
     journalctl -u ron-cartel -f
     bash install.sh${DOMAIN:+ $DOMAIN}      # re-run to update
  ────────────────────────────────────────────────

EOF
