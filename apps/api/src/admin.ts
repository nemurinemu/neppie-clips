import Database from 'better-sqlite3';
import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

// Admin routes are protected by nginx basic auth in production (see
// deploy/nginx); they are only mounted under /api/admin.

const now = () => Math.floor(Date.now() / 1000);
// Must match the fetcher's matcher (twitch/match.ts).
const LEAD = 2;
const DEFAULT_OFFSET = 53;

// Typical offset across aligned streams: the restream delay is near-constant
// (52–56 s on most streams), so the median lands within a few seconds when a
// stream can't be aligned. Outliers (special streams) don't skew it.
const fallbackOffset = (db: Database.Database) => {
  const offsets = (db.prepare(`SELECT offset_seconds o FROM youtube_streams WHERE align_status = 'ok' AND offset_seconds IS NOT NULL ORDER BY o`).all() as { o: number }[]).map((r) => r.o);
  return offsets.length ? offsets[Math.floor(offsets.length / 2)]! : DEFAULT_OFFSET;
};

const mediaFiles = (id: number) => [
  path.resolve(config.clipsDir, `${id}.mp4`),
  path.resolve(config.clipsDir, `${id}_vertical.mp4`),
  path.resolve(config.thumbsDir, `${id}.webp`),
];

const clipSlug = (input: string): string | null => {
  const s = input.trim();
  const m = s.match(/(?:twitch\.tv\/[^/]+\/clip\/|clips\.twitch\.tv\/)([A-Za-z0-9_-]+)/) ?? s.match(/^([A-Za-z0-9_-]{20,})$/);
  return m ? m[1]! : null;
};

export const adminRouter = (): Router => {
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const r = Router();
  // Only requests that came through nginx's basic-auth'd /api/admin/ location
  // carry this header; the generic /api/ proxy never sets it.
  r.use((req, res, next) => {
    if (config.nodeEnv === 'production' && req.get('x-admin-auth') !== 'nginx') {
      res.status(403).json({ error: 'admin routes are only served through the authenticated proxy' });
      return;
    }
    next();
  });
  r.use(express.json());

  // Streams that started before a moment, nearest first: a clip can't come
  // from a stream that hadn't happened yet.
  const streamsBefore = db.prepare(`
    SELECT id, title, started_at AS startedAt, ended_at AS endedAt, offset_seconds AS offsetSeconds, align_status AS alignStatus
    FROM youtube_streams
    WHERE started_at <= ?
    ORDER BY started_at DESC
    LIMIT ?
  `);

  r.get('/overview', (_req, res) => {
    const unmatched = db
      .prepare(`
        SELECT v.id, v.share_id AS shareId, v.description, t.clip_id AS clipId, t.url AS twitchUrl,
               t.created_at AS createdAt, t.duration, t.align_status AS alignStatus, t.assigned_stream AS assignedStream,
               ys.title AS assignedTitle, ys.started_at AS assignedStartedAt,
               (SELECT url FROM sources s WHERE s.video_id = v.id AND s.url LIKE '%youtube.com/watch%') AS youtubeUrl
        FROM videos v JOIN twitch_clips t ON t.video_id = v.id
        LEFT JOIN youtube_streams ys ON ys.id = t.assigned_stream
        WHERE v.needs_review = 1
        ORDER BY t.created_at DESC
      `)
      .all() as { id: number; createdAt: string }[];
    // Alignment order: assigned clips first, then by id — mirror it so the
    // page can show a real queue position.
    const queue = (db
      .prepare(
        `SELECT t.video_id AS id FROM twitch_clips t JOIN videos v ON v.id = t.video_id
         WHERE v.needs_review = 1 AND t.vod_offset IS NULL AND t.align_tried_at IS NULL
           AND COALESCE(t.align_status, '') NOT IN ('dismissed', 'manual')
           AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.video_id = v.id AND s.url LIKE '%youtube.com/watch%')
         ORDER BY (t.assigned_stream IS NOT NULL) DESC, t.video_id ASC`,
      )
      .all() as { id: number }[]).map((r) => r.id);
    const withSuggestions = unmatched.map((row) => ({
      ...row,
      queuePosition: queue.indexOf(row.id) + 1 || null,
      suggestions: streamsBefore.all(row.createdAt, 30),
    }));

    const lateSeen = db
      .prepare(`
        SELECT r.clip_id AS clipId, r.url AS twitchUrl, r.title, r.created_at AS createdAt, r.seen_at AS seenAt,
               v.id, v.share_id AS shareId
        FROM twitch_review r LEFT JOIN twitch_clips t ON t.clip_id = r.clip_id LEFT JOIN videos v ON v.id = t.video_id
        WHERE r.status = 'pending'
        ORDER BY r.seen_at DESC
      `)
      .all();

    const failedStreams = db
      .prepare(`
        SELECT s.id, s.title, s.started_at AS startedAt,
               (SELECT src.url FROM sources src JOIN twitch_clips t ON t.video_id = src.video_id
                WHERE src.url LIKE '%v=' || s.id || '&%' ORDER BY t.duration DESC LIMIT 1) AS sampleUrl,
               (SELECT v.description FROM sources src JOIN twitch_clips t ON t.video_id = src.video_id JOIN videos v ON v.id = t.video_id
                WHERE src.url LIKE '%v=' || s.id || '&%' ORDER BY t.duration DESC LIMIT 1) AS sampleTitle,
               (SELECT COUNT(*) FROM sources src WHERE src.url LIKE '%v=' || s.id || '&%') AS clipCount
        FROM youtube_streams s WHERE s.align_status = 'failed' ORDER BY s.started_at DESC
      `)
      .all();

    const bytes = db
      .prepare('SELECT COALESCE(SUM(size_bytes), 0) + COALESCE(SUM(vertical_size_bytes), 0) AS b FROM videos')
      .get() as { b: number };
    const st = fs.statfsSync(config.clipsDir);
    const counts = db
      .prepare(`SELECT source_platform AS platform, COUNT(*) AS n FROM videos WHERE size_bytes IS NOT NULL GROUP BY source_platform`)
      .all();

    res.json({
      storage: { clipsBytes: bytes.b, diskFree: st.bavail * st.bsize, diskTotal: st.blocks * st.bsize },
      counts,
      unmatched: withSuggestions,
      lateSeen,
      failedStreams,
    });
  });

  r.get('/streams', (req, res) => {
    const before = typeof req.query.before === 'string' ? req.query.before : new Date().toISOString();
    res.json(streamsBefore.all(before, 100));
  });

  // A pasted timestamped YouTube link is the source, no questions asked.
  r.post('/clips/:id/source', (req, res) => {
    const id = Number(req.params.id);
    let parsed: URL;
    try {
      parsed = new URL(String(req.body?.url ?? '').trim());
    } catch {
      res.status(400).json({ error: 'not a url' });
      return;
    }
    const videoId =
      parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1) : parsed.searchParams.get('v');
    const t = parsed.searchParams.get('t') ?? '';
    const seconds = /^\d+s?$/.test(t)
      ? parseInt(t, 10)
      : [...t.matchAll(/(\d+)([hms])/g)].reduce((acc, m) => acc + Number(m[1]) * ({ h: 3600, m: 60, s: 1 }[m[2]!] ?? 0), 0);
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      res.status(400).json({ error: 'not a youtube link' });
      return;
    }
    if (!db.prepare('SELECT 1 FROM twitch_clips WHERE video_id = ?').get(id)) {
      res.status(404).json({ error: 'not a twitch clip' });
      return;
    }
    const stream = db.prepare('SELECT title, started_at FROM youtube_streams WHERE id = ?').get(videoId) as
      | { title: string; started_at: string }
      | undefined;
    const clip = db.prepare('SELECT vod_offset, vod_created_at FROM twitch_clips WHERE video_id = ?').get(id) as {
      vod_offset: number | null;
      vod_created_at: string | null;
    };
    let retimed = 0;
    db.transaction(() => {
      db.prepare(`DELETE FROM sources WHERE video_id = ? AND url LIKE '%youtube.com/watch%'`).run(id);
      db.prepare('INSERT INTO sources (video_id, url, youtube_title, youtube_published_at) VALUES (?, ?, ?, ?)').run(
        id,
        `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`,
        stream?.title ?? null,
        stream?.started_at ?? null,
      );
      db.prepare(`UPDATE twitch_clips SET align_status = 'manual', assigned_stream = NULL WHERE video_id = ?`).run(id);
      db.prepare('UPDATE videos SET needs_review = 0, updated_at = ? WHERE id = ?').run(now(), id);

      // A correct link for a clip with an exact Twitch position pins the
      // stream's offset, and every other clip from the same Twitch VOD is
      // re-timed from it right away.
      if (stream && clip.vod_offset !== null && clip.vod_created_at !== null) {
        const drift = (Date.parse(stream.started_at) - Date.parse(clip.vod_created_at)) / 1000;
        const offset = Math.round(clip.vod_offset - drift - seconds - LEAD);
        db.prepare(`UPDATE youtube_streams SET offset_seconds = ?, align_status = 'manual', align_tried_at = ? WHERE id = ?`).run(offset, now(), videoId);
        const siblings = db
          .prepare(
            `SELECT video_id, vod_offset FROM twitch_clips
             WHERE vod_created_at = ? AND vod_offset IS NOT NULL AND video_id != ?
               AND COALESCE(align_status, '') NOT IN ('manual', 'dismissed')`,
          )
          .all(clip.vod_created_at, id) as { video_id: number; vod_offset: number }[];
        const del = db.prepare(`DELETE FROM sources WHERE video_id = ? AND url LIKE '%youtube.com/watch%'`);
        const ins = db.prepare('INSERT INTO sources (video_id, url, youtube_title, youtube_published_at) VALUES (?, ?, ?, ?)');
        const flag = db.prepare('UPDATE videos SET needs_review = 0, updated_at = ? WHERE id = ?');
        for (const s of siblings) {
          const t = Math.max(0, Math.round(s.vod_offset - drift - offset - LEAD));
          del.run(s.video_id);
          ins.run(s.video_id, `https://www.youtube.com/watch?v=${videoId}&t=${t}s`, stream.title, stream.started_at);
          flag.run(now(), s.video_id);
        }
        retimed = siblings.length;
      }
    })();
    res.json({ ok: true, videoId, seconds, retimed });
  });

  // No YouTube source for this one; optionally say why in the description.
  r.post('/clips/:id/resolve', (req, res) => {
    const id = Number(req.params.id);
    const note = String(req.body?.note ?? '').trim() || null;
    const t = db.prepare('SELECT title FROM twitch_clips WHERE video_id = ?').get(id) as { title: string } | undefined;
    if (!t) {
      res.status(404).json({ error: 'not a twitch clip' });
      return;
    }
    db.transaction(() => {
      db.prepare(`UPDATE twitch_clips SET note = ?, align_status = 'dismissed', assigned_stream = NULL WHERE video_id = ?`).run(note, id);
      db.prepare('UPDATE videos SET description = ?, needs_review = 0, updated_at = ? WHERE id = ?').run(
        note ? `${t.title}\n${note}` : t.title,
        now(),
        id,
      );
    })();
    res.json({ ok: true });
  });

  // Pick the stream by hand: the poller aligns against it on its next run.
  r.post('/clips/:id/assign', (req, res) => {
    const id = Number(req.params.id);
    const streamId = String(req.body?.streamId ?? '');
    if (!db.prepare('SELECT 1 FROM youtube_streams WHERE id = ?').get(streamId)) {
      res.status(400).json({ error: 'unknown stream' });
      return;
    }
    db.transaction(() => {
      db.prepare('UPDATE twitch_clips SET assigned_stream = ?, align_status = NULL, align_tried_at = NULL WHERE video_id = ?').run(streamId, id);
      db.prepare(`DELETE FROM sources WHERE video_id = ? AND url LIKE '%youtube.com/watch%'`).run(id);
      db.prepare('UPDATE videos SET needs_review = 1 WHERE id = ?').run(id);
    })();
    res.json({ ok: true });
  });

  // Not mine after all: delete it and never let the poller re-add it.
  r.post('/clips/:id/remove', (req, res) => {
    const id = Number(req.params.id);
    const t = db.prepare('SELECT clip_id, url, title, created_at FROM twitch_clips WHERE video_id = ?').get(id) as
      | { clip_id: string; url: string; title: string; created_at: string }
      | undefined;
    if (!t) {
      res.status(404).json({ error: 'not a twitch clip' });
      return;
    }
    db.transaction(() => {
      db.prepare(`
        INSERT INTO twitch_review (clip_id, url, title, created_at, seen_at, status) VALUES (?, ?, ?, ?, ?, 'ignored')
        ON CONFLICT(clip_id) DO UPDATE SET status = 'ignored'
      `).run(t.clip_id, t.url, t.title, t.created_at, now());
      db.prepare('DELETE FROM videos WHERE id = ?').run(id);
    })();
    for (const f of mediaFiles(id)) fs.rmSync(f, { force: true });
    res.json({ ok: true });
  });

  r.post('/review/:clipId/keep', (req, res) => {
    db.prepare(`UPDATE twitch_review SET status = 'accepted' WHERE clip_id = ?`).run(req.params.clipId);
    res.json({ ok: true });
  });

  // Clips the listing hides: queue by URL, the poller fetches them by id.
  r.post('/clips/add', (req, res) => {
    const slug = clipSlug(String(req.body?.url ?? ''));
    if (!slug) {
      res.status(400).json({ error: 'not a twitch clip url' });
      return;
    }
    const file = path.resolve(config.clipsDir, '..', 'extra-clips.txt');
    const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()) : [];
    if (!lines.includes(slug)) fs.appendFileSync(file, `${slug}\n`);
    res.json({ ok: true, slug });
  });

  // Forces the "content changed" path on the next poll.
  r.post('/clips/:id/redownload', (req, res) => {
    const n = db.prepare(`UPDATE twitch_clips SET thumbnail_url = '' WHERE video_id = ?`).run(Number(req.params.id)).changes;
    res.json({ ok: n > 0 });
  });

  // The early-biased guess looked right by eye: keep it and clear the flags.
  r.post('/streams/:id/accept', (req, res) => {
    const id = String(req.params.id);
    if (!db.prepare('SELECT 1 FROM youtube_streams WHERE id = ?').get(id)) {
      res.status(404).json({ error: 'unknown stream' });
      return;
    }
    db.transaction(() => {
      db.prepare(`UPDATE youtube_streams SET offset_seconds = COALESCE(offset_seconds, ?), align_status = 'manual', align_tried_at = ? WHERE id = ?`).run(fallbackOffset(db), now(), id);
      db.prepare(`UPDATE videos SET needs_review = 0 WHERE id IN (SELECT video_id FROM sources WHERE url LIKE '%v=' || ? || '&%')`).run(id);
    })();
    res.json({ ok: true });
  });

  r.post('/streams/:id/realign', (req, res) => {
    db.prepare('UPDATE youtube_streams SET offset_seconds = NULL, align_status = NULL, align_tried_at = NULL WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  return r;
};
