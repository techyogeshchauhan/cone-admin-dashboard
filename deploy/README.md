# Deploying CONE (https://cone.ved.bio)

The dashboard and API run on the VPS `187.127.178.185` (SSH alias `neelmani`, user `root`) from a Git clone of this repository.

| What | Where |
|---|---|
| Code (Git clone of `main`) | `/var/www/cone`, owned by the `cone` user |
| Secrets, never in Git | `/var/www/cone/.env`, `/var/www/cone/firebase-service-account.json` |
| Uploaded files (logos, selfies) | `/var/www/cone/storage/` |
| Services | `cone-api` (127.0.0.1:8099) and `cone-worker`, see `cone-*.service` |
| nginx site | `/etc/nginx/sites-available/cone`, see `cone.nginx` (HTTPS via certbot) |

## Updating the site

1. Commit and push your change to `main` on GitHub.
2. Run:

   ```bash
   ssh neelmani /var/www/cone/deploy/deploy.sh
   ```

   It pulls `main`, runs `npm ci` and `npm run build`, restarts both services and checks `/api/health`.

The script only fast-forwards. If someone edited files directly on the server, it stops; check with `sudo -u cone git -C /var/www/cone status`.

Frontend settings (`VITE_*`) are compiled in at build time, so after editing them in `.env` run `deploy.sh` again. Server-only settings need just `systemctl restart cone-api cone-worker`.

## Logs and status

```bash
systemctl status cone-api cone-worker
journalctl -u cone-api -u cone-worker -f
```

## Server `.env` differences from local

Start from `.env.example` and set:

```dotenv
PORT=8099
HOST=127.0.0.1
TRUST_PROXY=loopback
ADMIN_BASE_URL=https://cone.ved.bio
CORS_ALLOWED_ORIGINS=https://cone.ved.bio
GOOGLE_APPLICATION_CREDENTIALS=/var/www/cone/firebase-service-account.json
STORAGE_ROOT=/var/www/cone/storage
```

Public one-click test logins (temporary, testing only) additionally need `ENABLE_DASHBOARD_ROLE_LOGIN=true`, `VITE_ENABLE_DASHBOARD_ROLE_LOGIN=true`, `ALLOW_REMOTE_ROLE_LOGIN=true`, `VITE_ALLOW_REMOTE_ROLE_LOGIN=true` and `storage/admin-test-credentials.json`. To turn them off, set the first two to `false`, delete the other two lines and the credentials file, then run `deploy.sh`.

## First-time setup on a new server

```bash
useradd --system --home /var/www/cone --shell /usr/sbin/nologin cone
git clone https://github.com/techyogeshchauhan/cone-admin-dashboard.git /var/www/cone
# copy .env and firebase-service-account.json in, chmod 600, mkdir storage
chown -R cone:cone /var/www/cone
cp /var/www/cone/deploy/cone-*.service /etc/systemd/system/ && systemctl daemon-reload
systemctl enable cone-api cone-worker
cp /var/www/cone/deploy/cone.nginx /etc/nginx/sites-available/cone
ln -s /etc/nginx/sites-available/cone /etc/nginx/sites-enabled/cone
/var/www/cone/deploy/deploy.sh
```

On a fresh server, `cone.nginx` refers to certificates that do not exist yet. Remove its certbot lines, keep a plain `listen 80;` block, then run `certbot --nginx -d cone.ved.bio --redirect`.
