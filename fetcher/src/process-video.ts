import Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { Api, TelegramClient } from 'telegram';
import { config, initConfig } from './config';
import { parseCaption } from './parse-caption';

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
  const videoPath = path.resolve(config.clipsDir, `${msg.id}.mp4`);
  const thumbPath = path.resolve(config.thumbsDir, `${msg.id}.jpg`);

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
    'INSERT INTO sources (video_id, url) VALUES (?, ?)',
  );

  const tx = db.transaction(() => {
    insertVideo.run(
      msg.id,
      description,
      videoPath,
      thumbPath,
      msg.date,
      msg.groupedId?.toString() ?? null,
    );
    const videoRow = db
      .prepare('SELECT id FROM videos WHERE telegram_msg_id = ?')
      .get(msg.id) as { id: number };
    for (const url of sources) {
      insertSource.run(videoRow.id, url);
    }
  });
  tx();
  console.log(`Saved video ${msg.id}: ${description}`);
};
