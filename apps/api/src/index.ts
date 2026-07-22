import express, { Request, Response } from 'express';
import Database from 'better-sqlite3';
import { config } from './config';
import compression from 'compression';
import cors from 'cors';
import { Video, VideoResponse } from '@neppie-clips/shared';
import { readIndexHtml, injectMeta } from './html';

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
    id,
    telegram_msg_id as telegramMsgId,
    description,
    added_at as addedAt,
    size_bytes as sizeBytes
  FROM videos
  ORDER BY added_at DESC  
  `);

const sourcesStmt = db.prepare(`
  SELECT
    url,
    youtube_title as youtubeTitle,
    youtube_published_at as youtubePublishedAt 
  FROM sources
  WHERE video_id = ?
  `);

app.get('/api/videos', (req: Request, res: Response) => {
  try {
    const videos = videosStmt.all() as Video[];
    const result: VideoResponse[] = videos.map((video) => ({
      ...video,
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
  const clipByIdStmt = db.prepare(`
    SELECT id, telegram_msg_id as telegramMsgId, description
    FROM videos WHERE id = ?
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
    const id = typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isInteger(id)) {
      const clip = clipByIdStmt.get(id) as
        | { id: number; telegramMsgId: number; description: string | null }
        | undefined;
      if (clip) {
        const base =
          config.baseUrl || `${req.protocol}://${req.get('host') ?? ''}`;
        const desc = (clip.description ?? '').trim();
        const name = desc.split('\n')[0]?.trim() || `Neppie clip #${clip.id}`;
        html = injectMeta(html, {
          title: `${name} | Neppie clips`,
          image: `${base}/media/thumbnails/${clip.telegramMsgId}.webp`,
          url: `${base}/?video=${clip.id}`,
        });
      }
    }

    res.type('html').send(html);
  });
}

app.listen(config.port, () => {
  console.log(`API listening at port ${config.port}`);
});
