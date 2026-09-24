import express, { Request, Response } from 'express';
import Database from 'better-sqlite3';
import { config } from './config';
import compression from 'compression';
import cors from 'cors';
import { Video, VideoResponse } from '@neppie-clips/shared';
import { readIndexHtml, injectMeta } from './html';
import { adminRouter } from './admin';

const app = express();
app.set('trust proxy', true);
const db = new Database(config.dbPath, { readonly: true });

app.use(compression());

if (config.nodeEnv !== 'production') {
  app.use(cors({ origin: config.corsOrigin }));
  app.use('/media/videos', express.static(config.clipsDir));
  app.use('/media/thumbnails', express.static(config.thumbsDir));
}

const videosStmt = db.prepare(`
  SELECT
    v.id,
    v.share_id as shareId,
    v.description,
    ROW_NUMBER() OVER (ORDER BY v.added_at ASC, v.id ASC) AS clipNumber,
    v.added_at as addedAt,
    v.size_bytes as sizeBytes,
    v.width,
    v.height,
    v.source_platform as platform,
    v.has_vertical as hasVertical,
    v.vertical_size_bytes as verticalSizeBytes,
    t.url as twitchUrl
  FROM videos v
  LEFT JOIN twitch_clips t ON t.video_id = v.id
  WHERE v.size_bytes IS NOT NULL
  ORDER BY v.added_at DESC
  `);

const sourcesStmt = db.prepare(`
  SELECT
    url,
    youtube_title as youtubeTitle,
    youtube_published_at as youtubePublishedAt 
  FROM sources
  WHERE video_id = ?
  `);

app.use('/api/admin', adminRouter());

app.get('/api/videos', (req: Request, res: Response) => {
  try {
    const videos = videosStmt.all() as Video[];
    const result: VideoResponse[] = videos.map((video) => ({
      ...video,
      hasVertical: !!video.hasVertical,
      sources: sourcesStmt.all(video.id) as VideoResponse['sources'],
    }));
    res.json(result);
  } catch (err) {
    console.error('Failed to fetch videos:', err);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// Per-clip link previews: serve index.html with clip-specific meta tags when
// the URL carries ?video=<id>. Enabled only when WEB_INDEX is configured
// (production), so dev keeps serving the page through Vite untouched.
if (config.webIndex) {
  const webIndex = config.webIndex;
  const clipByShareStmt = db.prepare(`
    SELECT id, description, width, height
    FROM videos WHERE share_id = ?
  `);

  app.get('/', (req: Request, res: Response) => {
    let html: string;
    try {
      html = readIndexHtml(webIndex);
    } catch {
      res.status(500).end(); // nginx falls back to the static index
      return;
    }

    const raw = req.query.video;
    const shareId = typeof raw === 'string' ? raw : '';
    if (shareId) {
      const clip = clipByShareStmt.get(shareId) as
        | {
            id: number;
            description: string | null;
            width: number | null;
            height: number | null;
          }
        | undefined;
      if (clip) {
        const base =
          config.baseUrl || `${req.protocol}://${req.get('host') ?? ''}`;
        const videoBase = config.videoBase || `${base}/media`;
        const desc = (clip.description ?? '').trim();
        const name = desc.split('\n')[0]?.trim() || 'Neppie clip';
        html = injectMeta(html, {
          title: `${name} | Neppie clips`,
          image: `${base}/media/thumbnails/${clip.id}.webp`,
          url: `${base}/?video=${shareId}`,
          video: {
            url: `${videoBase}/videos/${clip.id}.mp4`,
            type: 'video/mp4',
            width: clip.width ?? undefined,
            height: clip.height ?? undefined,
          },
        });
      }
    }

    res.type('html').send(html);
  });
}

app.listen(config.port, () => {
  console.log(`API listening at port ${config.port}`);
});
