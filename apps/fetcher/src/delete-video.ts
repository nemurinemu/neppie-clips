import Database from 'better-sqlite3';
import { removeMedia } from './media';

export const deleteVideos = (msgIds: number[], db: Database.Database) => {
  const find = db.prepare('SELECT id FROM videos WHERE telegram_msg_id = ?');
  const remove = db.prepare('DELETE FROM videos WHERE id = ?');

  const removed: number[] = [];
  db.transaction(() => {
    for (const msgId of msgIds) {
      const row = find.get(msgId) as { id: number } | undefined;
      if (!row) continue;
      remove.run(row.id);
      removed.push(row.id);
    }
  })();

  for (const id of removed) removeMedia(id);
  if (removed.length) {
    console.log(`Deleted ${removed.length} video(s): ${removed.join(', ')}`);
  }
};
