import Database from 'better-sqlite3';
import { videoPath } from '../media';
import { alignClip } from './align';
import { getVideos } from './api';
import { streamBefore, streamContaining, streamLength, YoutubeStream } from './youtube';

// Largest per-stream offset observed before any alignment existed. Used
// when a stream isn't aligned yet; biased early on purpose.
const DEFAULT_OFFSET = 34;
const LEAD = 2;
// Twitch VOD and YouTube stream starts agreed within ±2s on every stream
// checked; allow much more and still never cross into another stream.
const START_TOLERANCE_MS = 5 * 60 * 1000;
// Measured on known clips: correct stream peak 0.71–0.92 / ratio 2.5–9.3,
// wrong stream peak ≤ 0.20 / ratio ≤ 1.31.
const MIN_PEAK = 0.5;
const MIN_RATIO = 2;
const RETRY_AFTER_S = 24 * 3600;
// A VOD-less clip created this long after a stream ended is assumed to be
// from that stream's VOD and gets a whole-stream scan; later than that it
// could be from any stream and goes to the admin page instead.
const AFTER_STREAM_MAX_S = 24 * 3600;

interface ClipRow {
  id: number;
  clip_id: string;
  vod_id: string | null;
  vod_offset: number | null;
  vod_created_at: string | null;
  created_at: string;
  duration: number;
  align_tried_at: number | null;
  assigned_stream: string | null;
}

const now = () => Math.floor(Date.now() / 1000);

const fallbackOffset = (db: Database.Database) =>
  (db.prepare('SELECT MAX(offset_seconds) m FROM youtube_streams').get() as { m: number | null }).m ??
  DEFAULT_OFFSET;

export const youtubeUrl = (streamId: string, seconds: number) =>
  `https://www.youtube.com/watch?v=${streamId}&t=${Math.max(0, seconds)}s`;

// The YouTube stream whose window contains the Twitch stream's start.
const streamForVod = (db: Database.Database, vodCreatedAt: string) => {
  const t = Date.parse(vodCreatedAt);
  return db
    .prepare(
      `SELECT * FROM youtube_streams
       WHERE started_at <= ? AND (ended_at IS NULL OR ended_at >= ?)
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(new Date(t + START_TOLERANCE_MS).toISOString(), new Date(t).toISOString()) as
    | YoutubeStream
    | undefined;
};

// Seconds into the YouTube video where the clip starts, before the
// per-stream offset is applied.
const rawSeconds = (stream: YoutubeStream, vodCreatedAt: string, vodOffset: number) =>
  vodOffset - (Date.parse(stream.started_at) - Date.parse(vodCreatedAt)) / 1000;

const writeSource = (
  db: Database.Database,
  videoId: number,
  stream: YoutubeStream,
  seconds: number,
  approximate: boolean,
) => {
  db.transaction(() => {
    db.prepare(`DELETE FROM sources WHERE video_id = ? AND url LIKE '%youtube.com/watch%'`).run(videoId);
    db.prepare('INSERT INTO sources (video_id, url, youtube_title, youtube_published_at) VALUES (?, ?, ?, ?)').run(
      videoId,
      youtubeUrl(stream.id, Math.round(seconds)),
      stream.title,
      stream.published_at,
    );
    db.prepare('UPDATE videos SET needs_review = ? WHERE id = ?').run(approximate ? 1 : 0, videoId);
  })();
};

// Learn VOD start times while the VODs still exist; they outlive the VOD.
const learnVodStarts = async (db: Database.Database) => {
  const pending = db
    .prepare('SELECT DISTINCT vod_id FROM twitch_clips WHERE vod_id IS NOT NULL AND vod_created_at IS NULL')
    .all() as { vod_id: string }[];
  if (!pending.length) return 0;
  const vods = await getVideos(pending.map((p) => p.vod_id));
  const set = db.prepare('UPDATE twitch_clips SET vod_created_at = ? WHERE vod_id = ?');
  for (const v of vods) set.run(v.created_at, v.id);
  return vods.length;
};

const unmatchedClips = (db: Database.Database) =>
  db
    .prepare(
      `SELECT v.id, t.clip_id, t.vod_id, t.vod_offset, t.vod_created_at, t.created_at, t.duration,
              t.align_tried_at, t.assigned_stream
       FROM videos v JOIN twitch_clips t ON t.video_id = v.id
       WHERE v.size_bytes IS NOT NULL
         AND COALESCE(t.align_status, '') != 'dismissed'
         AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.video_id = v.id AND s.url LIKE '%youtube.com/watch%')`,
    )
    .all() as ClipRow[];

// Clips with an exact Twitch position: the stream is certain from the VOD
// start; the time is exact once the stream is aligned, early-biased before.
const matchVodClips = (db: Database.Database) => {
  const offset = fallbackOffset(db);
  let matched = 0;
  let noStream = 0;
  for (const row of unmatchedClips(db)) {
    if (row.vod_created_at === null || row.vod_offset === null) continue;
    const stream = streamForVod(db, row.vod_created_at);
    if (!stream) {
      db.prepare('UPDATE videos SET needs_review = 1 WHERE id = ?').run(row.id);
      noStream++;
      continue;
    }
    const raw = rawSeconds(stream, row.vod_created_at, row.vod_offset);
    writeSource(db, row.id, stream, raw - (stream.offset_seconds ?? offset) - LEAD, stream.offset_seconds === null);
    matched++;
  }
  return { matched, noStream };
};

const confident = (a: { peak: number; ratio: number }) => a.peak >= MIN_PEAK && a.ratio >= MIN_RATIO;

const clampWindow = (stream: YoutubeStream, from: number, to: number) => {
  const len = streamLength(stream);
  return len === null ? null : { from: Math.max(0, from), to: Math.min(len - 1, to) };
};

// One alignment per stream: any clip with an exact Twitch position on it
// gives the stream's offset, which then re-times every clip on the stream.
const alignStreams = async (db: Database.Database, limit: number) => {
  const cutoff = now() - RETRY_AFTER_S;
  const streams = db
    .prepare(
      `SELECT s.* FROM youtube_streams s
       WHERE s.offset_seconds IS NULL AND s.ended_at IS NOT NULL
         AND (s.align_tried_at IS NULL OR s.align_tried_at < ?)
         AND EXISTS (SELECT 1 FROM sources src JOIN twitch_clips t ON t.video_id = src.video_id
                     WHERE src.url LIKE '%v=' || s.id || '&%' AND t.vod_offset IS NOT NULL)
       ORDER BY s.started_at DESC LIMIT ?`,
    )
    .all(cutoff, Number.isFinite(limit) ? limit : -1) as YoutubeStream[];

  let ok = 0;
  let failed = 0;
  for (const stream of streams) {
    // Longest clips first: more onsets, stronger correlation. A clip that's
    // mostly music can still fail, so try a few before giving up.
    const clips = db
      .prepare(
        `SELECT t.video_id AS id, t.vod_offset, t.vod_created_at FROM twitch_clips t
         JOIN sources src ON src.video_id = t.video_id
         WHERE src.url LIKE '%v=' || ? || '&%' AND t.vod_offset IS NOT NULL
         ORDER BY t.duration DESC LIMIT 3`,
      )
      .all(stream.id) as { id: number; vod_offset: number; vod_created_at: string }[];
    let result: 'ok' | 'failed' = 'failed';
    const tried: string[] = [];
    for (const clip of clips) {
      const raw = rawSeconds(stream, clip.vod_created_at, clip.vod_offset);
      const win = clampWindow(stream, raw - 90, raw + 30);
      try {
        if (!win) throw new Error('stream still live');
        const a = await alignClip(videoPath(clip.id), stream.id, win);
        tried.push(`clip ${clip.id}: peak ${a.peak.toFixed(2)} ratio ${a.ratio.toFixed(1)}`);
        if (confident(a)) {
          const offset = Math.round(raw - a.seconds);
          db.prepare(`UPDATE youtube_streams SET offset_seconds = ?, align_status = 'ok', align_tried_at = ? WHERE id = ?`).run(offset, now(), stream.id);
          retimeStream(db, { ...stream, offset_seconds: offset });
          console.log(`Aligned stream ${stream.id} (${stream.title.slice(0, 40)}): offset ${offset}s, peak ${a.peak.toFixed(2)}, ratio ${a.ratio.toFixed(1)}`);
          result = 'ok';
          break;
        }
      } catch (err) {
        console.error(`Aligning stream ${stream.id} failed:`, err instanceof Error ? err.message : err);
      }
    }
    if (result === 'failed') {
      console.log(`Stream ${stream.id} not confident — ${tried.join('; ') || 'no clip to try'}`);
      db.prepare(`UPDATE youtube_streams SET align_status = 'failed', align_tried_at = ? WHERE id = ?`).run(now(), stream.id);
      failed++;
    } else ok++;
  }
  return { ok, failed };
};

// Re-time every VOD-positioned clip on a stream with its (new) offset.
const retimeStream = (db: Database.Database, stream: YoutubeStream) => {
  const rows = db
    .prepare(
      `SELECT t.video_id AS id, t.vod_offset, t.vod_created_at FROM twitch_clips t
       JOIN sources src ON src.video_id = t.video_id
       WHERE src.url LIKE '%v=' || ? || '&%' AND t.vod_offset IS NOT NULL AND t.vod_created_at IS NOT NULL`,
    )
    .all(stream.id) as { id: number; vod_offset: number; vod_created_at: string }[];
  for (const r of rows) {
    writeSource(db, r.id, stream, rawSeconds(stream, r.vod_created_at, r.vod_offset) - stream.offset_seconds! - LEAD, false);
  }
};

// Clips without a Twitch position: creation time only nominates candidates;
// a source is written only if exactly one candidate aligns with confidence.
// Made during a stream → that stream, searched near the moment. Made within
// a day after a stream ended → that stream's VOD, searched whole. Later →
// could be any stream: left for the admin page.
const alignClips = async (db: Database.Database, limit: number) => {
  const cutoff = now() - RETRY_AFTER_S;
  const rows = unmatchedClips(db)
    .filter(
      (r) => (r.vod_created_at === null || r.vod_offset === null) && (r.align_tried_at === null || r.align_tried_at < cutoff),
    )
    .sort((a, b) => Number(!!b.assigned_stream) - Number(!!a.assigned_stream) || a.id - b.id);
  // Only record a result if nobody reassigned the clip on the admin page
  // while the (slow) scan ran; a new assignment must be tried, not skipped.
  const mark = db.prepare(
    `UPDATE twitch_clips SET align_status = ?, align_tried_at = ?
     WHERE video_id = ? AND COALESCE(assigned_stream, '') = ?`,
  );
  let ok = 0;
  let failed = 0;
  for (const row of rows.slice(0, limit)) {
    // The clip ends around created_at; its start is up to ~a minute earlier.
    const moment = new Date(Date.parse(row.created_at) - row.duration * 1000).toISOString();
    const candidates: { stream: YoutubeStream; range: { from: number; to: number } | null }[] = [];
    // A stream picked by hand on the admin page is the only candidate.
    const assigned = row.assigned_stream
      ? (db.prepare('SELECT * FROM youtube_streams WHERE id = ?').get(row.assigned_stream) as YoutubeStream | undefined)
      : undefined;
    if (assigned?.ended_at) {
      candidates.push({ stream: assigned, range: null });
    } else if (!row.assigned_stream) {
      const during = streamContaining(db, moment);
      if (during?.ended_at) {
        const est = (Date.parse(moment) - Date.parse(during.started_at)) / 1000;
        const range = clampWindow(during, est - 150, est + 30);
        if (range && range.to > range.from) candidates.push({ stream: during, range });
      }
      const before = streamBefore(db, row.created_at);
      if (before?.ended_at && before.id !== during?.id) {
        const after = (Date.parse(row.created_at) - Date.parse(before.ended_at)) / 1000;
        if (after <= AFTER_STREAM_MAX_S) candidates.push({ stream: before, range: null });
      }
    }

    const hits: { stream: YoutubeStream; seconds: number; peak: number; ratio: number }[] = [];
    const tried: string[] = [];
    for (const { stream, range } of candidates) {
      try {
        const a = await alignClip(videoPath(row.id), stream.id, range);
        tried.push(`${stream.id}${range ? '' : ' (whole)'}: peak ${a.peak.toFixed(2)} ratio ${a.ratio.toFixed(1)} at ${Math.round(a.seconds)}s`);
        if (confident(a)) hits.push({ stream, seconds: a.seconds, peak: a.peak, ratio: a.ratio });
      } catch (err) {
        console.error(`Aligning clip ${row.clip_id} on ${stream.id} failed:`, err instanceof Error ? err.message : err);
      }
    }
    if (hits.length === 1) {
      const h = hits[0]!;
      writeSource(db, row.id, h.stream, h.seconds - LEAD, false);
      mark.run('ok', now(), row.id, row.assigned_stream ?? '');
      console.log(`Aligned clip ${row.id} to ${h.stream.id} at ${Math.round(h.seconds)}s (peak ${h.peak.toFixed(2)}, ratio ${h.ratio.toFixed(1)})`);
      ok++;
    } else {
      db.prepare('UPDATE videos SET needs_review = 1 WHERE id = ?').run(row.id);
      mark.run('failed', now(), row.id, row.assigned_stream ?? '');
      console.log(`Clip ${row.id} unmatched: ${candidates.length} candidate(s), ${hits.length} confident${tried.length ? ` — ${tried.join('; ')}` : ''}`);
      failed++;
    }
  }
  return { ok, failed };
};

export const matchSources = async (db: Database.Database) => {
  const learned = await learnVodStarts(db);
  return { learned, ...matchVodClips(db) };
};

// One unit of alignment work: a stream if any is waiting, else a clip.
// Returns false when there was nothing to do.
export const alignNext = async (db: Database.Database) => {
  const streams = await alignStreams(db, 1);
  if (streams.ok + streams.failed > 0) return true;
  const clips = await alignClips(db, 1);
  return clips.ok + clips.failed > 0;
};
