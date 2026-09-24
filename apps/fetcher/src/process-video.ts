import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { Api, TelegramClient } from 'teleproto';
import { makeThumbnail, probeVideo, removeMedia, thumbPath, videoPath } from './media';
import { parseCaption } from './parse-caption';
import { extractYoutubeId, fetchYoutubeMetadata } from './youtube';

const generateShareId = () => randomBytes(6).toString('base64url');

export const uniqueShareId = (db: Database.Database) => {
  const exists = db.prepare('SELECT 1 FROM videos WHERE share_id = ?');
  let id = generateShareId();
  while (exists.get(id)) id = generateShareId();
  return id;
};

export const processVideo = async (
  client: TelegramClient,
  msg: Api.Message,
  caption: string,
  db: Database.Database,
) => {
  const { description, sources } = parseCaption(caption);
  const row = db
    .prepare('SELECT id FROM videos WHERE telegram_msg_id = ?')
    .get(msg.id) as { id: number } | undefined;

  let id: number;
  if (row) {
    id = row.id;
  } else {
    // Insert first: the row id names the media files.
    id = Number(
      db
        .prepare(
          `INSERT INTO videos (telegram_msg_id, share_id, description, added_at, grouped_id)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          msg.id,
          uniqueShareId(db),
          description,
          msg.date,
          msg.groupedId?.toString() ?? null,
        ).lastInsertRowid,
    );
    // A delete arriving mid-download removes the row (and the partial file);
    // that surfaces either as a missing row afterwards or as a failed step.
    const stillWanted = () =>
      !!db.prepare('SELECT 1 FROM videos WHERE id = ?').get(id);
    try {
      await client.downloadMedia(msg, { outputFile: videoPath(id) });
      await makeThumbnail(videoPath(id), thumbPath(id));
    } catch (err) {
      const wanted = stillWanted();
      removeMedia(id);
      if (!wanted) {
        console.log(`Video ${id} (msg ${msg.id}) deleted mid-download, discarded`);
        return;
      }
      db.prepare('DELETE FROM videos WHERE id = ?').run(id);
      throw err;
    }
    if (!stillWanted()) {
      removeMedia(id);
      console.log(`Video ${id} (msg ${msg.id}) deleted mid-download, discarded`);
      return;
    }
  }

  const { sizeBytes, width, height } = await probeVideo(videoPath(id));

  const ytIds = sources
    .map(extractYoutubeId)
    .filter((id): id is string => !!id);
  const ytMeta =
    ytIds.length > 0 ? await fetchYoutubeMetadata(ytIds) : new Map();

  const updateVideo = db.prepare(
    `UPDATE videos SET description = ?, size_bytes = ?, width = ?, height = ?,
       updated_at = CASE WHEN ? THEN unixepoch() ELSE updated_at END
     WHERE id = ?`,
  );
  const deleteSources = db.prepare('DELETE FROM sources WHERE video_id = ?');
  const insertSource = db.prepare(
    'INSERT INTO sources (video_id, url, youtube_title, youtube_published_at) VALUES (?, ?, ?, ?)',
  );

  db.transaction(() => {
    updateVideo.run(description, sizeBytes, width, height, row ? 1 : 0, id);
    deleteSources.run(id);
    for (const url of sources) {
      const ytId = extractYoutubeId(url);
      const meta = ytId ? ytMeta.get(ytId) : undefined;
      insertSource.run(id, url, meta?.title ?? null, meta?.publishedAt ?? null);
    }
  })();

  console.log(`Saved/updated video ${id} (msg ${msg.id}): ${description}`);
};
