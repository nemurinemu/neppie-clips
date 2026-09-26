import Database from 'better-sqlite3';
import { videoPath } from '../media';
import { alignClip, envelope, findIn, isCached, youtubeEnvelope, youtubePaused, YoutubeDownloadError } from './align';
import { getVideos, getVodPositions } from './api';
import { streamBefore, streamContaining, streamLength, YoutubeStream } from './youtube';

// Used only until at least one stream has been aligned.
const DEFAULT_OFFSET = 53;
const LEAD = 2;
// Twitch VOD and YouTube stream starts agreed within ±2s on every stream
// checked; allow much more and still never cross into another stream.
const START_TOLERANCE_MS = 5 * 60 * 1000;
// Measured on known clips: correct stream peak 0.71–0.92 / ratio 2.5–9.3,
// wrong stream peak ≤ 0.20 / ratio ≤ 1.31.
const MIN_PEAK = 0.5;
const MIN_RATIO = 2;
const RETRY_AFTER_S = 24 * 3600;
// Twitch's clip positions are off by up to ~45 s, differently per clip, so
// each clip is also matched by audio — only within this many seconds of
// where its link already points, so a match can never move it further.
const SEARCH_S = 120;
// Wait until clipping on a stream has settled, so a burst of clips (e.g.
// clipping from a VOD) shares one audio download.
const SETTLE_S = 30 * 60;
// Short clips carry fewer onsets; they need a clearly stronger match.
const SHORT_CLIP_S = 15;
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

// Typical offset across aligned streams: the restream delay is near-constant
// (52–56 s on most streams), so the median lands within a few seconds when a
// stream can't be aligned. Outliers (special streams) don't skew it.
const fallbackOffset = (db: Database.Database) => {
  const offsets = (db.prepare(`SELECT offset_seconds o FROM youtube_streams WHERE align_status = 'ok' AND offset_seconds IS NOT NULL ORDER BY o`).all() as { o: number }[]).map((r) => r.o);
  return offsets.length ? offsets[Math.floor(offsets.length / 2)]! : DEFAULT_OFFSET;
};

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
      stream.started_at,
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

// Last YouTube download success/failure, shown on the admin page so a
// broken cookie file doesn't go unnoticed.
const recordYoutube = (db: Database.Database, err?: unknown) => {
  if (err !== undefined && (!(err instanceof YoutubeDownloadError) || err.paused)) return;
  db.prepare(
    `INSERT INTO app_status (key, value, at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at`,
  ).run(err ? 'youtube_error' : 'youtube_ok', err instanceof Error ? err.message : null, now());
};

const confident = (a: { peak: number; ratio: number }) => a.peak >= MIN_PEAK && a.ratio >= MIN_RATIO;
const confidentFor = (a: { peak: number; ratio: number }, duration: number) =>
  duration < SHORT_CLIP_S ? a.peak >= 0.65 && a.ratio >= 2.5 : confident(a);

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
        const fresh = !isCached(stream.id);
        const a = await alignClip(videoPath(clip.id), stream.id, win);
        if (fresh) recordYoutube(db);
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
        recordYoutube(db, err);
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
       WHERE src.url LIKE '%v=' || ? || '&%' AND t.vod_offset IS NOT NULL AND t.vod_created_at IS NOT NULL
         AND COALESCE(t.align_status, '') NOT IN ('ok', 'manual', 'dismissed')`,
    )
    .all(stream.id) as { id: number; vod_offset: number; vod_created_at: string }[];
  for (const r of rows) {
    writeSource(db, r.id, stream, rawSeconds(stream, r.vod_created_at, r.vod_offset) - stream.offset_seconds! - LEAD, false);
  }
};

// Every clip with a Twitch position on a finished stream gets one audio
// check against a single download of the stream. A confident match makes
// its link exact; otherwise it keeps the estimate ('estimate'). The stream's
// offset, if still unknown, becomes the median of the matched clips.
const alignVodClips = async (db: Database.Database) => {
  const cutoff = now() - RETRY_AFTER_S;
  const pending = `
    FROM twitch_clips t JOIN sources src ON src.video_id = t.video_id
    WHERE src.url LIKE '%v=' || ? || '&%' AND t.vod_offset IS NOT NULL AND t.vod_created_at IS NOT NULL
      AND t.align_status IS NULL AND (t.align_tried_at IS NULL OR t.align_tried_at < ?)`;
  const settled = new Date(Date.now() - SETTLE_S * 1000).toISOString();
  const stream = (
    db.prepare('SELECT * FROM youtube_streams WHERE ended_at IS NOT NULL ORDER BY started_at DESC').all() as YoutubeStream[]
  ).find(
    (st) =>
      db.prepare(`SELECT 1 ${pending}`).get(st.id, cutoff) &&
      !db.prepare(`SELECT 1 ${pending} AND t.created_at > ?`).get(st.id, cutoff, settled),
  );
  if (!stream) return false;
  const clips = db
    .prepare(`SELECT t.video_id AS id, t.vod_offset, t.vod_created_at, t.duration, src.url ${pending}`)
    .all(stream.id, cutoff) as { id: number; vod_offset: number; vod_created_at: string; duration: number; url: string }[];

  let env: Float32Array;
  try {
    const fresh = !isCached(stream.id);
    env = await youtubeEnvelope(stream.id);
    if (fresh) recordYoutube(db);
  } catch (err) {
    recordYoutube(db, err);
    console.error(`Stream ${stream.id} audio download failed:`, err instanceof Error ? err.message : err);
    const tried = db.prepare('UPDATE twitch_clips SET align_tried_at = ? WHERE video_id = ?');
    for (const c of clips) tried.run(now(), c.id);
    return true;
  }

  const mark = db.prepare(`UPDATE twitch_clips SET align_status = ?, align_tried_at = ? WHERE video_id = ? AND align_status IS NULL`);
  const offsets: number[] = [];
  let matched = 0;
  for (const c of clips) {
    const current = Number(new URL(c.url).searchParams.get('t')?.replace(/s$/, ''));
    const range = Number.isFinite(current) ? clampWindow(stream, current + LEAD - SEARCH_S, current + LEAD + SEARCH_S) : null;
    let status = 'estimate';
    try {
      if (!range) throw new Error('no link time');
      const a = findIn(await envelope(videoPath(c.id)), env, range);
      const still = db.prepare('SELECT align_status FROM twitch_clips WHERE video_id = ?').get(c.id) as { align_status: string | null } | undefined;
      if (confidentFor(a, c.duration) && still && still.align_status === null) {
        writeSource(db, c.id, stream, a.seconds - LEAD, false);
        offsets.push(rawSeconds(stream, c.vod_created_at, c.vod_offset) - a.seconds);
        status = 'ok';
        matched++;
        console.log(`Clip ${c.id} matched: moved ${Math.round(a.seconds - LEAD - current)}s (peak ${a.peak.toFixed(2)}, ratio ${a.ratio.toFixed(1)})`);
      } else {
        console.log(`Clip ${c.id} kept estimate (peak ${a.peak.toFixed(2)}, ratio ${a.ratio.toFixed(1)}, ${Math.round(c.duration)}s)`);
      }
    } catch (err) {
      console.error(`Clip ${c.id} audio check failed:`, err instanceof Error ? err.message : err);
    }
    mark.run(status, now(), c.id);
  }

  if (stream.offset_seconds === null && offsets.length) {
    offsets.sort((a, b) => a - b);
    const offset = Math.round(offsets[Math.floor(offsets.length / 2)]!);
    db.prepare(`UPDATE youtube_streams SET offset_seconds = ?, align_status = 'ok', align_tried_at = ? WHERE id = ?`).run(offset, now(), stream.id);
    retimeStream(db, { ...stream, offset_seconds: offset });
  }
  console.log(`Stream ${stream.id}: ${matched}/${clips.length} clips matched by audio`);
  return true;
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
        const fresh = !isCached(stream.id);
        const a = await alignClip(videoPath(row.id), stream.id, range);
        if (fresh) recordYoutube(db);
        tried.push(`${stream.id}${range ? '' : ' (whole)'}: peak ${a.peak.toFixed(2)} ratio ${a.ratio.toFixed(1)} at ${Math.round(a.seconds)}s`);
        if (confident(a)) hits.push({ stream, seconds: a.seconds, peak: a.peak, ratio: a.ratio });
      } catch (err) {
        recordYoutube(db, err);
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

// Clips without a VOD position whose VOD may still exist (Twitch keeps them
// 60 days): ask Twitch's website API, which has it when the official one
// doesn't. Anything found goes through the exact VOD path.
const learnMissingPositions = async (db: Database.Database) => {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const missing = db
    .prepare(
      `SELECT t.clip_id FROM twitch_clips t JOIN videos v ON v.id = t.video_id
       WHERE t.vod_offset IS NULL AND t.created_at >= ?
         AND COALESCE(t.align_status, '') NOT IN ('manual', 'dismissed')
         AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.video_id = v.id AND s.url LIKE '%youtube.com/watch%')`,
    )
    .all(since) as { clip_id: string }[];
  if (!missing.length) return 0;
  let found: Awaited<ReturnType<typeof getVodPositions>> = [];
  try {
    found = await getVodPositions(missing.map((m) => m.clip_id));
  } catch (err) {
    console.error('VOD position lookup failed:', err instanceof Error ? err.message : err);
    return 0;
  }
  const set = db.prepare(
    `UPDATE twitch_clips SET vod_id = ?, vod_offset = ?, vod_created_at = ?,
       assigned_stream = NULL, align_status = NULL, align_tried_at = NULL
     WHERE clip_id = ?`,
  );
  for (const f of found) set.run(f.vodId, f.vodOffset, f.vodCreatedAt, f.slug);
  return found.length;
};

// A clip aligned by audio that also has a Twitch position pins its stream's
// offset, the same as a pasted link does, so its siblings get exact times.
const offsetsFromAlignedClips = (db: Database.Database) => {
  const rows = db
    .prepare(
      `SELECT s.*, t.vod_offset, t.vod_created_at, src.url FROM youtube_streams s
       JOIN sources src ON src.url LIKE '%v=' || s.id || '&%'
       JOIN twitch_clips t ON t.video_id = src.video_id
       WHERE s.offset_seconds IS NULL AND t.align_status = 'ok'
         AND t.vod_offset IS NOT NULL AND t.vod_created_at IS NOT NULL
       GROUP BY s.id`,
    )
    .all() as (YoutubeStream & { vod_offset: number; vod_created_at: string; url: string })[];
  for (const r of rows) {
    const t = Number(new URL(r.url).searchParams.get('t')?.replace(/s$/, ''));
    if (!Number.isFinite(t)) continue;
    const offset = Math.round(rawSeconds(r, r.vod_created_at, r.vod_offset) - t - LEAD);
    db.prepare(`UPDATE youtube_streams SET offset_seconds = ?, align_status = 'ok', align_tried_at = ? WHERE id = ?`).run(offset, now(), r.id);
    retimeStream(db, { ...r, offset_seconds: offset });
    console.log(`Stream ${r.id} offset ${offset}s from an aligned clip`);
  }
};

export const matchSources = async (db: Database.Database) => {
  await learnMissingPositions(db);
  const learned = await learnVodStarts(db);
  offsetsFromAlignedClips(db);
  return { learned, ...matchVodClips(db) };
};

// One unit of alignment work: a stream if any is waiting, else a clip.
// Returns false when there was nothing to do.
export const alignNext = async (db: Database.Database) => {
  // Cached envelopes would still work, but nothing is queued that is sure to
  // be cached; simpler to wait the pause out.
  if (youtubePaused()) return false;
  // Before alignStreams: it gives most streams their offset from the same
  // single download.
  if (await alignVodClips(db)) return true;
  const streams = await alignStreams(db, 1);
  if (streams.ok + streams.failed > 0) return true;
  const clips = await alignClips(db, 1);
  return clips.ok + clips.failed > 0;
};
