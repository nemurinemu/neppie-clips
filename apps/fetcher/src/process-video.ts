import Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Api, TelegramClient } from 'teleproto';
import { config } from './config';
import { parseCaption } from './parse-caption';
import { extractYoutubeId, fetchYoutubeMetadata } from './youtube';
import { randomBytes } from 'node:crypto';

const generateShareId = () => randomBytes(6).toString('base64url');

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
  let width: number | undefined;
  let height: number | undefined;
  if (fs.existsSync(videoPath)) {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0:s=x',
      videoPath,
    ]);
    const [w, h] = stdout.trim().split('x').map(Number);
    width = Number.isFinite(w) ? w : undefined;
    height = Number.isFinite(h) ? h : undefined;
  }
  const insertVideo = db.prepare(
    `
    INSERT INTO videos (telegram_msg_id, share_id, description, added_at, grouped_id, size_bytes, width, height)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  const updateVideo = db.prepare(
    `
    UPDATE videos SET description = ?, size_bytes = ?, width = ?, height = ?
    WHERE telegram_msg_id = ?
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
    if (exists) {
      updateVideo.run(description, sizeBytes, width, height, msg.id);
    } else {
      insertVideo.run(
        msg.id,
        generateShareId(),
        description,
        msg.date,
        msg.groupedId?.toString() ?? null,
        sizeBytes,
        width,
        height,
      );
    }
    deleteSources.run(msg.id);
    for (const url of sources) {
      const ytId = extractYoutubeId(url);
      const meta = ytId ? ytMeta.get(ytId) : undefined;
      insertSource.run(
        msg.id,
        url,
        meta?.title ?? null,
        meta?.publishedAt ?? null,
      );
    }
  });
  tx();

  console.log(`Saved/updated video ${msg.id}: ${description}`);
};
