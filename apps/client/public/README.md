# Static assets

Drop files here; they are served from the site root (`/`).

- `banner.webp` — top banner, design ~2080×520 for a ~1040px column (`site.bannerSrc`). Omit to show the "Neppie clips" text title instead.
- `favicon.ico` — browser tab icon (32×32, or a multi-res .ico).
- `peek/*` — model images (webp/png) that peek in from the right on wide screens and appear at the bottom on mobile. Just drop files in `peek/`; one is picked at random. Restart the dev server after adding new ones.
- `sounds/*` — audio (mp3/ogg/wav/m4a/flac/webm) played at random when the peek image is clicked; clicks stack (overlap). Drop files in `sounds/`; restart the dev server after adding new ones.
