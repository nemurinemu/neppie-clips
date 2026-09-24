import Database from 'better-sqlite3';
import { config } from '../config';

const API = 'https://www.googleapis.com/youtube/v3';

const yt = async <T>(path: string, params: Record<string, string>): Promise<T> => {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', config.youtubeApiKey);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube ${path} ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};

let uploadsPlaylist: string | null = null;

const getUploadsPlaylist = async () => {
  if (uploadsPlaylist) return uploadsPlaylist;
  const { items } = await yt<{
    items: { contentDetails: { relatedPlaylists: { uploads: string } } }[];
  }>('channels', { part: 'contentDetails', forHandle: config.youtubeChannel });
  if (!items?.[0]) throw new Error(`YouTube channel not found: ${config.youtubeChannel}`);
  uploadsPlaylist = items[0].contentDetails.relatedPlaylists.uploads;
  return uploadsPlaylist;
};

export interface YoutubeStream {
  id: string;
  title: string;
  started_at: string;
  ended_at: string | null;
  published_at: string;
  offset_seconds: number | null;
  align_status: string | null;
  align_tried_at: number | null;
}

export const streamLength = (s: YoutubeStream) =>
  s.ended_at ? (Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000 : null;

interface VideoItem {
  id: string;
  snippet: { title: string; publishedAt: string };
  liveStreamingDetails?: { actualStartTime?: string; actualEndTime?: string };
}

// Walk the uploads playlist newest-first until a page contains only streams
// we already have complete (ended). Streams still live are re-fetched until
// they end, and regular uploads are ignored.
export const refreshStreams = async (db: Database.Database) => {
  const playlist = await getUploadsPlaylist();
  const known = new Map(
    (db.prepare('SELECT id, ended_at FROM youtube_streams').all() as { id: string; ended_at: string | null }[])
      .map((r) => [r.id, r.ended_at]),
  );
  const upsert = db.prepare(`
    INSERT INTO youtube_streams (id, title, started_at, ended_at, published_at, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, started_at = excluded.started_at,
      ended_at = excluded.ended_at, published_at = excluded.published_at,
      fetched_at = excluded.fetched_at
  `);

  let pageToken: string | undefined;
  let added = 0;
  let pages = 0;
  do {
    const page = await yt<{ items: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>(
      'playlistItems',
      { part: 'contentDetails', playlistId: playlist, maxResults: '50', ...(pageToken ? { pageToken } : {}) },
    );
    pages++;
    const ids = page.items.map((i) => i.contentDetails.videoId);
    const stale = ids.filter((id) => !known.has(id) || known.get(id) === null);
    if (stale.length) {
      const { items } = await yt<{ items: VideoItem[] }>('videos', {
        part: 'snippet,liveStreamingDetails',
        id: stale.join(','),
      });
      const now = Math.floor(Date.now() / 1000);
      for (const v of items) {
        const live = v.liveStreamingDetails;
        if (!live?.actualStartTime) continue;
        if (!known.has(v.id)) added++;
        upsert.run(v.id, v.snippet.title, live.actualStartTime, live.actualEndTime ?? null, v.snippet.publishedAt, now);
      }
    }
    pageToken = stale.length ? page.nextPageToken : undefined;
  } while (pageToken);

  return { added, pages };
};

export const streamContaining = (db: Database.Database, isoTime: string): YoutubeStream | undefined =>
  db
    .prepare(
      `SELECT * FROM youtube_streams
       WHERE started_at <= ? AND (ended_at IS NULL OR ended_at >= ?)
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(isoTime, isoTime) as YoutubeStream | undefined;

export const streamBefore = (db: Database.Database, isoTime: string): YoutubeStream | undefined =>
  db
    .prepare(`SELECT * FROM youtube_streams WHERE ended_at IS NOT NULL AND ended_at < ? ORDER BY ended_at DESC LIMIT 1`)
    .get(isoTime) as YoutubeStream | undefined;
