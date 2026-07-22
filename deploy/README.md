# Deploy

Server: pm2 runs the **api** and **fetcher**; nginx serves the built **client**
and the media files (`/media/*`) straight from disk. Transport is rsync over SSH.

## One-time setup (per server)

1. Fill in `scripts/deploy.env` (copy from `scripts/deploy.env.example`).
2. Create the server dirs: `REMOTE_ROOT` (monorepo) and `WEB_ROOT` (website).
3. Create the production env files **locally** (gitignored; rsync'd up on deploy):
   - `apps/api/.env.production` → `PORT=3200`, `CLIPS_DIR=<media dir>`
   - `apps/fetcher/.env.production` → `API_ID`, `API_HASH`, `TG_SESSION`,
     `CLIPS_DIR=<same media dir>`, `CHANNEL_NAME`, `YOUTUBE_API_KEY`
   Both `CLIPS_DIR` must be the same path (fetcher writes `videos.db`, api reads it).
   Only `.env.production` is pushed; other `.env*` files stay on your machine.
4. nginx: copy `deploy/nginx/neppie-clips.conf` into `sites-available`, replace
   `__DOMAIN__`, `__WEB_ROOT__`, `__CLIPS_DIR__`, symlink into `sites-enabled`,
   `nginx -t && systemctl reload nginx`. Then `certbot --nginx -d <domain>` for TLS.
5. First deploy: `pnpm deploy:all` (pm2 `startOrReload` starts the processes).
   Afterwards run `pm2 save` on the server so they survive reboots.

## Day to day

- `pnpm deploy:client` — build + rsync the site. **Restarts nothing** → fetcher untouched.
- `pnpm deploy:api` — rsync source, rebuild, reload only `neppie-api`.
- `pnpm deploy:fetcher` — rsync source, rebuild, reload only `neppie-fetcher`.
- `pnpm deploy:all` — everything (reloads both processes + redeploys the site).

Each command only reloads the process it names, so a website change never
bounces the fetcher and its Telegram session.

Editing a `.env.production` takes effect on the next `deploy:api` / `deploy:fetcher`
(rsync'd up, then `pm2 ... --update-env` reloads with the new values).
