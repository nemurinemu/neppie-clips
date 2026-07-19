import express, { Request, Response } from 'express';
import Database from 'better-sqlite3';
import { config } from './config';
import compression from 'compression';
import cors from 'cors';
import { Video, VideoResponse } from '@neppie-clips/shared';

const app = express();
const db = new Database(config.dbPath, { readonly: true });

app.use(compression());

if (config.nodeEnv !== 'production') {
  app.use(cors({ origin: config.corsOrigin }));
}

const videosStmt = db.prepare(`
  SELECT
    id,
    description,
    added_at as addedAt
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

app.listen(config.port, () => {
  console.log(`API listening at port ${config.port}`);
});
