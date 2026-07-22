import Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Api, TelegramClient } from 'teleproto';
import { config } from './config';
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
    .prepare('SELECT id FROM videos WHERE telegram_msg_id = ?')
    .get(msg.id) as { id: number } | undefined;

  const videoPath = path.resolve(config.clipsDir, `${msg.id}.mp4`);

  if (!exists) {
    const thumbPath = path.resolve(config.thumbsDir, `${msg.id}.webp`);

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
      '-vf',
      'scale=640:-2',
      '-quality',
      '80',
      thumbPath,
    ]);
  }
  const { description, sources } = parseCaption(caption);
  const sizeBytes = fs.existsSync(videoPath)
    ? fs.statSync(videoPath).size
    : null;

  const insertVideo = db.prepare(
    `
    INSERT INTO videos (telegram_msg_id, description, added_at, grouped_id, size_bytes)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(telegram_msg_id) DO UPDATE SET
      description = excluded.description,
      size_bytes = excluded.size_bytes
    `,
  );

  const deleteSources = db.prepare('DELETE FROM sources WHERE video_id = ?');

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
      msg.date,
      msg.groupedId?.toString() ?? null,
      sizeBytes,
    );
    const videoId =
      exists?.id ??
      (
        db
          .prepare('SELECT id FROM videos WHERE telegram_msg_id = ?')
          .get(msg.id) as Pick<Video, 'id'>
      ).id;
    deleteSources.run(videoId);
    for (const url of sources) {
      const ytId = extractYoutubeId(url);
      const meta = ytId ? ytMeta.get(ytId) : undefined;
      insertSource.run(
        videoId,
        url,
        meta?.title ?? null,
        meta?.publishedAt ?? null,
      );
    }
  });
  tx();

  console.log(`Saved/updated video ${msg.id}: ${description}`);
};
