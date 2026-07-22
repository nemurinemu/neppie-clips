# Deploy

Server: pm2 runs the **api** and **fetcher**; nginx serves the built **client**
and the media files (`/media/*`) straight from disk. Transport is rsync over SSH.

## One-time setup (per server)

1. Fill in `scripts/deploy.env` (copy from `scripts/deploy.env.example`).
2. Create the server dirs: `REMOTE_ROOT` (monorepo) and `WEB_ROOT` (website).
3. Create the production env files **locally** (gitignored; rsync'd up on deploy):
   - `apps/api/.env.production` → `PORT=3200`, `CLIPS_DIR=<media dir>`,
     `WEB_INDEX=<WEB_ROOT>/index.html` (enables per-clip link previews)
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

## Per-clip link previews (SSR meta injection)

`?video=<id>` links unfurl with the clip's title + thumbnail. How it works:
nginx routes the bare `/` document to the api (`location = /`), which reads the
built `index.html` from `WEB_INDEX` and swaps the `<title>` / `og:*` tags when a
valid `?video=<id>` is present; every other request is served statically by
nginx as before. The api re-reads `index.html` when it changes on disk, so
`deploy:client` alone updates it — no api restart needed. If the api is down,
nginx serves the static `index.html` (site-wide card) instead of erroring.

Requires: `WEB_INDEX` in `apps/api/.env.production`, and the `location = /`
block in the nginx config. Set `BASE_URL` too only if the request host isn't the
public origin (normally leave it unset — the origin is derived from the request).
