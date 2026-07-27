import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { config } from './config';

export const deleteVideos = (msgIds: number[], db: Database.Database) => {
  const exists = db.prepare('SELECT 1 FROM videos WHERE telegram_msg_id = ?');
  const remove = db.prepare('DELETE FROM videos WHERE telegram_msg_id = ?');

  const removed: number[] = [];
  const tx = db.transaction((ids: number[]) => {
    for (const id of ids) {
      if (!exists.get(id)) continue;
      remove.run(id);
      removed.push(id);
    }
  });
  tx(msgIds);

  for (const id of removed) {
    rmSync(path.resolve(config.clipsDir, `${id}.mp4`), { force: true });
    rmSync(path.resolve(config.thumbsDir, `${id}.webp`), { force: true });
  }
  if (removed.length) {
    console.log(`Deleted ${removed.length} video(s): ${removed.join(', ')}`);
  }
};
