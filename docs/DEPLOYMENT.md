# Deployment (isolated, single VPS)

ASK AI Video Studio is designed to run **alongside** other applications without touching them.

## Recommended layout

```
/srv/ask-ai-video-studio/          (or any NEW directory you own)
├── app/                ← git clone (public code only)
└── private-runtime/    ← PRIVATE_STORAGE_ROOT (never in Git, chmod 700)
    ├── database/  media/  uploads/  thumbnails/  exports/  temp/
    ├── logs/  backups/  browser-profiles/  flow-lab/  imports/  config/
```

Choose a directory that does not exist yet. On first start the app creates the private layout and writes a marker file. It will **refuse** a non-empty directory without that marker.

## Install

```bash
node --version    # must be >= 22.5; use a per-user version manager rather than changing a global runtime
cd /srv/ask-ai-video-studio && git clone <repo> app && cd app
cp .env.example .env && chmod 600 .env
# edit .env: PRIVATE_STORAGE_ROOT=/srv/ask-ai-video-studio/private-runtime, APP_SECRET=<random>, PORT=<free port>
npm run create-user -- --email you@your-domain.example --name "Your Name"
```

Pick a `PORT` that is free (check with `ss -ltn`). If the port is taken, the app exits with a clear message instead of interfering.

## Start / stop ONLY this app

Foreground: `npm start`. Stop with Ctrl-C (a graceful shutdown marks any in-flight job INTERRUPTED so it can be resumed).

Optional user-level systemd unit (`~/.config/systemd/user/ask-ai-video-studio.service`). This does not modify system services:

```ini
[Unit]
Description=ASK AI Video Studio
[Service]
WorkingDirectory=/srv/ask-ai-video-studio/app
ExecStart=/usr/bin/env node --disable-warning=ExperimentalWarning src/server.js
Restart=on-failure
[Install]
WantedBy=default.target
```

`systemctl --user start|stop|status ask-ai-video-studio`

## Access

- **Desktop:** `http://127.0.0.1:<PORT>` on the server, or through an SSH tunnel: `ssh -L 4310:127.0.0.1:4310 you@your-domain.example`.
- **Mobile / internet:** put the app behind HTTPS on a domain you control (`https://studio.your-domain.example`), set `COOKIE_SECURE=true` and `TRUST_PROXY=true`. Adding a reverse-proxy site is a change to shared infrastructure: review it separately and never edit existing sites.
- Binding `HOST=0.0.0.0` exposes plain HTTP. Use it only on a trusted LAN.

## Backup / restore

`npm run backup` writes `backups/backup-<timestamp>/` inside the private root: a consistent SQLite snapshot (`VACUUM INTO`), `media.tar.gz` and a manifest. Use `--db-only` to skip media. To restore, stop the app, copy `studio.sqlite` to `database/`, extract `media.tar.gz` into the private root, then start the app. Copy backups off-server using your own process. This app never touches other backup systems.

## Safe removal / rollback (affects only this app)

1. Stop it (`Ctrl-C` or `systemctl --user stop ask-ai-video-studio`, then `systemctl --user disable` and remove that unit file).
2. Optionally run `npm run backup` and keep the backup.
3. Delete only `/srv/ask-ai-video-studio/app` and, if you no longer need the data, `/srv/ask-ai-video-studio/private-runtime`.

Nothing else on the system was installed or modified.
