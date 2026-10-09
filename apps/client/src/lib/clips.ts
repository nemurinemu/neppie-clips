import { computed, ref, shallowRef } from 'vue';
import type { VideoResponse } from '@neppie-clips/shared';
import { config } from '../config';
import { hostOf, parseDate } from './format';

export interface ClipSource {
  url: string;
  title: string;
  host: string;
  publishedAt: Date | null;
}

export interface Clip {
  mediaId: number;
  clipNumber: number;
  shareId: string;
  description: string;
  addedAt: Date | null;
  streamAt: Date | null;
  sizeBytes: number | null;
  thumbUrl: string;
  videoUrl: string;
  verticalUrl: string | null;
  verticalSizeBytes: number | null;
  era: Era;
  platform: 'telegram' | 'twitch';
  twitchUrl: string | null;
  sources: ClipSource[];
  search: string;
}

export type Era = 'pre' | 'post';
export type SortKey = 'clipNumber' | 'description' | 'addedAt' | 'streamAt';
export type SortDir = 'asc' | 'desc';

// Streams before this belong to the pre-3.0 era.
const ERA_START = Date.UTC(2025, 4, 1);

// Clips without a source can carry the stream date in the description, e.g. 2024-08-24.
const descriptionDate = (text: string): Date | null => {
  const m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (!m) return null;
  const d = new Date(`${m[0]}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const toClip = (v: VideoResponse): Clip => {
  const sources: ClipSource[] = v.sources.map((s) => ({
    url: s.url,
    title: s.youtubeTitle ?? hostOf(s.url),
    host: hostOf(s.url),
    publishedAt: parseDate(s.youtubePublishedAt),
  }));

  const streamAt = sources
    .map((s) => s.publishedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0] ??
    descriptionDate(v.description ?? '');

  return {
    mediaId: v.id,
    clipNumber: v.clipNumber,
    shareId: v.shareId,
    description: v.description ?? '',
    addedAt: parseDate(v.addedAt),
    streamAt: streamAt ?? null,
    era: streamAt && streamAt.getTime() < ERA_START ? 'pre' : 'post',
    sizeBytes: v.sizeBytes,
    thumbUrl: config.thumbUrl(v.id, v.updatedAt),
    videoUrl: config.videoUrl(v.id, v.updatedAt),
    verticalUrl: v.hasVertical ? config.verticalUrl(v.id, v.updatedAt) : null,
    verticalSizeBytes: v.verticalSizeBytes ?? null,
    platform: v.platform ?? 'telegram',
    twitchUrl: v.twitchUrl ?? null,
    sources,
    search: [v.description, ...sources.map((s) => s.title)]
      .join(' ')
      .toLowerCase(),
  };
};

const time = (d: Date | null): number => (d ? d.getTime() : -Infinity);

export const useClips = () => {
  const clips = shallowRef<Clip[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  const query = ref('');
  const era = ref<Era>('post');
  const sortKey = ref<SortKey>('clipNumber');
  const sortDir = ref<SortDir>('desc');

  const load = async () => {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch(config.videosEndpoint);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as VideoResponse[];
      clips.value = data.map(toClip);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load clips';
    } finally {
      loading.value = false;
    }
  };

  const setSort = (key: SortKey) => {
    if (sortKey.value === key) {
      sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey.value = key;
      sortDir.value = key === 'addedAt' || key === 'streamAt' ? 'desc' : 'asc';
    }
  };

  const byEra = computed<Record<Era, Clip[]>>(() => {
    const q = query.value.trim().toLowerCase();
    const lists: Record<Era, Clip[]> = { pre: [], post: [] };
    for (const c of clips.value) {
      if (!q || c.search.includes(q)) lists[c.era].push(c);
    }

    const dir = sortDir.value === 'asc' ? 1 : -1;
    const key = sortKey.value;
    const compare = (a: Clip, b: Clip) => {
      if (key === 'clipNumber') return (a.clipNumber - b.clipNumber) * dir;
      if (key === 'description') {
        return a.description.localeCompare(b.description) * dir;
      }
      return (time(a[key]) - time(b[key])) * dir;
    };
    lists.pre.sort(compare);
    lists.post.sort(compare);
    return lists;
  });

  return {
    clips,
    loading,
    error,
    query,
    era,
    byEra,
    sortKey,
    sortDir,
    load,
    setSort,
  };
};
