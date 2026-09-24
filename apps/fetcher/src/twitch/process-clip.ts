import Database from 'better-sqlite3';
import { probeVideo, removeMedia, videoPath } from '../media';
import { uniqueShareId } from '../process-video';
import { TwitchClip, TwitchIds } from './api';
import { downloadClip } from './download';

const now = () => Math.floor(Date.now() / 1000);

interface Stored {
  video_id: number;
  duration: number;
  thumbnail_url: string;
  title: string;
  note: string | null;
  size_bytes: number | null;
}

// The site shows the Twitch title plus an optional hand-written note
// (set on the admin page), like a multi-line caption on a manual clip.
export const describe = (title: string, note: string | null) =>
  note ? `${title}\n${note}` : title;

const upsertTwitchClip = (db: Database.Database) =>
  db.prepare(`
    INSERT INTO twitch_clips
      (video_id, clip_id, url, creator_id, created_at, duration, thumbnail_url, vod_id, vod_offset, title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(clip_id) DO UPDATE SET
      url = excluded.url, duration = excluded.duration,
      thumbnail_url = excluded.thumbnail_url, title = excluded.title,
      -- Get Clips by id omits the VOD link even when the VOD exists;
      -- never let that erase one learned from the listing.
      vod_id = COALESCE(excluded.vod_id, vod_id),
      vod_offset = COALESCE(excluded.vod_offset, vod_offset)
  `);

const twitchRow = (videoId: number, c: TwitchClip) => [
  videoId,
  c.id,
  c.url,
  c.creator_id,
  c.created_at,
  c.duration,
  c.thumbnail_url,
  c.video_id || null,
  c.vod_offset,
  c.title,
];

const fetchMedia = async (ids: TwitchIds, clip: TwitchClip, id: number, db: Database.Database) => {
  const dl = await downloadClip(ids, clip.id, id);
  const { width, height } = await probeVideo(videoPath(id));
  db.prepare(
    `UPDATE videos SET size_bytes = ?, width = ?, height = ?, has_vertical = ?, vertical_size_bytes = ?
     WHERE id = ?`,
  ).run(dl.sizeBytes, width, height, dl.verticalSizeBytes ? 1 : 0, dl.verticalSizeBytes, id);
};

export const processTwitchClip = async (
  ids: TwitchIds,
  clip: TwitchClip,
  db: Database.Database,
) => {
  const stored = db
    .prepare(
      `SELECT t.video_id, t.duration, t.thumbnail_url, t.title, t.note, v.size_bytes
       FROM twitch_clips t JOIN videos v ON v.id = t.video_id WHERE t.clip_id = ?`,
    )
    .get(clip.id) as Stored | undefined;

  if (!stored) {
    const id = Number(
      db
        .prepare(
          `INSERT INTO videos (source_platform, share_id, description, added_at)
           VALUES ('twitch', ?, ?, ?)`,
        )
        .run(uniqueShareId(db), clip.title, Math.floor(Date.parse(clip.created_at) / 1000))
        .lastInsertRowid,
    );
    upsertTwitchClip(db).run(...twitchRow(id, clip));
    try {
      await fetchMedia(ids, clip, id, db);
    } catch (err) {
      db.prepare('DELETE FROM videos WHERE id = ?').run(id);
      removeMedia(id);
      throw err;
    }
    console.log(`Saved twitch clip ${id} (${clip.id}): ${clip.title}`);
    return;
  }

  const id = stored.video_id;
  // A row without a size is a download that was interrupted (restart mid-poll).
  const contentChanged =
    stored.size_bytes === null ||
    stored.duration !== clip.duration ||
    stored.thumbnail_url !== clip.thumbnail_url;
  const titleChanged = stored.title !== clip.title;

  // Always refresh the twitch row: the VOD link can appear after the clip.
  upsertTwitchClip(db).run(...twitchRow(id, clip));

  if (contentChanged) {
    await fetchMedia(ids, clip, id, db);
  }
  if (contentChanged || titleChanged) {
    db.prepare('UPDATE videos SET description = ?, updated_at = ? WHERE id = ?').run(
      describe(clip.title, stored.note),
      now(),
      id,
    );
    console.log(
      `Updated twitch clip ${id} (${clip.id}): ${contentChanged ? 're-downloaded' : 'title'}`,
    );
  }
};
