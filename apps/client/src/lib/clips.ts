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
  id: number;
  mediaId: number;
  description: string;
  addedAt: Date | null;
  streamAt: Date | null;
  sizeBytes: number | null;
  thumbUrl: string;
  videoUrl: string;
  sources: ClipSource[];
  search: string;
}

export type SortKey = 'id' | 'description' | 'addedAt' | 'streamAt';
export type SortDir = 'asc' | 'desc';

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
    .sort((a, b) => a.getTime() - b.getTime())[0];

  return {
    id: v.id,
    mediaId: v.telegramMsgId,
    description: v.description ?? '',
    addedAt: parseDate(v.addedAt),
    streamAt: streamAt ?? null,
    sizeBytes: v.sizeBytes,
    thumbUrl: config.thumbUrl(v.telegramMsgId),
    videoUrl: config.videoUrl(v.telegramMsgId),
    sources,
    search: [v.description, ...sources.map((s) => `${s.title} ${s.url}`)]
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
  const sortKey = ref<SortKey>('id');
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

  const visible = computed<Clip[]>(() => {
    const q = query.value.trim().toLowerCase();
    const filtered = q
      ? clips.value.filter((c) => c.search.includes(q))
      : clips.value.slice();

    const dir = sortDir.value === 'asc' ? 1 : -1;
    const key = sortKey.value;
    filtered.sort((a, b) => {
      if (key === 'id') return (a.id - b.id) * dir;
      if (key === 'description') {
        return a.description.localeCompare(b.description) * dir;
      }
      return (time(a[key]) - time(b[key])) * dir;
    });
    return filtered;
  });

  return {
    clips,
    loading,
    error,
    query,
    sortKey,
    sortDir,
    visible,
    load,
    setSort,
  };
};
