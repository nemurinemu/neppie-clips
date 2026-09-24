import Database from 'better-sqlite3';
import fs from 'node:fs';
import { config } from '../config';
import { removeMedia } from '../media';
import { applySchema } from '../schema';
import { getClipsById, listClips, resolveIds, TwitchClip, TwitchIds } from './api';
import { updateYtDlp } from './align';
import { alignNext, matchSources } from './match';
import { processTwitchClip } from './process-clip';
import { refreshStreams } from './youtube';

const POLL_MS = 5 * 60 * 1000;
const YTDLP_UPDATE_MS = 24 * 60 * 60 * 1000;
const ALIGN_IDLE_MS = 60 * 1000;
const LATE_SEEN_DAYS = 30;
const MISSING_POLLS_BEFORE_DELETE = 2;

interface Options {
  once: boolean;
  backfill: boolean; // initial import: everything is old, don't log it as late-seen
  limit: number; // dev: cap new clips per poll
}

const parseArgs = (argv: string[]): Options => {
  const i = argv.indexOf('--limit');
  const limit = i === -1 ? Infinity : Number(argv[i + 1]);
  if (!Number.isFinite(limit) && i !== -1) throw new Error('--limit needs a number');
  return {
    once: argv.includes('--once'),
    backfill: argv.includes('--backfill'),
    limit,
  };
};

const readExtraClipIds = () => {
  if (!fs.existsSync(config.extraClipsPath)) return [];
  return fs
    .readFileSync(config.extraClipsPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
};

const poll = async (ids: TwitchIds, db: Database.Database, opts: Options) => {
  const t0 = Date.now();
  const since = config.twitchClipsSince;

  const listed = await listClips(ids.broadcasterId, since, new Date());
  const mine = listed.filter(
    (c) => c.creator_id === ids.editorId && Date.parse(c.created_at) >= since.getTime(),
  );
  const extraIds = readExtraClipIds().filter((id) => !mine.some((c) => c.id === id));
  const extras = extraIds.length ? await getClipsById(extraIds) : [];

  const ignored = new Set(
    (db.prepare(`SELECT clip_id FROM twitch_review WHERE status = 'ignored'`).all() as { clip_id: string }[])
      .map((r) => r.clip_id),
  );
  const known = new Set(
    (db.prepare('SELECT clip_id FROM twitch_clips').all() as { clip_id: string }[]).map((r) => r.clip_id),
  );
  const logLateSeen = db.prepare(
    `INSERT OR IGNORE INTO twitch_review (clip_id, url, title, created_at, seen_at) VALUES (?, ?, ?, ?, ?)`,
  );

  let added = 0;
  let failed = 0;
  let lateSeen = 0;
  for (const clip of [...mine, ...extras]) {
    if (ignored.has(clip.id)) continue;
    const isNew = !known.has(clip.id);
    if (isNew && added >= opts.limit) continue;
    if (isNew && !opts.backfill) {
      const ageDays = (Date.now() - Date.parse(clip.created_at)) / 86_400_000;
      if (ageDays > LATE_SEEN_DAYS) {
        logLateSeen.run(clip.id, clip.url, clip.title, clip.created_at, Math.floor(Date.now() / 1000));
        lateSeen++;
      }
    }
    try {
      await processTwitchClip(ids, clip, db);
      if (isNew) added++;
    } catch (err) {
      failed++;
      console.error(`Failed processing clip ${clip.id}:`, err);
    }
  }

  const deleted = await reconcileDeleted(db, [...mine, ...extras]);

  const streams = await refreshStreams(db);
  const match = await matchSources(db);

  console.log(
    `Poll: ${listed.length} listed, ${mine.length} mine, ${extras.length} extra, ` +
      `${added} added, ${failed} failed, ${lateSeen} late-seen, ${deleted} deleted; ` +
      `streams +${streams.added}; sources: ${match.matched} matched, ${match.noStream} no stream; ` +
      `${Date.now() - t0} ms`,
  );
};

// A clip missing from the listing proves nothing (see the doc). Confirm by
// direct id lookup and only delete after it's been gone two polls running.
const reconcileDeleted = async (db: Database.Database, seen: TwitchClip[]) => {
  const seenIds = new Set(seen.map((c) => c.id));
  const local = db.prepare('SELECT video_id, clip_id, missing_polls FROM twitch_clips').all() as {
    video_id: number;
    clip_id: string;
    missing_polls: number;
  }[];
  const unseen = local.filter((r) => !seenIds.has(r.clip_id));
  const stillThere = new Set(
    unseen.length ? (await getClipsById(unseen.map((r) => r.clip_id))).map((c) => c.id) : [],
  );

  const reset = db.prepare('UPDATE twitch_clips SET missing_polls = 0 WHERE clip_id = ? AND missing_polls != 0');
  const bump = db.prepare('UPDATE twitch_clips SET missing_polls = missing_polls + 1 WHERE clip_id = ?');
  const remove = db.prepare('DELETE FROM videos WHERE id = ?');

  const gone: number[] = [];
  db.transaction(() => {
    for (const r of local) {
      if (seenIds.has(r.clip_id) || stillThere.has(r.clip_id)) {
        reset.run(r.clip_id);
      } else if (r.missing_polls + 1 >= MISSING_POLLS_BEFORE_DELETE) {
        remove.run(r.video_id);
        gone.push(r.video_id);
      } else {
        bump.run(r.clip_id);
      }
    }
  })();
  for (const id of gone) removeMedia(id);
  if (gone.length) console.log(`Deleted ${gone.length} twitch clip(s) gone from Twitch: ${gone.join(', ')}`);
  return gone.length;
};

const main = async () => {
  const opts = parseArgs(process.argv.slice(2));
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  const ids = await resolveIds();
  console.log(`Twitch poller: ${config.twitchBroadcaster} (${ids.broadcasterId}), creator ${ids.editorId}, since ${config.twitchClipsSince.toISOString().slice(0, 10)}`);

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await poll(ids, db, opts);
    } catch (err) {
      console.error('Poll failed:', err);
    } finally {
      running = false;
    }
  };

  await updateYtDlp();
  await run();
  if (opts.once) {
    // Drain the alignment queue too, then exit.
    while (await alignNext(db)) {
      /* keep going */
    }
    db.close();
    return;
  }
  setInterval(run, POLL_MS);
  setInterval(updateYtDlp, YTDLP_UPDATE_MS);

  // Alignment runs continuously and independently of the poll: each unit
  // is a minute or more of yt-dlp/ffmpeg, so it never blocks new clips.
  const alignLoop = async () => {
    for (;;) {
      let did = false;
      try {
        did = await alignNext(db);
      } catch (err) {
        console.error('Alignment failed:', err);
      }
      if (!did) await new Promise((r) => setTimeout(r, ALIGN_IDLE_MS));
    }
  };
  void alignLoop();
  const shutdown = () => {
    db.close();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGUSR2'] as const) process.once(signal, shutdown);
};

main().catch((err) => {
  console.error('Twitch poller crashed:', err);
  process.exit(1);
});
