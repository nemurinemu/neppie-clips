import { config } from '../config';
import { getAccessToken } from './auth';

const HELIX = 'https://api.twitch.tv/helix';

export interface TwitchClip {
  id: string;
  url: string;
  broadcaster_id: string;
  creator_id: string;
  creator_name: string;
  video_id: string;
  game_id: string;
  title: string;
  view_count: number;
  created_at: string;
  thumbnail_url: string;
  duration: number;
  vod_offset: number | null;
}

export interface TwitchVideo {
  id: string;
  title: string;
  created_at: string;
  duration: string;
  url: string;
}

export interface ClipDownload {
  clip_id: string;
  landscape_download_url: string | null;
  portrait_download_url: string | null;
}

type Params = Record<string, string | string[]>;
interface Page<T> {
  data: T[];
  pagination?: { cursor?: string };
}

export const helix = async <T>(path: string, params: Params): Promise<T> => {
  const url = new URL(`${HELIX}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
    else url.searchParams.set(k, v);
  }
  const call = async (force: boolean) =>
    fetch(url, {
      headers: {
        Authorization: `Bearer ${await getAccessToken(force)}`,
        'Client-Id': config.twitchClientId,
      },
    });
  let res = await call(false);
  if (res.status === 401) res = await call(true);
  if (!res.ok) {
    throw new Error(`Twitch ${path} ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
};

const chunk = <T>(arr: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export const getUserId = async (login: string) => {
  const { data } = await helix<Page<{ id: string }>>('users', { login });
  if (!data[0]) throw new Error(`Twitch user not found: ${login}`);
  return data[0].id;
};

export const getOwnUserId = async () =>
  (await helix<Page<{ id: string }>>('users', {})).data[0]!.id;

export interface TwitchIds {
  broadcasterId: string;
  editorId: string;
}

export const resolveIds = async (): Promise<TwitchIds> => {
  const [broadcasterId, editorId] = await Promise.all([
    getUserId(config.twitchBroadcaster),
    getOwnUserId(),
  ]);
  return { broadcasterId, editorId };
};

const MIN_WINDOW_MS = 60 * 60 * 1000;

// Get Clips is sorted by view count and caps at ~1000 results per query,
// with clips shifting between pages as views change. Bisecting the window
// until each half fits in one page sidesteps both.
export const listClips = async (
  broadcasterId: string,
  from: Date,
  to: Date,
): Promise<TwitchClip[]> => {
  const found = new Map<string, TwitchClip>();

  const walk = async (from: Date, to: Date): Promise<void> => {
    const res = await helix<Page<TwitchClip>>('clips', {
      broadcaster_id: broadcasterId,
      started_at: from.toISOString(),
      ended_at: to.toISOString(),
      first: '100',
    });
    const overflow = !!res.pagination?.cursor;
    if (overflow && to.getTime() - from.getTime() > MIN_WINDOW_MS) {
      const mid = new Date((from.getTime() + to.getTime()) / 2);
      await walk(from, mid);
      await walk(mid, to);
      return;
    }
    for (const c of res.data) found.set(c.id, c);
    // An hour with 100+ clips: follow the cursor as best effort.
    let cursor = res.pagination?.cursor;
    while (cursor) {
      const more = await helix<Page<TwitchClip>>('clips', {
        broadcaster_id: broadcasterId,
        started_at: from.toISOString(),
        ended_at: to.toISOString(),
        first: '100',
        after: cursor,
      });
      for (const c of more.data) found.set(c.id, c);
      cursor = more.pagination?.cursor;
    }
  };

  await walk(from, to);
  return [...found.values()];
};

export const getClipsById = async (ids: string[]): Promise<TwitchClip[]> => {
  const out: TwitchClip[] = [];
  for (const batch of chunk(ids, 100)) {
    out.push(...(await helix<Page<TwitchClip>>('clips', { id: batch })).data);
  }
  return out;
};

export const getVideos = async (ids: string[]): Promise<TwitchVideo[]> => {
  const out: TwitchVideo[] = [];
  for (const batch of chunk(ids, 100)) {
    out.push(...(await helix<Page<TwitchVideo>>('videos', { id: batch })).data);
  }
  return out;
};

export const getClipDownloads = async (
  broadcasterId: string,
  editorId: string,
  clipIds: string[],
): Promise<ClipDownload[]> => {
  const out: ClipDownload[] = [];
  for (const batch of chunk(clipIds, 10)) {
    const { data } = await helix<Page<ClipDownload>>('clips/downloads', {
      broadcaster_id: broadcasterId,
      editor_id: editorId,
      clip_id: batch,
    });
    out.push(...data);
  }
  return out;
};

export interface VodPosition {
  slug: string;
  vodId: string;
  vodOffset: number;
  vodCreatedAt: string;
}

// The official Get Clips omits the VOD link for clips fetched by id (and
// for clips the listing hides). Twitch's own website API has it. Unofficial:
// if it ever breaks, clips just fall back to audio alignment.
export const getVodPositions = async (slugs: string[]): Promise<VodPosition[]> => {
  const out: VodPosition[] = [];
  for (const batch of chunk(slugs, 20)) {
    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Content-Type': 'application/json' },
      body: JSON.stringify(
        batch.map((slug) => ({
          query: `{ clip(slug: ${JSON.stringify(slug)}) { videoOffsetSeconds video { id createdAt } } }`,
        })),
      ),
    });
    if (!res.ok) throw new Error(`Twitch gql ${res.status}`);
    const data = (await res.json()) as {
      data?: { clip?: { videoOffsetSeconds: number | null; video: { id: string; createdAt: string } | null } | null };
    }[];
    data.forEach((d, i) => {
      const c = d.data?.clip;
      if (c?.video && c.videoOffsetSeconds !== null) {
        out.push({ slug: batch[i]!, vodId: c.video.id, vodOffset: c.videoOffsetSeconds, vodCreatedAt: c.video.createdAt });
      }
    });
  }
  return out;
};
