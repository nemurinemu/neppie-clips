import Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { Api, TelegramClient } from 'teleproto';
import { config, initConfig } from './config';
import { parseCaption } from './parse-caption';
import { extractYoutubeId, fetchYoutubeMetadata } from './youtube';
import { Video } from '@neppie-clips/shared';

const execFileAsync = promisify(execFile);

export const processVideo = async (
  client: TelegramClient,
  msg: Api.Message,
  caption: string,
  db: Database.Database,
) => {
  const exists = db
    .prepare('SELECT 1 FROM videos WHERE telegram_msg_id = ?')
    .get(msg.id);
  if (exists) return;

  const { description, sources } = parseCaption(caption);
  const videoFilename = `${msg.id}.mp4`;
  const thumbFilename = `${msg.id}.jpg`;
  const videoPath = path.resolve(config.clipsDir, videoFilename);
  const thumbPath = path.resolve(config.thumbsDir, thumbFilename);

  await client.downloadMedia(msg, { outputFile: videoPath });
  await execFileAsync('ffmpeg', [
    '-y',
    '-ss',
    '00:00:01',
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-update',
    '1',
    thumbPath,
  ]);

  const insertVideo = db.prepare(
    `
    INSERT INTO videos (telegram_msg_id, description, video_path, thumb_path, posted_at, grouped_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_msg_id) DO UPDATE SET
      description = excluded.description
    `,
  );
  const insertSource = db.prepare(
    'INSERT INTO sources (video_id, url, youtube_title, youtube_published_at) VALUES (?, ?, ?, ?)',
  );

  const ytIds = sources
    .map(extractYoutubeId)
    .filter((id): id is string => !!id);
  const ytMeta =
    ytIds.length > 0 ? await fetchYoutubeMetadata(ytIds) : new Map();

  const tx = db.transaction(() => {
    insertVideo.run(
      msg.id,
      description,
      videoFilename,
      thumbFilename,
      msg.date,
      msg.groupedId?.toString() ?? null,
    );
    const videoRow = db
      .prepare('SELECT id FROM videos WHERE telegram_msg_id = ?')
      .get(msg.id) as Pick<Video, 'id'>;
    for (const url of sources) {
      const ytId = extractYoutubeId(url);
      const meta = ytId ? ytMeta.get(ytId) : undefined;
      insertSource.run(
        videoRow.id,
        url,
        meta?.title ?? null,
        meta?.publishedAt ?? null,
      );
    }
  });
  tx();

  console.log(`Saved video ${msg.id}: ${description}`);
};
